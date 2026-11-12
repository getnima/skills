// Phone app end to end: a raw socket.io host drives a real server (PARTY_TEST_FAST=1)
// while emulated phones (iPhone 14, Pixel 7, a 360x640 Pixel) play through every screen.
//
//   PORT=8802 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8802 PARTY_CLIENT_PORT=5202 npx vite
//   node tests/e2e/phone-flow.cjs
//
// Screenshots: tests/e2e/out/phone/. Exit code 1 when an assertion failed.
// The dressing-room step (tests/e2e/dress-lib.cjs): the iPhone goes through the real one
// (its URL carries dress=1); the other phones rely on the test switch (an automated browser
// skips the step) and land on the waiting screen right after the join.
const { chromium, devices } = require('playwright');
const { io } = require('socket.io-client');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const DRESS = require('./dress-lib.cjs');

const SERVER = process.env.SERVER_URL || 'http://localhost:8802';
const CLIENT = process.env.CLIENT_URL || 'http://localhost:5202';
const OUT = path.join(__dirname, 'out', 'phone');
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const log = (...a) => console.log('[phone]', ...a);
function check(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.log('  ✗', msg);
  } else console.log('  ✓', msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────── host (raw socket) ─────────
function createHost() {
  const s = io(SERVER, { transports: ['websocket'] });
  let state = null;
  s.on('state', (st) => (state = st));
  // a look change comes as a small `looks` message, not as a whole state
  s.on('looks', (msg) => {
    if (state === null) return;
    for (const [id, look] of msg.looks) {
      const p = state.players.find((x) => x.id === id);
      if (p) p.look = look;
    }
  });
  const call = (ev, req) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ack timeout ' + ev)), 5000);
      s.emit(ev, req, (res) => {
        clearTimeout(t);
        if (!res.ok) reject(new Error(ev + ': ' + res.error + ' ' + res.message));
        else resolve(res);
      });
    });
  return { socket: s, call, state: () => state };
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(60);
  }
  throw new Error('timeout: ' + label);
}

// ───────── phone helpers ─────────
async function screen(page) {
  try {
    return await page.evaluate(() => (window.__player ? window.__player.screen : null));
  } catch {
    return null;
  }
}
async function waitScreen(page, name, ms = 15000) {
  try {
    await waitFor(async () => (await screen(page)) === name, ms, '');
  } catch {
    throw new Error(`timeout: ${page.__name} screen ${name} (now ${await screen(page)})`);
  }
}

/** Screenshot + no-scroll + nothing outside the viewport (except scroll lists / decorations). */
async function shot(page, name) {
  const file = path.join(OUT, `${page.__name}-${name}.png`);
  await page.screenshot({ path: file });
  const m = await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const out = [];
    for (const el of document.querySelectorAll('#app *')) {
      if (el.closest('.kit-scroll, .pp-confetti, .pp-rays, .pp-spot, .pa-stage, .pp-tv-legs, .pp-me-glow, .pp-prize-shine')) continue;
      if (el.children.length > 0 && !/^(BUTTON|INPUT)$/.test(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`${el.tagName}.${el.className} "${(el.textContent || '').slice(0, 20)}" ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    return { sh: se.scrollHeight, sw: se.scrollWidth, H, W, sy: window.scrollY, clipped: out };
  });
  check(m.sh <= m.H && m.sw <= m.W && m.sy === 0, `${page.__name}/${name}: no page scroll (${m.sw}x${m.sh} in ${m.W}x${m.H})`);
  check(m.clipped.length === 0, `${page.__name}/${name}: nothing clipped ${m.clipped.slice(0, 3).join(' | ')}`);
  return file;
}

async function openPhone(browser, name, device, extra = {}) {
  const ctx = await browser.newContext({ ...device, ...extra });
  const page = await ctx.newPage();
  page.__name = name;
  page.__ctx = ctx;
  page.on('pageerror', (e) => failures.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [${name} console]`, m.text());
  });
  return page;
}

async function join(page, code, name) {
  await page.goto(`${CLIENT}/?room=${code}`);
  await waitScreen(page, 'join');
  await page.fill('.pp-name-input', name);
  await page.click('.pp-btn-go');
  await waitScreen(page, 'lobby');
}

async function tapGame(page, n) {
  const vp = page.viewportSize();
  for (let i = 0; i < n; i++) await page.mouse.click(vp.width / 2 + ((i * 37) % 80) - 40, vp.height * 0.55);
}

async function playState(page) {
  return page.evaluate(() => {
    const p = window.__playerPlay;
    return p ? { score: p.stageScore, leftMs: p.leftMs, frozen: p.frozen, hud: document.querySelector('.pa-hud-num')?.textContent, secs: document.querySelector('.pa-hud-secs')?.textContent } : null;
  });
}

