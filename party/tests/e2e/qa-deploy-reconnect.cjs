// qa-deploy-reconnect: every websocket is cut from the network side, the way Cloud Run
// ends a request at its timeout (3600 s) or a Wi-Fi router drops idle TCP. The phones and
// the TV must reconnect by themselves over websocket (never polling), keep the same player,
// keep their score and finish the round with the server agreeing on it.
//
// A TCP proxy in this script stands between the browsers and the game server and cuts every
// open connection on demand (in the lobby, mid-round, during the results).
//
// Run against the production image (or any built server):
//   docker run -d --name qa-deploy-run -p 8825:8080 -e PORT=8080 -e PARTY_TEST_FAST=1 \
//     -e PARTY_TEST_DURATION_MS=30000 party-arena:qa
//   TARGET=127.0.0.1:8825 PROXY_PORT=8824 node tests/e2e/qa-deploy-reconnect.cjs
// Screenshots: tests/e2e/out/qa-deploy/reconnect/
const { chromium, devices } = require('playwright');
const net = require('net');
const fs = require('fs');
const path = require('path');

const [THOST, TPORT] = (process.env.TARGET || '127.0.0.1:8825').split(':');
const PROXY_PORT = Number(process.env.PROXY_PORT || 8824);
const BASE = `http://localhost:${PROXY_PORT}`;
const OUT = path.join(__dirname, 'out', 'qa-deploy', 'reconnect');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
const failures = [];
function check(ok, msg, extra) {
  if (ok) {
    passed++;
    console.log('  ok  ', msg);
  } else {
    failures.push(msg);
    console.log('  FAIL', msg, extra !== undefined ? JSON.stringify(extra) : '');
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(50);
  }
}

// ── the cutting proxy ──
const live = new Set();
let accepted = 0;
const proxy = net.createServer((c) => {
  accepted++;
  const u = net.connect(Number(TPORT), THOST);
  const pair = { c, u };
  live.add(pair);
  c.pipe(u);
  u.pipe(c);
  const end = () => {
    live.delete(pair);
    c.destroy();
    u.destroy();
  };
  c.on('error', end).on('close', end);
  u.on('error', end).on('close', end);
});
function cutAll() {
  const n = live.size;
  for (const { c, u } of [...live]) {
    c.destroy();
    u.destroy();
  }
  live.clear();
  return n;
}

async function healthz() {
  const r = await fetch(`http://${THOST}:${TPORT}/healthz`);
  return r.json();
}

