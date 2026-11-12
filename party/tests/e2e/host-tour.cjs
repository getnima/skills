// host-tour: drive the TV host page through a whole competition against the real
// server (PARTY_TEST_FAST=1) with bots, and take screenshots of every screen.
//   PORT=8803 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8803 PARTY_CLIENT_PORT=5203 npx vite
//   node tests/e2e/host-tour.cjs
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out/host');
const HOST = process.env.HOST_URL || 'http://localhost:5203/host.html';
const SERVER = process.env.SERVER_URL || 'http://localhost:8803';
fs.mkdirSync(OUT, { recursive: true });

const bots = [];
function addBots(code, n, prefix, mode = '--play') {
  const p = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', String(n), mode, '--prefix', prefix, '--quiet'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  bots.push(p);
  return p;
}
function killBots(p) {
  try {
    process.kill(-p.pid, 'SIGKILL');
  } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const st = () => page.evaluate(() => window.__host && window.__host.state());
  const left = () =>
    page.evaluate(() => {
      const s = window.__host.state();
      const r = s && s.round;
      if (!r) return null;
      const now = window.__host.now();
      let t = now;
      if (r.frozenAt !== null) t = r.frozenAt;
      else if (r.resumeAt !== null && now < r.resumeAt) t = r.resumeAt;
      return Math.max(0, r.endAt - t);
    });
  const noScroll = async (label) => {
    const s = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      bw: document.body.scrollWidth,
      bh: document.body.scrollHeight,
      w: innerWidth,
      h: innerHeight,
    }));
    check(`no scroll: ${label}`, s.sw <= s.w && s.sh <= s.h && s.bw <= s.w && s.bh <= s.h, s);
  };
  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  };
  const waitPhase = async (phase, timeout = 20000) => {
    await page.waitForFunction((p) => window.__host && window.__host.state() && window.__host.state().phase === p, phase, { timeout });
  };
  const waitCut = async (on, timeout = 20000) => {
    await page.waitForFunction((v) => !!(window.__host.state() && window.__host.state().cutscene) === v, on, { timeout });
  };
  const chips = () => page.locator('[data-testid=chip]').count();
  const waitChips = async (n) => {
    await page.waitForFunction((k) => document.querySelectorAll('[data-testid=chip]').length >= k, n, { timeout: 20000 });
    await sleep(900);
  };

  try {
    // fresh room
    await page.goto(HOST);
    await page.evaluate(() => localStorage.clear());
    await page.goto(HOST);
    await page.waitForSelector('[data-testid=room-code]');
    await sleep(1000);
    const code = (await page.textContent('[data-testid=room-code]')).trim();
    check('room code', /^[A-Z0-9]{4}$/.test(code), code);
    await shot('01-lobby-0');
    await noScroll('lobby 0');

    // the lobby fills up
    addBots(code, 3, 'נועה');
    await waitChips(3);
    await page.mouse.click(960, 8); // unlock audio (an empty strip of the stage: the middle of the lobby holds the guests)
    await shot('02-lobby-3');
    const b14 = addBots(code, 11, 'איתי');
    await waitChips(14);
    await shot('03-lobby-14');
    const b45 = addBots(code, 31, 'שירה', '--hold');
    await waitChips(45);
    await shot('04-lobby-45');
    await noScroll('lobby 45');
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=chips]');
      return { sh: el.scrollHeight, ch: el.clientHeight };
    });
    check('45 chips fit', overflow.sh <= overflow.ch + 1, overflow);
    killBots(b45); // they go dim (disconnected), stay in the room
    await page.waitForFunction(() => window.__host.state().players.filter((p) => !p.connected).length >= 31, null, { timeout: 30000 });
    await sleep(600);
    await shot('05-lobby-45-dimmed');

    // ── round 1: tap, with the automatic tap_freeze cutscene in the middle ──
    await page.keyboard.press('Space');
    await waitPhase('intro');
    await sleep(500);
    await shot('10-intro');
    await waitPhase('countdown');
    await sleep(250);
    await shot('11-countdown');
    await waitPhase('playing');
    await sleep(150);
    await shot('12-playing-go');
    await sleep(1700);
    await shot('13-playing-a');
    await sleep(2200);
    await shot('14-playing-b');
    // tap_freeze fires at 6s of a 12s round (30s of 60s, scaled)
    await waitCut(true, 10000);
    const s1 = await st();
    check('auto cutscene is tap_freeze', s1.cutscene.id === 'tap_freeze', s1.cutscene);
    const leftAtFreeze = await left();
    await page.waitForFunction(() => {
      const v = document.querySelector('[data-testid=cutscene-video]');
      return v && v.currentTime > 1;
    }, null, { timeout: 8000 });
    await shot('15-auto-cutscene-video');
    const src1 = await page.getAttribute('[data-testid=cutscene-video]', 'data-src');
    check('auto cutscene plays a real file', /tap_freeze\.(webm|mp4)/.test(src1), src1);
    await waitCut(false, 15000);
    await sleep(300);
    await shot('16-resume-321');
    check('resume overlay visible', (await page.locator('[data-testid=resume]').count()) === 1);
    const leftAfter = await left();
    check('same time left after the auto cutscene', Math.abs(leftAfter - leftAtFreeze) < 50, { leftAtFreeze, leftAfter });
    await page.waitForFunction(() => document.querySelector('[data-testid=resume]') === null, null, { timeout: 6000 });
    await sleep(1500);
    await shot('17-playing-after-resume');

    // results
    await waitPhase('results', 20000);
    await sleep(1200);
    await shot('20-results-suspense');
    const res = (await st()).results;
    const toReveal = res.revealAt - (await page.evaluate(() => window.__host.now()));
    await sleep(Math.max(0, toReveal) + 1800);
    await shot('21-results-ceremony');
    await sleep(3500);
    await shot('22-results-ceremony-b');
    await sleep(7000);
    await shot('23-results-standings');
    // "שוב!" replays the ceremony
    await page.click('[data-testid=btn-again]');
    await sleep(1500);
    await shot('24-results-replay');

    // ── back to the lobby, round 2 with a manual cutscene (real video) in the middle ──
    // (during the replayed ceremony "continue" would ask for a second press: wait for it to end)
    await page.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
    await page.click('[data-testid=btn-primary]');
    await waitPhase('lobby');
    // the TV ignores keys for 1.5 s after a screen change (Space-Space must not skip two screens)
    await sleep(1700);
    await shot('30-lobby-after-1');
    await page.keyboard.press('KeyN');
    await waitPhase('playing', 10000);
    await sleep(2500);
    await shot('31-playing-icy-a');
    await page.keyboard.press('KeyC');
    await page.waitForSelector('[data-testid=cutscene-menu]');
    await page.waitForFunction(() => document.querySelector('[data-testid=cm-opening] [data-status=ok]') !== null, null, { timeout: 5000 });
    await sleep(300);
    await shot('32-cutscene-menu');
    const dots = await page.$$eval('.hs-dot', (els) => els.map((e) => e.getAttribute('data-status')));
    check('menu dots: opening + tap_freeze found, the rest missing', dots.join(',') === 'ok,ok,missing,missing,missing,missing', dots);
    const leftBefore = await left();
    await page.click('[data-testid=cm-play-opening]');
    await waitCut(true, 5000);
    const leftFrozen = await left();
    await page.waitForFunction(() => {
      const v = document.querySelector('[data-testid=cutscene-video]');
      return v && v.currentTime > 1.5;
    }, null, { timeout: 8000 });
    await shot('33-manual-cutscene-video');
    check('frozen with the time left at the press', Math.abs(leftFrozen - leftBefore) < 600, { leftBefore, leftFrozen });
    await waitCut(false, 15000);
    await sleep(400);
    await shot('34-manual-resume-321');
    const leftResumed = await left();
    check('same time left after the manual cutscene', Math.abs(leftResumed - leftFrozen) < 50, { leftFrozen, leftResumed });
    await page.waitForFunction(() => document.querySelector('[data-testid=resume]') === null, null, { timeout: 6000 });
    await sleep(1200);
    await shot('35-playing-icy-continues');
    const leftLater = await left();
    check('race continues after resume', leftLater < leftResumed - 800, { leftResumed, leftLater });
    await waitPhase('results', 20000);
    await sleep(500);
    await page.keyboard.press('Space');
    await waitPhase('lobby');
    await sleep(1200);
    await shot('40-lobby-after-2');
    await noScroll('lobby after 2');

    // missing file: placeholder card, then the cutscene ends by itself
    await page.keyboard.press('KeyC');
    await page.waitForSelector('[data-testid=cutscene-menu]');
    await page.click('[data-testid=cm-play-joker_1]');
    await page.waitForSelector('[data-testid=cutscene-placeholder]', { timeout: 5000 });
    await sleep(900);
    await shot('41-cutscene-placeholder');
    const t0 = Date.now();
    await waitCut(false, 10000);
    check('placeholder ends the cutscene after ~4s', Date.now() - t0 < 6000, Date.now() - t0);

    // refresh mid-round: re-attach, the round keeps running
    await page.keyboard.press('KeyN');
    await waitPhase('playing', 10000);
    await sleep(2500);
    const before = await st();
    const leftPre = await left();
    await page.reload();
    await page.waitForFunction(() => window.__host && window.__host.state() !== null, null, { timeout: 10000 });
    const after = await st();
    const leftPost = await left();
    check('refresh re-attaches to the same room', after.code === before.code && after.round && after.round.index === before.round.index, {
      before: before.code,
      after: after.code,
      phase: after.phase,
    });
    check('round kept running through the refresh', after.phase === 'playing' && leftPost < leftPre && leftPost > 0, { leftPre, leftPost });
    await sleep(800);
    await shot('42-after-refresh-playing');
    await page.mouse.click(960, 8);
    await waitPhase('results', 20000);
    await sleep(800);

    // final podium (the before_podium cutscene has no file: placeholder first)
    await page.click('[data-testid=btn-primary]');
    await waitPhase('lobby');
    await page.click('[data-testid=btn-final]');
    await waitPhase('final');
    const fs1 = await st();
    if (fs1.cutscene) {
      await sleep(800);
      await shot('50-final-cutscene-placeholder');
      await waitCut(false, 10000);
    }
    await sleep(2500);
    await shot('51-final-a');
    await sleep(4000);
    await shot('52-final-b');
    await sleep(6000);
    await shot('53-final-c');
    await noScroll('final');

    // spot checks at other sizes
    await page.click('[data-testid=btn-lobby]');
    await waitPhase('lobby');
    await sleep(800);
    await page.setViewportSize({ width: 1280, height: 720 });
    await sleep(800);
    await shot('60-lobby-1280');
    await noScroll('lobby 1280x720');
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(800);
    await shot('61-lobby-390');
    await noScroll('lobby 390x844');
    await page.keyboard.press('KeyC');
    await sleep(500);
    await shot('62-menu-390');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1920, height: 1080 });

    // the more menu + reset confirm
    await page.click('[data-testid=btn-more]');
    await sleep(400);
    await shot('63-more-menu');
    await page.keyboard.press('Escape');
    await page.click('[data-testid=btn-reset]');
    await sleep(400);
    await shot('64-confirm-reset');
    await page.click('[data-testid=confirm-yes]');
    await page.waitForFunction(() => window.__host.state().played.length === 0, null, { timeout: 5000 });
    check('reset clears the competition', true);
  } catch (err) {
    console.log('ERROR', err && err.message);
    await shot('99-error').catch(() => {});
    results.push({ name: 'exception', ok: false, extra: String(err && err.message) });
  } finally {
    for (const b of bots) killBots(b);
    console.log('page errors:', JSON.stringify(errors.slice(0, 10)));
    console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
    await browser.close();
    process.exit(0);
  }
})();
