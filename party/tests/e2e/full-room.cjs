// full-room: the TV with a full room. A real host page at 1920x1080 and 30 playing
// bots (tests/load/bots.ts --play) go through three rounds and the podium; screenshots
// of the lobby, the intro, the live race, the results reveal and the podium.
//
//   PORT=8809 PARTY_TEST_DURATION_MS=15000 node dist/server/index.mjs      (real intro / countdown, 15s games)
//   BASE_URL=http://localhost:8809 HOST_PATH=/host node tests/e2e/full-room.cjs
//
// Env: BASE_URL (client), SERVER_URL (socket server for the bots, default BASE_URL), HOST_PATH, PLAYERS (30), ROUNDS (3).
// Screenshots: tests/e2e/out/full-room/. Exit code 1 on a failed check.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BASE = (process.env.BASE_URL || 'http://localhost:8809').replace(/\/+$/, '');
const SERVER = process.env.SERVER_URL || BASE;
const HOST_PATH = process.env.HOST_PATH || '/host';
const PLAYERS = Number(process.env.PLAYERS || 30);
const ROUNDS = Number(process.env.ROUNDS || 3);
const OUT = path.join(__dirname, 'out', 'full-room');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg, extra) => {
  console.log(ok ? '  ok  ' : '  FAIL', msg, !ok && extra !== undefined ? JSON.stringify(extra) : '');
  if (!ok) failures.push(msg);
};

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/\/cutscenes\//.test(m.location().url || '')) errors.push(m.text());
  });
  let n = 0;
  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
    const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight }));
    check(s.sw <= s.w && s.sh <= s.h, `no scroll: ${name}`, s);
  };
  const st = () => page.evaluate(() => window.__host.state());
  const waitPhase = (p, ms = 40000) => page.waitForFunction((x) => window.__host && window.__host.state() && window.__host.state().phase === x, p, { timeout: ms });
  let bots = null;
  try {
    await page.goto(BASE + HOST_PATH);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + HOST_PATH);
    await page.waitForSelector('[data-testid=room-code]', { timeout: 15000 });
    const code = (await page.textContent('[data-testid=room-code]')).trim();
    await page.mouse.click(960, 60);
    bots = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', String(PLAYERS), '--play', '--prefix', 'אורח', '--quiet'], { cwd: ROOT, stdio: 'ignore', detached: true });
    await page.waitForFunction((k) => window.__host.state().players.length >= k, PLAYERS, { timeout: 30000 });
    await sleep(1200);
    await shot('lobby-full');
    const fit = await page.evaluate(() => { const el = document.querySelector('[data-testid=chips]'); return { sh: el.scrollHeight, ch: el.clientHeight }; });
    check(fit.sh <= fit.ch + 1, `${PLAYERS} player chips fit in the lobby`, fit);

    for (let r = 0; r < ROUNDS; r++) {
      await page.click('[data-testid=btn-primary]', { force: true });
      await waitPhase('intro');
      await sleep(2500);
      if (r === 0) await shot('intro');
      await waitPhase('countdown');
      await sleep(400);
      if (r === 0) await shot('countdown');
      await waitPhase('playing');
      const game = (await st()).round.gameId;
      await sleep(3500);
      await shot(`race-${game}-a`);
      await sleep(2500);
      await shot(`race-${game}-b`);
      await waitPhase('results', 120000);
      const res = (await st()).results;
      // the bots include a few deliberate zero-scorers
      check(res.rows.length === PLAYERS && res.rows.filter((x) => x.raw > 0).length >= PLAYERS * 0.8 && res.winnerIds.length === 1, `${game}: ${PLAYERS} rows, exactly one winner`);
      {
        const scorers = res.rows.filter((x) => x.raw > 0).sort((x, y) => x.roundRank - y.roundRank);
        check(res.rows.every((x, k) => x.rank === k + 1) && scorers.every((x, k) => k === 0 || (x.points < scorers[k - 1].points && x.raw <= scorers[k - 1].raw)), `${game}: ranks 1..${PLAYERS}, points strictly decreasing among scorers`);
      }
      await sleep(Math.max(0, res.revealAt - 3000 - (await page.evaluate(() => window.__host.now()))));
      await shot(`results-${game}-suspense`);
      await page.waitForSelector('.sh-cer-name', { timeout: 15000 });
      await sleep(3600);
      await shot(`results-${game}-ceremony`);
      check((await page.evaluate(() => window.__partyMusic.started.filter((x) => x === 'victory').length)) === r + 1, `${game}: victory song started`);
      await page.waitForSelector('.sh-results--standings', { timeout: 20000 });
      await sleep(2600);
      await shot(`results-${game}-standings-a`);
      await sleep(6500);
      await shot(`results-${game}-standings-b`);
      await page.click('[data-testid=btn-primary]', { force: true });
      await waitPhase('lobby');
    }
    await sleep(1200);
    await shot('lobby-between');
    await page.click('[data-testid=btn-final]', { force: true });
    await waitPhase('final');
    await page.waitForFunction(() => window.__host.state().cutscene === null, null, { timeout: 15000 });
    for (const [name, ms] of [['podium-a', 3000], ['podium-b', 4500], ['podium-c', 6000], ['podium-d', 7000]]) {
      await sleep(ms);
      await shot(name);
    }
    check(errors.length === 0, 'no console errors on the host', errors.slice(0, 8));
  } catch (e) {
    failures.push('flow: ' + e.message);
    console.error(e);
    await shot('ERROR').catch(() => {});
  } finally {
    if (bots) try { process.kill(-bots.pid, 'SIGKILL'); } catch {}
    await browser.close();
  }
  console.log(failures.length ? `\nFAILED:\n - ${failures.join('\n - ')}` : '\nALL OK');
  process.exit(failures.length ? 1 : 0);
})();