(async () => {
  await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const pages = [];
  try {
    // ── TV ──
    const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const host = await hostCtx.newPage();
    const errs = [];
    const track = (page, label) => {
      const t = { label, page, ws: [], polling: 0 };
      page.on('websocket', (ws) => t.ws.push(ws.url()));
      page.on('request', (req) => {
        if (req.url().includes('/socket.io/') && req.url().includes('transport=polling')) t.polling++;
      });
      page.on('pageerror', (e) => errs.push(`${label}: ${e.message}`));
      pages.push(t);
      return t;
    };
    const H = track(host, 'tv');
    await host.goto(`${BASE}/host`);
    await host.evaluate(() => localStorage.clear());
    H.ws.length = 0; // count from the fresh room's page load only
    await host.goto(`${BASE}/host`);
    await host.waitForSelector('[data-testid=room-code]', { timeout: 15000 });
    const code = (await host.textContent('[data-testid=room-code]')).trim();
    check(/^[A-Z0-9]{4}$/.test(code), `room ${code}`);
    await host.mouse.click(960, 60);
    const hs = () => host.evaluate(() => (window.__host ? window.__host.state() : null));

    // ── two phones ──
    const phones = [];
    for (const [label, device, name] of [
      ['iphone', 'iPhone 14', 'נועה'],
      ['pixel', 'Pixel 7', 'עומר'],
    ]) {
      const ctx = await browser.newContext({ ...devices[device] });
      const page = await ctx.newPage();
      const t = track(page, label);
      await page.goto(`${BASE}/?room=${code}`);
      await page.waitForSelector('.pp-name-input', { timeout: 15000 });
      await page.fill('.pp-name-input', name);
      await page.locator('.pp-btn-go').tap();
      await page.waitForFunction(() => window.__player && window.__player.screen === 'lobby', null, { timeout: 10000 });
      t.id = await page.evaluate(() => window.__player.snap.playerId);
      t.name = name;
      phones.push(t);
    }
    await waitFor(async () => (await hs()).players.length === 2, 8000, 'TV sees 2 players');
    check(pages.every((p) => p.ws.length === 1 && p.ws[0].includes('transport=websocket')), 'every page opened one websocket (transport=websocket)', pages.map((p) => p.ws));

    const pinfo = (ph) =>
      ph.page.evaluate(() => {
        const p = window.__player;
        const hud = document.querySelector('.pa-hud-num');
        return {
          screen: p.screen,
          id: p.snap.playerId,
          score: hud ? Number(hud.textContent.replace(/[^\d]/g, '')) : null,
          endedRound: p.snap.endedRound,
          endedScore: p.snap.endedScore,
        };
      });
    const tvConnected = () => host.evaluate(() => !document.querySelector('[data-testid=offline]'));

    async function afterCut(stage, n) {
      const before = pages.map((p) => p.ws.length);
      console.log(`[cut] ${stage}: cut ${n} open connection(s)`);
      const t0 = Date.now();
      await waitFor(() => pages.every((p, i) => p.ws.length > before[i]), 10000, `${stage}: every page reconnected`).catch(() => null);
      const took = Date.now() - t0;
      const again = pages.every((p, i) => p.ws.length > before[i]);
      check(again, `${stage}: every page opened a new websocket within ${took} ms`, pages.map((p) => p.ws.length));
      check(pages.every((p) => p.ws[p.ws.length - 1].includes('transport=websocket')), `${stage}: the new connections are websocket`);
      await sleep(800);
      for (const ph of phones) {
        const i = await pinfo(ph);
        check(i.id === ph.id, `${stage}: ${ph.label} is the same player after the cut`, { before: ph.id, after: i.id });
      }
      const st = await hs();
      check(st.players.length === 2 && st.players.every((p) => p.connected !== false), `${stage}: the TV still lists 2 connected players`, st.players.map((p) => [p.name, p.connected]));
      const h = await healthz();
      check(h.players === 2 && h.rooms === 1, `${stage}: server has 1 room, 2 players (no duplicates)`, h);
      return took;
    }

    // ── cut 1: in the lobby ──
    await afterCut('lobby', cutAll());
    await Promise.all(pages.map((p) => p.page.screenshot({ path: path.join(OUT, `1-lobby-after-cut-${p.label}.png`) })));

    // ── a tap round; cut 2 mid-round ──
    await host.click('[data-testid=game-tap]', { force: true });
    await host.waitForFunction(() => window.__host.state().phase === 'playing', null, { timeout: 20000 });
    const tapping = { on: true };
    const drivers = phones.map((ph) =>
      (async () => {
        while (tapping.on) {
          try {
            const f = await ph.page.evaluate(() => (window.__tap ? window.__tap() : null));
            if (f) await ph.page.touchscreen.tap(f.x, f.y);
          } catch {
            /* navigation or a frozen moment */
          }
          await sleep(90);
        }
      })(),
    );
    await sleep(5000);
    for (const ph of phones) ph.beforeCut = (await pinfo(ph)).score;
    check(phones.every((p) => p.beforeCut > 0), 'both phones scored before the cut', phones.map((p) => p.beforeCut));
    const took = await afterCut('mid-round', cutAll());
    for (const ph of phones) {
      const i = await pinfo(ph);
      check(i.screen === 'playing', `mid-round: ${ph.label} is still in the game after the cut (${i.screen})`);
      check(i.score >= ph.beforeCut, `mid-round: ${ph.label} kept its score (${ph.beforeCut} -> ${i.score})`);
    }
    await Promise.all(pages.map((p) => p.page.screenshot({ path: path.join(OUT, `2-midround-after-cut-${p.label}.png`) })));
    check(took < 5000, `mid-round: reconnect took ${took} ms (< 5 s)`);
    await sleep(3000);
    for (const ph of phones) ph.later = (await pinfo(ph)).score;
    check(phones.every((p) => p.later > p.beforeCut), 'scores keep rising after the reconnect', phones.map((p) => [p.beforeCut, p.later]));

    await host.waitForFunction(() => window.__host.state().phase === 'results', null, { timeout: 60000 });
    tapping.on = false;
    await Promise.all(drivers);
    const res = (await hs()).results;
    for (const ph of phones) {
      const row = res.rows.find((r) => r.playerId === ph.id);
      const i = await pinfo(ph);
      check(row && row.raw >= ph.later, `${ph.label}: the server's round score includes the taps from before and after the cut (${row && row.raw})`);
      check(row && i.endedRound === res.roundIndex && i.endedScore === row.raw, `${ph.label}: server raw = the phone's final score`, { phone: i.endedScore, server: row && row.raw });
    }

    // ── cut 3: during the results (the winner reveal is server-timed) ──
    await afterCut('results', cutAll());
    await sleep(9000);
    const screens = await Promise.all(phones.map((ph) => pinfo(ph).then((i) => i.screen)));
    check(screens.every((s) => ['win', 'reveal', 'results'].includes(s)), `results: phones reach the reveal after the cut (${screens.join(', ')})`);
    check(await tvConnected(), 'TV shows no offline banner');
    await Promise.all(pages.map((p) => p.page.screenshot({ path: path.join(OUT, `3-results-after-cut-${p.label}.png`) })));

    check(pages.every((p) => p.polling === 0), 'no page ever fell back to long-polling', pages.map((p) => [p.label, p.polling]));
    check(errs.length === 0, 'no page errors', errs);
  } catch (e) {
    check(false, 'run crashed: ' + e.message);
  } finally {
    await browser.close();
    proxy.close();
  }
  console.log(`\n${failures.length === 0 ? 'ALL OK' : 'FAILED'} (${passed} ok, ${failures.length} failed, ${accepted} TCP connections through the proxy), screenshots in ${OUT}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
