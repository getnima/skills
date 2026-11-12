// Plotzel in the real flow: a TV host page and three phones (iPhone SE, iPhone 13, Pixel 7)
// play the builtin word game on the server. Every phone solves -> the round ends early;
// one phone reloads mid-round and resumes its rows; the server's raw scores equal the phones'.
//
//   PARTY_SERVER_PORT=8823 PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=60000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8823 PARTY_CLIENT_PORT=5223 npx vite
//   node tests/e2e/qa-plotzel-flow.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.PZ_BASE || 'http://localhost:5223';
const OUT = path.join(__dirname, 'out', 'qa-plotzel', 'flow');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
let passed = 0;
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (ok) passed++;
  else fails.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c] || c;
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
const screen = (page) => page.evaluate(() => (window.__player ? window.__player.screen : null));
const live = (page) => page.evaluate(() => !!window.__playerPlay && window.__playerPlay.frozen === false);

async function typeWord(page, word) {
  for (const ch of Array.from(word)) await page.locator(`.pz-key[data-k="${norm(ch)}"]`).tap();
  await page.locator('.pz-key[data-k="ENTER"]').tap();
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const host = await hostCtx.newPage();
  host.on('pageerror', (e) => errors.push('host ' + e.message));
  const hs = () => host.evaluate(() => (window.__host ? window.__host.state() : null));
  try {
    await host.goto(`${BASE}/host.html`);
    await host.evaluate(() => localStorage.clear());
    await host.goto(`${BASE}/host.html`);
    await host.waitForSelector('[data-testid=room-code]', { timeout: 15000 });
    await sleep(500);
    const code = (await host.textContent('[data-testid=room-code]')).trim();
    const shown = (await host.textContent('[data-testid=join-url]')).trim();
    const join = new URL(/^https?:/.test(shown) ? shown : 'http://' + shown);

    const spec = [
      ['se', devices['iPhone SE'], 'רוני'],
      ['i13', devices['iPhone 13'], 'שירה'],
      ['pixel', devices['Pixel 7'], 'עומר'],
    ];
    const phones = [];
    for (const [label, device, name] of spec) {
      const ctx = await browser.newContext({ ...device });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${label} ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${label} ${m.text()}`);
      });
      await page.goto(`${BASE}${join.pathname}${join.search}&plotzel=builtin`);
      await waitFor(async () => (await screen(page)) === 'join', 15000, `${label} join`);
      await page.fill('.pp-name-input', name);
      await page.locator('.pp-btn-go').tap();
      await waitFor(async () => (await screen(page)) === 'lobby', 10000, `${label} lobby`);
      phones.push({ label, page, id: await page.evaluate(() => window.__player.snap.playerId) });
    }
    check(`room ${code}: 3 phones joined`, (await hs()).players.length === 3);

    await host.click('[data-testid=game-plotzel]', { force: true });
    await waitFor(async () => (await hs()).phase === 'playing', 20000, 'playing');
    const round = (await hs()).round;
    const durationMs = round.endAt - round.startAt;
    await Promise.all(phones.map((p) => waitFor(() => live(p.page), 10000, `${p.label} live`)));
    const answer = await phones[0].page.evaluate(async (seed) => (await import('/src/games/plotzel/logic.ts')).pickAnswer(seed), round.seed);
    const same = await Promise.all(phones.map((p) => p.page.evaluate(async (seed) => (await import('/src/games/plotzel/logic.ts')).pickAnswer(seed), round.seed)));
    check('every phone has the same word for the round seed', same.every((w) => w === answer), { answer, same });
    const wrong = ['שולחן', 'מכונה', 'ספרים'].find((w) => w !== answer);

    // phone 1: wrong, answer. phone 2: answer at once. phone 3: wrong, RELOAD, then the answer.
    const p1 = (async () => {
      await typeWord(phones[0].page, wrong);
      await sleep(1600);
      await typeWord(phones[0].page, answer);
    })();
    const p2 = (async () => {
      await sleep(800);
      await typeWord(phones[1].page, answer);
    })();
    const p3 = (async () => {
      const page = phones[2].page;
      await typeWord(page, wrong);
      await sleep(1700);
      const before = await page.evaluate(() => document.querySelectorAll('.pz-row')[0].textContent);
      await page.reload();
      await waitFor(async () => (await screen(page)) === 'playing' && (await page.locator('.pz-key').count()) > 0, 15000, 'pixel back in the game');
      await sleep(500);
      const after = await page.evaluate(() => ({ row0: document.querySelectorAll('.pz-row')[0].textContent, cur: document.querySelectorAll('.pz-row')[1].classList.contains('is-current') }));
      check('a phone reloaded mid-round resumes its rows', after.row0 === before && after.cur, { before, after });
      await page.screenshot({ path: path.join(OUT, 'pixel-after-reload.png') });
      await typeWord(page, answer);
    })();
    await Promise.all([p1, p2, p3]);
    await sleep(700);
    await Promise.all(phones.map((p) => p.page.screenshot({ path: path.join(OUT, `${p.label}-solved.png`) })));
    const solvedAt = Date.now();
    await waitFor(async () => (await hs()).phase === 'results', 9000, 'results after everyone solved').catch(() => null);
    const st = await hs();
    const leftAtEnd = round.endAt - (await host.evaluate(() => window.__host.now()));
    check('3 phones finished -> the round ends early', st.phase === 'results' && leftAtEnd > durationMs / 3, { phase: st.phase, leftAtEndMs: Math.round(leftAtEnd), waitedMs: Date.now() - solvedAt });
    await host.screenshot({ path: path.join(OUT, 'host-results.png') });
    if (st.results) {
      const raws = st.results.rows.map((r) => [r.name, r.raw]);
      check('every phone scored a solve (500..1500)', st.results.rows.every((r) => r.raw >= 500 && r.raw <= 1500), raws);
      const r2 = st.results.rows.find((r) => r.playerId === phones[1].id);
      check('the one-try solver is the round winner', !!r2 && st.results.winnerIds.includes(phones[1].id), { raws, winners: st.results.winnerIds });
    }
  } catch (e) {
    check('flow ran', false, String(e.message).slice(0, 300));
  } finally {
    check('no page errors', errors.length === 0, errors.slice(0, 5));
    await browser.close();
  }
  console.log(fails.length ? `\n${passed} ok, ${fails.length} FAILED:\n  ${fails.join('\n  ')}` : `\nall ${passed} ok`);
  process.exit(fails.length ? 1 : 0);
})();