function spawnBots(code, players, mode, prefix) {
  const child = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', String(players), mode, '--prefix', prefix, '--quiet'], {
    cwd: path.join(__dirname, '../..'),
    stdio: 'ignore',
    detached: true,
  });
  return () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  };
}

(async () => {
  const browser = await chromium.launch();
  const host = createHost();
  const created = await host.call('host:create', {});
  const code = created.code;
  log('room', code);
  const killers = [];

  try {
    const A = await openPhone(browser, 'iphone14', devices['iPhone 14']);
    const B = await openPhone(browser, 'pixel7', devices['Pixel 7']);
    const C = await openPhone(browser, 'small360', devices['Pixel 7'], { viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 } });

    // ── join: empty, typed, errors ──
    await A.goto(DRESS.withDressing(`${CLIENT}/?room=${code}`));
    await waitScreen(A, 'join');
    await sleep(900); // the cover dolls are composed
    await shot(A, '01-join-empty');
    check((await A.locator('.pp-code-input').count()) === 0, 'code from URL is shown, not editable');
    await A.fill('.pp-name-input', 'דנה');
    await shot(A, '02-join-typed');
    const fontSize = await A.$eval('.pp-name-input', (e) => parseFloat(getComputedStyle(e).fontSize));
    check(fontSize >= 16, `name field font ${fontSize}px >= 16`);
    const attrs = await A.$eval('.pp-name-input', (e) => [e.getAttribute('autocapitalize'), e.getAttribute('enterkeyhint'), e.getAttribute('maxlength')]);
    // maxlength is a loose cap in UTF-16 units (8 per visible character: a family emoji); the real cut is in graphemes
    check(attrs[0] === 'off' && attrs[1] === 'go' && attrs[2] === '112', `name field attrs ${attrs}`);

    // errors on the small phone: unknown room, then empty name
    await C.goto(`${CLIENT}/?room=ZZZZ`);
    await waitScreen(C, 'join');
    await C.fill('.pp-name-input', 'יוסי');
    await C.click('.pp-btn-go');
    await waitFor(async () => (await C.locator('.pp-error').count()) > 0, 8000, 'room error');
    check((await C.locator('.pp-code-input').count()) === 1, 'unknown room makes the code editable');
    await shot(C, '01-join-error-room');
    await C.fill('.pp-code-input', code.toLowerCase());
    await C.fill('.pp-name-input', '');
    await C.click('.pp-btn-go');
    await sleep(300);
    await shot(C, '02-join-error-name');
    // keyboard open: the visual viewport shrinks to ~half; the field and the button stay visible
    await C.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
    await sleep(300);
    await C.setViewportSize({ width: 360, height: 330 });
    await C.focus('.pp-name-input');
    await sleep(300);
    const kb = await C.evaluate(() => {
      const r1 = document.querySelector('.pp-name-input').getBoundingClientRect();
      const r2 = document.querySelector('.pp-btn-go').getBoundingClientRect();
      return { field: r1.bottom <= innerHeight && r1.top >= 0, btn: r2.bottom <= innerHeight && r2.top >= 0 };
    });
    check(kb.field && kb.btn, `keyboard-height layout keeps field + button visible ${JSON.stringify(kb)}`);
    await shot(C, '03-join-keyboard');
    await C.setViewportSize({ width: 360, height: 640 });

    // A joins: first the dressing room (the real flow), then the lobby alone
    await A.click('.pp-btn-go');
    await DRESS.waitDressing(A);
    await sleep(1200);
    await A.screenshot({ path: path.join(OUT, `${A.__name}-02b-dressing.png`) });
    const dressedLook = await DRESS.tapItem(A, 'HEAD', 2);
    await DRESS.finishDressing(A);
    await sleep(700);
    check((await A.evaluate(() => document.querySelector('.pw-me-doll')?.dataset.look)) === dressedLook, `the waiting room shows the doll dressed in the dressing room (${dressedLook})`);
    await waitFor(() => host.state() && host.state().players[0] && host.state().players[0].look === dressedLook, 3000, 'the host hears the look');
    await shot(A, '03-lobby-alone');
    const idA = await A.evaluate(() => window.__player.snap.playerId);

    // C fixes its name and joins, B joins
    await C.fill('.pp-name-input', 'יוסי');
    await C.click('.pp-btn-go');
    await waitScreen(C, 'lobby');
    await join(B, code, 'מיכל הגדולה');

    // 12 others
    killers.push(spawnBots(code, 12, '--hold', 'אורח'));
    await waitFor(() => host.state() && host.state().players.length >= 15, 15000, '12 bots');
    await sleep(800);
    await shot(A, '04-lobby-12-others');
    await shot(C, '04-lobby-12-others');

    // reload in the lobby: same player, silently
    await A.reload();
    await waitScreen(A, 'lobby');
    const idA2 = await A.evaluate(() => window.__player.snap.playerId);
    check(idA === idA2, 'reload in lobby resumes as the same player');
    check(host.state().players.length === 15, `no duplicate player after reload (${host.state().players.length})`);

    // ── round 1: tap ──
    await host.call('host:start', { gameId: 'tap' });
    await waitScreen(A, 'intro');
    await shot(A, '05-intro');
    await shot(C, '05-intro');
    await waitScreen(A, 'countdown');
    await waitFor(() => A.evaluate(() => { const n = document.querySelector('.pp-cd-num'); return n && getComputedStyle(n).opacity === '1'; }), 3000, 'countdown digit');
    await shot(A, '06-countdown');
    await waitScreen(A, 'playing');
    await sleep(1000);
    await tapGame(A, 40);
    await tapGame(B, 15);
    await tapGame(C, 6);
    await shot(A, '07-playing');

    // reload mid-round (C)
    const cBefore = await playState(C);
    await C.reload();
    await waitScreen(C, 'playing');
    await sleep(600);
    const cAfter = await playState(C);
    // In fast test rounds the automatic tap_freeze video can already be on (shared/cutscenes.ts: 8 s of a
    // 53 s round, scaled): then the clock stands still and the reload must land on exactly the same time.
    check(
      cAfter && cAfter.leftMs > 0 && (cAfter.leftMs < cBefore.leftMs || (cBefore.frozen && cAfter.frozen && cAfter.leftMs === cBefore.leftMs)),
      `reload mid-round keeps the round clock (${cBefore.leftMs}${cBefore.frozen ? ' frozen' : ''} → ${cAfter && cAfter.leftMs}${cAfter && cAfter.frozen ? ' frozen' : ''})`,
    );
    await tapGame(C, 3);
    await shot(C, '07-playing-after-reload');

    // the automatic mid-game cutscene (tap_freeze at the scaled half)
    await waitFor(() => host.state().cutscene !== null, 12000, 'mid-game cutscene');
    await sleep(400);
    const frozenA = await playState(A);
    await tapGame(A, 10); // must do nothing while frozen
    await shot(A, '08-cutscene-midgame');
    await shot(C, '08-cutscene-midgame');
    const frozenA2 = await playState(A);
    check(frozenA.frozen && frozenA2.score === frozenA.score && frozenA2.leftMs === frozenA.leftMs, `frozen: score/time stand still (${frozenA.score}/${frozenA.leftMs} → ${frozenA2.score}/${frozenA2.leftMs})`);
    check(await A.evaluate(() => window.__player.cutscene), 'cutscene overlay flag');
    // reload during the cutscene (B)
    await B.reload();
    await waitFor(async () => (await B.evaluate(() => window.__player && window.__player.cutscene)) === true, 8000, 'B cutscene after reload');
    await shot(B, '08-cutscene-after-reload');
    await sleep(1200);
    const frozenA3 = await playState(A);
    check(frozenA3.leftMs === frozenA.leftMs, 'time left unchanged through the whole cutscene');
    await host.call('host:cutsceneEnd', {});
    await waitFor(async () => (await A.evaluate(() => window.__player.resuming)) === true, 3000, 'resume 3-2-1');
    await sleep(200);
    await shot(A, '09-resume-321');
    const resA = await playState(A);
    check(resA.score === frozenA.score && resA.leftMs === frozenA.leftMs && resA.frozen, `resume: same score + time left (${resA.score}/${resA.leftMs})`);
    await waitFor(async () => !(await playState(A)).frozen, 5000, 'play continues');
    const goA = await playState(A);
    check(goA.leftMs <= frozenA.leftMs && goA.leftMs > frozenA.leftMs - 1500, `continues exactly where it stopped (${frozenA.leftMs} → ${goA.leftMs})`);
    await tapGame(A, 30);
    await tapGame(B, 10);
    await shot(B, '09-playing-after-cutscene');

    // end of round: sending → suspense → win / reveal → results
    await waitScreen(A, 'sending', 15000);
    await shot(A, '10-sending');
    await waitScreen(A, 'suspense', 8000);
    await shot(A, '11-suspense');
    await waitScreen(B, 'suspense', 8000);
    await waitScreen(A, 'win', 15000);
    await sleep(1600);
    await shot(A, '12-win');
    await waitScreen(B, 'reveal', 4000);
    await sleep(600);
    await shot(B, '12-reveal-nonwinner');
    const res = host.state().results;
    check(res.winnerIds.length === 1 && res.winnerIds[0] === idA, 'iPhone player won round 1');
    // reload after revealAt goes straight to the results
    await C.reload();
    await waitFor(async () => ['results'].includes(await screen(C)), 8000, 'C straight to results');
    await sleep(1800);
    await shot(C, '13-results');
    await A.click('.pp-btn-ghost'); // "my results"
    await waitScreen(A, 'results', 3000);
    await sleep(1800);
    await shot(A, '13-results');
    await waitScreen(B, 'results', 8000);
    await sleep(1500);
    await shot(B, '13-results');

    // lobby with standings
    await host.call('host:lobby', {});
    await waitScreen(A, 'lobby');
    await sleep(600);
    await shot(A, '14-lobby-standings');
    await shot(C, '14-lobby-standings');

    // ── round 2 with playing bots, a disconnect, a late joiner ──
    killers.push(spawnBots(code, 10, '--play', 'בוט'));
    await waitFor(() => host.state().players.length >= 25, 15000, 'play bots');
    await host.call('host:start', { gameId: 'flappy' });
    await waitScreen(A, 'intro');
    const D = await openPhone(browser, 'late', devices['Pixel 7']);
    // joins during the intro: lands on the late screen, not in the game
    await D.goto(`${CLIENT}/?room=${code}`);
    await waitScreen(D, 'join');
    await D.fill('.pp-name-input', 'מאחרת');
    await D.click('.pp-btn-go');
    await waitFor(async () => (await screen(D)) === 'late', 8000, 'late screen');
    await shot(D, '01-late-joiner');
    await waitScreen(B, 'playing', 10000);
    await sleep(700);
    await tapGame(B, 5);
    await B.__ctx.setOffline(true);
    await waitFor(async () => (await B.evaluate(() => window.__player.banner)) === true, 30000, 'reconnect banner');
    await tapGame(B, 5);
    await sleep(400);
    await shot(B, '15-reconnecting-banner');
    check((await screen(B)) === 'playing', 'game keeps running while offline');
    await B.__ctx.setOffline(false);
    await waitFor(async () => (await B.evaluate(() => window.__player.banner)) === false, 20000, 'banner gone');
    log('B back online');
    await waitScreen(A, 'suspense', 20000).catch(() => {});
    await waitFor(() => host.state().phase === 'results', 20000, 'round 2 results');
    const r2 = host.state().results;
    const rowB = r2.rows.find((r) => r.name.startsWith('מיכל'));
    check(rowB && rowB.raw >= 5, `B's score made it after reconnect (raw ${rowB && rowB.raw})`);
    await sleep(9000);

    // ── kick ──
    const idD = await D.evaluate(() => window.__player.snap.playerId);
    await host.call('host:kick', { playerId: idD });
    await waitScreen(D, 'kicked', 5000);
    await sleep(500);
    await shot(D, '02-kicked');

    // ── final ──
    await host.call('host:final', {});
    await waitFor(() => host.state().cutscene !== null, 5000, 'podium cutscene').catch(() => {});
    if (host.state().cutscene) {
      await sleep(500);
      await shot(A, '16-cutscene-before-podium');
      await host.call('host:cutsceneEnd', {});
    }
    await waitScreen(A, 'final');
    await sleep(1800);
    await shot(A, '17-final');
    await shot(B, '17-final');
    await shot(C, '17-final');
    const places = await Promise.all([A, B, C].map((p) => p.evaluate(() => document.querySelector('.pp-final-place')?.textContent)));
    log('final places', places);

    // ── room closed ──
    const E = await openPhone(browser, 'closed', devices['iPhone 14']);
    await E.goto(`${CLIENT}/`);
    await E.evaluate(() => localStorage.setItem('party.player.QQQQ', JSON.stringify({ playerId: 'x', secret: 'y', name: 'רוני', lateRound: null })));
    await E.goto(`${CLIENT}/?room=QQQQ`);
    await waitScreen(E, 'closed', 8000);
    await shot(E, '01-room-closed');
  } catch (err) {
    failures.push('flow: ' + err.message);
    console.error(err);
  } finally {
    for (const k of killers) k();
    host.socket.close();
    await browser.close();
  }
  console.log(failures.length ? `\nFAILED (${failures.length}):\n - ${failures.join('\n - ')}` : '\nALL OK');
  process.exit(failures.length ? 1 : 0);
})();
