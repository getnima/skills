// TV background music: one song per game, driven by the room state and the server clock.
//
//   node tests/e2e/qa-music.cjs
//
// Starts its own stack (server :8851 with PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=15000,
// vite :5251), writes test songs (sine tones, made with ffmpeg) into client/public/audio/
// and sets tap's startSec to 5 in client/src/host/music-config.ts for the run. Both are
// restored in `finally`: the audio folder ends with README.md only.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SERVER_PORT = 8851;
const VITE_PORT = 5251;
process.env.BASE_URL = `http://localhost:${VITE_PORT}`;
process.env.SERVER_URL = `http://localhost:${SERVER_PORT}`;
const L = require('./qa-tv-lib.cjs');

const AUDIO = path.join(ROOT, 'client/public/audio');
const CONFIG = path.join(ROOT, 'client/src/host/music-config.ts');
const OUT = path.join(__dirname, 'out', 'qa-music');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRELUDE_MS = 3000; // PARTY_TEST_FAST: intro 1500 + countdown 1500
const TAP_START = 5;

/** slot → [Hz, seconds] */
const SONGS = { lobby: [300, 30], tap: [440, 40], round: [660, 12], victory: [880, 20] };

const { check, failures } = L.checker();
const procs = [];

function spawnProc(cmd, args, env) {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const p = {
    child,
    log: () => log,
    stop() {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // gone
      }
    },
  };
  procs.push(p);
  return p;
}

async function waitHttp(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      // not yet
    }
    await sleep(250);
  }
  throw new Error('not up: ' + url);
}

function startVite() {
  const v = spawnProc('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], { PARTY_SERVER_PORT: String(SERVER_PORT), PARTY_CLIENT_PORT: String(VITE_PORT) });
  return v;
}

function writeSongs(slots) {
  for (const slot of slots) {
    const [hz, sec] = SONGS[slot];
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${sec}`, '-c:a', 'libmp3lame', '-b:a', '96k', path.join(AUDIO, `${slot}.mp3`)]);
  }
}

function cleanAudio() {
  for (const f of fs.readdirSync(AUDIO)) if (f !== 'README.md') fs.rmSync(path.join(AUDIO, f), { force: true });
}

/** Everything the assertions need, read in one go inside the page. */
const snap = (page) =>
  page.evaluate(() => {
    const m = window.__partyMusic;
    const st = window.__host.state();
    const now = window.__host.now();
    let elapsed = null;
    const r = st && st.round;
    if (r) {
      let t = now;
      if (r.frozenAt !== null) t = r.frozenAt;
      else if (r.resumeAt !== null && now < r.resumeAt) t = r.resumeAt;
      elapsed = t - r.startAt;
    }
    const pick = (n) => m.info(n);
    return {
      phase: st && st.phase,
      cut: !!(st && st.cutscene),
      round: r,
      now,
      elapsed,
      tap: pick('tap'),
      round_: pick('round'),
      lobby: pick('lobby'),
      flappy: pick('flappy'),
      victory: pick('victory'),
      live: m.live().map((x) => ({ name: x.name, playing: x.playing, level: x.level, time: x.time, stopping: x.stopping })),
      stats: m.stats(),
      hook: window.__hostMusic ? { cur: window.__hostMusic.current(), timers: window.__hostMusic.timers(), prelude: window.__hostMusic.prelude() } : null,
    };
  });

/** Expected song position (s) from the state: startSec + (prelude + round elapsed), wrapped by the file length. */
function expectedPos(s, startSec, duration, prelude = PRELUDE_MS) {
  const p = startSec + Math.max(0, prelude + s.elapsed) / 1000;
  return duration ? p % duration : p;
}

/** Records every 100 ms which tracks are audible (playing and level > 0.01). */
const startSampler = (page) =>
  page.evaluate(() => {
    window.__musicSamples = [];
    clearInterval(window.__musicSampler);
    window.__musicSampler = setInterval(() => {
      const st = window.__host && window.__host.state();
      const audible = window.__partyMusic
        .live()
        .filter((x) => x.playing && x.level > 0.01)
        .map((x) => x.name);
      window.__musicSamples.push({ t: performance.now(), phase: st && st.phase, audible });
    }, 100);
  });
const samples = (page) => page.evaluate(() => window.__musicSamples || []);

async function setAuto(page, on) {
  for (let i = 0; i < 3; i++) {
    if ((await L.state(page)).autoCutscenes === on) break;
    await page.click('[data-testid="btn-cutscenes"]');
    await page.waitForSelector('[data-testid="auto-switch"]');
    await page.click('[data-testid="auto-switch"]');
    await page.waitForFunction((v) => window.__host.state().autoCutscenes === v, on, { timeout: 5000 }).catch(async () => {
      await page.screenshot({ path: path.join(OUT, `set-auto-${i}.png`) });
    });
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  check((await L.state(page)).autoCutscenes === on, `automatic cutscenes ${on ? 'on' : 'off'}`);
}

async function startGame(page, id) {
  await page.click(`[data-testid="game-${id}"]`, { force: true });
  await L.waitPhase(page, 'intro', 10000);
}

/** results → lobby, skipping the ceremony (two presses, apart). */
async function toLobby(page) {
  for (let i = 0; i < 3; i++) {
    const st = await L.state(page);
    if (st.phase === 'lobby') return;
    await page.click('[data-testid="btn-primary"]');
    await sleep(800);
  }
  await L.waitPhase(page, 'lobby', 10000);
}

async function endRoundNow(page) {
  const st = await L.state(page);
  await page.keyboard.press('KeyE');
  if (st.phase === 'playing') {
    await sleep(700);
    await page.keyboard.press('KeyE');
  }
}

async function openTv(browser, opts = {}) {
  const host = await L.openHost(browser, opts);
  await host.page.addInitScript(() => {
    // every audio element that was ever played, to count the ones left holding a file
    const seen = new Set();
    window.__audioEls = seen;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) {
      seen.add(this);
      return play.apply(this, a);
    };
  });
  await host.page.reload();
  await host.page.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 20000 });
  await sleep(1700);
  return host;
}

const heldElements = (page) => page.evaluate(() => [...window.__audioEls].filter((e) => e.getAttribute('src') !== null).length);

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const configBefore = fs.readFileSync(CONFIG, 'utf8');
  const audioBefore = fs.readdirSync(AUDIO).sort().join(',');
  let browser = null;
  let browser2 = null;
  let phones = null;
  try {
    // ── stack, songs A: lobby, tap (startSec 5), round (12 s, loops), victory ──
    cleanAudio();
    writeSongs(['lobby', 'tap', 'round', 'victory']);
    fs.writeFileSync(CONFIG, configBefore.replace(/tap: \{ startSec: 0,/, `tap: { startSec: ${TAP_START},`));
    check(fs.readFileSync(CONFIG, 'utf8').includes(`tap: { startSec: ${TAP_START},`), 'test tuning: tap.startSec = 5');
    const server = spawnProc('npx', ['tsx', 'server/index.ts'], { PARTY_SERVER_PORT: String(SERVER_PORT), PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '15000' });
    let vite = startVite();
    await waitHttp(`http://localhost:${SERVER_PORT}/api/info`).catch((e) => {
      console.log(server.log());
      throw e;
    });
    await waitHttp(`http://localhost:${VITE_PORT}/host.html`).catch((e) => {
      console.log(vite.log());
      throw e;
    });

    browser = await chromium.launch();
    const tv = await openTv(browser);
    const { page, errors } = tv;
    await setAuto(page, false);
    phones = await L.scriptedPhones(tv.code, ['אלף', 'בית'], (i, el) => (i + 1) * Math.floor(el / 100));
    await startSampler(page);

    // ── lobby ──
    await page.waitForFunction(() => window.__partyMusic.info('lobby') && window.__partyMusic.info('lobby').playing, null, { timeout: 8000 });
    let s = await snap(page);
    check(s.lobby && s.lobby.playing && Math.abs(s.lobby.volume - 0.4) < 0.01, 'lobby: lobby.mp3 plays at 0.4', s.lobby);

    // ── tap: own song, ducked, startSec, full at startAt ──
    await startGame(page, 'tap');
    await page.waitForFunction(() => window.__partyMusic.info('tap') && window.__partyMusic.info('tap').playing, null, { timeout: 4000 });
    s = await snap(page);
    check(s.round_ === null, 'tap intro: round.mp3 is not played (tap has its own)', s.round_);
    check(Math.abs(s.tap.volume - 0.3) < 0.01 && s.tap.level <= 0.31, 'tap intro: ducked level 0.3', s.tap);
    const pos0 = expectedPos(s, TAP_START, null);
    check(Math.abs(s.tap.time - pos0) < 0.6 && s.tap.time >= TAP_START - 0.05, `tap intro: startSec honoured (time ${s.tap.time.toFixed(2)} vs ${pos0.toFixed(2)})`, s.tap);
    check(s.hook && Math.abs(s.hook.prelude - PRELUDE_MS) <= 60, `tap intro: the intro length was read from the first snapshot (${s.hook && s.hook.prelude} ms)`, s.hook);
    await page.waitForTimeout(1200);
    s = await snap(page);
    check(!s.live.some((x) => x.name === 'lobby'), 'tap intro: the lobby song crossfaded out (900 ms)', s.live);
    await L.waitPhase(page, 'playing', 6000);
    await sleep(900);
    s = await snap(page);
    check(Math.abs(s.tap.level - 0.6) < 0.02, 'tap playing: full level 0.6 within ~600 ms of the start', s.tap);

    // ── manual cutscene during play: pause, keep position, ducked until resumeAt ──
    await sleep(2500);
    await page.click('[data-testid="btn-cutscenes"]');
    await page.click('[data-testid="cm-play-joker_1"]');
    await L.waitCut(page, true, 5000);
    await sleep(500);
    s = await snap(page);
    const pausedAt = s.tap.time;
    check(s.tap.paused && !s.tap.playing, 'cutscene: tap paused', s.tap);
    await sleep(1500);
    s = await snap(page);
    check(Math.abs(s.tap.time - pausedAt) < 0.05, 'cutscene: position stands still while paused', { pausedAt, now: s.tap.time });
    await L.waitCut(page, false, 15000);
    await page.waitForFunction(() => window.__partyMusic.info('tap') && window.__partyMusic.info('tap').playing, null, { timeout: 3000 });
    s = await snap(page);
    check(Math.abs(s.tap.time - pausedAt) < 0.5 && s.tap.time > 1, `after cutscene: continues from ${pausedAt.toFixed(2)} (now ${s.tap.time.toFixed(2)}), not from zero`, s.tap);
    check(s.round && s.round.resumeAt !== null, 'after cutscene: the server set resumeAt (3-2-1)', s.round);
    const resumeAt = s.round.resumeAt;
    await sleep(Math.max(0, resumeAt - s.now - 600));
    s = await snap(page);
    check(s.tap.level <= 0.31 && s.tap.playing, `3-2-1: ducked (level ${s.tap.level.toFixed(2)})`, s.tap);
    await sleep(600 + 1000);
    s = await snap(page);
    check(Math.abs(s.tap.level - 0.6) < 0.02, `after resumeAt: full again (level ${s.tap.level.toFixed(2)})`, s.tap);

    // ── results: faded out before victory, never overlapping ──
    await L.waitPhase(page, 'results', 25000);
    await sleep(1200);
    s = await snap(page);
    check(s.tap === null && !s.live.some((x) => x.name === 'tap'), 'results: tap faded out and released within 1.2 s', s.live);
    await page.waitForFunction(() => window.__partyMusic.info('victory') && window.__partyMusic.info('victory').playing, null, { timeout: 25000 });
    await sleep(600);
    let smp = await samples(page);
    // the lobby song crossfading into the game's song at the start of the intro is intended
    const overlap = smp.filter((x) => x.audible.length > 1 && !(x.phase === 'intro' && x.audible.length === 2 && x.audible.includes('lobby')));
    const tapInResults = smp.filter((x) => x.phase === 'results' && x.audible.includes('tap'));
    const lastTap = Math.max(...smp.filter((x) => x.audible.includes('tap')).map((x) => x.t));
    const firstVictory = Math.min(...smp.filter((x) => x.audible.includes('victory')).map((x) => x.t));
    check(overlap.length === 0, `no two songs audible at once (${smp.length} samples, 100 ms apart)`, overlap.slice(0, 3));
    check(tapInResults.length <= 9, `tap audible for ${tapInResults.length * 100} ms into results (fade ~800)`, tapInResults.length);
    check(Number.isFinite(firstVictory) && firstVictory - lastTap > 2000, `victory starts ${((firstVictory - lastTap) / 1000).toFixed(1)} s after tap went silent`);

    // ── a game with no file: round.mp3 (ducked at its own level); cancel in the intro stops it ──
    await toLobby(page);
    await startGame(page, 'icy');
    await page.waitForFunction(() => window.__partyMusic.info('round') && window.__partyMusic.info('round').playing, null, { timeout: 4000 });
    s = await snap(page);
    check(s.round_ && Math.abs(s.round_.volume - 0.2) < 0.01 && !s.live.some((x) => x.name === 'icy'), 'icy (no file): round.mp3 plays, ducked at 0.2', s.live);
    await endRoundNow(page);
    await L.waitPhase(page, 'lobby', 5000);
    await sleep(1100);
    s = await snap(page);
    check(!s.live.some((x) => x.name === 'round'), 'cancelled in the intro: round.mp3 stopped', s.live);
    check(s.lobby && s.lobby.playing, 'back in the lobby: lobby song again', s.lobby);

    // ── loop + reload mid-round (round.mp3 is 12 s: the position wraps) ──
    await startGame(page, 'icy');
    await L.waitPhase(page, 'playing', 6000);
    await page.waitForFunction(() => window.__host.state().round && window.__host.now() - window.__host.state().round.startAt > 10500, null, { timeout: 15000 });
    s = await snap(page);
    const before = expectedPos(s, 0, 12);
    check(s.round_ && s.round_.playing && Math.abs(s.round_.time - before) < 0.6, `loop: round.mp3 wrapped (time ${s.round_ && s.round_.time.toFixed(2)} vs ${before.toFixed(2)} of 12 s)`, s.round_);
    await page.reload();
    await page.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 20000 });
    await page.waitForFunction(() => window.__partyMusic.info('round') && window.__partyMusic.info('round').playing, null, { timeout: 5000 });
    await sleep(300);
    s = await snap(page);
    const exp = expectedPos(s, 0, 12);
    check(s.hook && Math.abs(s.hook.prelude - PRELUDE_MS) <= 60, 'reload mid-round: the intro length came back from sessionStorage', s.hook);
    check(Math.abs(s.round_.time - exp) < 1, `reload mid-round: position ${s.round_.time.toFixed(2)} vs expected ${exp.toFixed(2)} (not from zero)`, { s: s.round_, exp });
    check(s.round_.level > 0.25, 'reload mid-round: full level', s.round_);
    // ── mute ──
    await page.keyboard.press('KeyM');
    await sleep(200);
    s = await snap(page);
    check(s.round_.muted, 'mute (M): the song is muted', s.round_);
    await page.keyboard.press('KeyM');
    await sleep(200);
    s = await snap(page);
    check(!s.round_.muted, 'unmute (M): back', s.round_);
    await L.waitPhase(page, 'results', 25000);
    await toLobby(page);

    // ── five rounds in a row: nothing left behind ──
    await startSampler(page);
    const games = ['tap', 'icy', 'plotzel', 'ninja', 'tap'];
    for (const g of games) {
      await startGame(page, g);
      await L.waitPhase(page, 'playing', 6000);
      await sleep(800);
      await endRoundNow(page);
      await L.waitPhase(page, 'results', 6000);
      await sleep(1500);
      await toLobby(page);
    }
    await sleep(2000);
    s = await snap(page);
    const held = await heldElements(page);
    if (s.stats.live !== 1) {
      console.log('DIAG', JSON.stringify(await page.evaluate(async () => {
        const m = await import('/src/kit/music.ts');
        return { has: m.hasTrackFile('lobby'), started: window.__partyMusic.started.slice(-12), hook: window.__hostMusic.current(), plan: window.__hostMusic.plan() };
      })));
    }
    check(s.stats.live === 1 && s.stats.elements === 1 && s.stats.timers === 0 && s.live[0].name === 'lobby', `5 rounds: only the lobby song is held (stats ${JSON.stringify(s.stats)})`, s.live);
    check(held === 1, `5 rounds: ${held} audio element(s) still hold a file (expected 1)`);
    check(s.hook && s.hook.timers === 0, '5 rounds: the music hook has no pending timer', s.hook);
    smp = await samples(page);
    // lobby ↔ game song (intro) and victory → lobby (back in the lobby) are crossfades; a game song never meets victory
    const over5 = smp.filter((x) => x.audible.includes('victory') && x.audible.some((n) => n !== 'victory' && n !== 'lobby'));
    const games5 = smp.filter((x) => x.audible.filter((n) => n !== 'lobby' && n !== 'victory').length > 1);
    check(over5.length === 0 && games5.length === 0, `5 rounds: no game song overlapped victory or another song (${smp.length} samples)`, [...over5, ...games5].slice(0, 3));

    // ── sound check panel (songs A: some found, some missing) ──
    for (const vp of [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(vp);
      await sleep(300);
      await page.click('[data-testid="btn-more"]');
      await page.click('[data-testid="btn-sound-check"]');
      await page.waitForSelector('[data-testid="sound-check"]');
      await sleep(600);
      s = await snap(page);
      check(!s.live.some((x) => x.name === 'lobby' && !x.stopping) , `${vp.width}: the lobby song steps aside while the panel is open`, s.live);
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('.hs-sc-row')].map((r) => ({ id: r.dataset.testid, found: r.dataset.found, state: r.querySelector('.hs-sc-state').textContent })),
      );
      check(rows.map((r) => r.id).join(',') === 'sc-lobby,sc-tap,sc-icy,sc-flappy,sc-plotzel,sc-ninja,sc-round,sc-victory,sc-final', `${vp.width}: nine slots in order`, rows);
      check(rows.find((r) => r.id === 'sc-tap').state.includes('tap.mp3') && rows.find((r) => r.id === 'sc-icy').state.includes('round.mp3') && rows.find((r) => r.id === 'sc-final').state.includes('חסר'), `${vp.width}: found / missing states`, rows);
      const fit = await page.evaluate(() => {
        const m = document.querySelector('.hs-modal').getBoundingClientRect();
        const b = document.querySelector('.hs-modal-body');
        const clipped = [...document.querySelectorAll('.hs-sc-row *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'hidden').map((e) => e.textContent);
        return { top: m.top, bottom: m.bottom, h: innerHeight, scroll: b.scrollHeight > b.clientHeight + 1, clipped };
      });
      check(fit.top >= 0 && fit.bottom <= fit.h && !fit.scroll, `${vp.width}x${vp.height}: the panel fits without scrolling`, fit);
      check(fit.clipped.length === 0, `${vp.width}x${vp.height}: no text cut off`, fit.clipped);
      await page.click('[data-testid="sc-play-tap"]');
      await page.waitForFunction(() => window.__partyMusic.info('tap') && window.__partyMusic.info('tap').playing, null, { timeout: 4000 });
      await sleep(400);
      s = await snap(page);
      check(Math.abs(s.tap.volume - 0.6) < 0.01 && s.tap.time >= TAP_START && s.tap.time < TAP_START + 1.5, `${vp.width}: preview tap plays at 0.6 from startSec`, s.tap);
      await page.screenshot({ path: path.join(OUT, `sound-check-${vp.width}x${vp.height}.png`) });
      await page.click('[data-testid="sc-play-icy"]');
      await sleep(500);
      s = await snap(page);
      check(s.round_ && s.round_.playing && !s.live.some((x) => x.name === 'tap' && !x.stopping), `${vp.width}: one preview at a time (icy → round.mp3, tap stopped)`, s.live);
      await page.keyboard.press('Escape');
      await sleep(1200);
      s = await snap(page);
      check(!s.live.some((x) => x.name === 'round' || x.name === 'tap'), `${vp.width}: closing the panel stops the preview`, s.live);
      check(s.lobby && s.lobby.playing, `${vp.width}: the lobby song comes back`, s.lobby);
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    // the panel is lobby only
    await startGame(page, 'tap');
    await page.click('[data-testid="btn-more"]');
    check(await page.isDisabled('[data-testid="btn-sound-check"]'), 'sound check is disabled outside the lobby');
    await page.keyboard.press('Escape');
    await endRoundNow(page);
    await L.waitPhase(page, 'lobby', 5000);

    // ── autoplay blocked until a click: the song starts on the unlock at the right position ──
    browser2 = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
    const tv2 = await openTv(browser2);
    await setAuto(tv2.page, false);
    await startGame(tv2.page, 'tap');
    await L.waitPhase(tv2.page, 'playing', 6000);
    // a fresh context (Chrome lets a page that was clicked before autoplay after a reload)
    const store = await tv2.page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
    await tv2.ctx.close();
    const ctx3 = await browser2.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx3.addInitScript((s) => {
      for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v);
    }, store);
    const page3 = await ctx3.newPage();
    const errors3 = [];
    page3.on('console', (m) => m.type() === 'error' && errors3.push(m.text()));
    page3.on('pageerror', (e) => errors3.push(e.message));
    await page3.goto(`http://localhost:${VITE_PORT}/host.html`);
    await page3.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 20000 });
    check((await L.state(page3)).code === tv2.code && (await L.state(page3)).phase === 'playing', 'fresh TV page rejoined the running round');
    await sleep(1500);
    let s2 = await snap(page3);
    const lockShown = await page3.isVisible('[data-testid="audio-lock"]');
    check(s2.tap && !s2.tap.playing && lockShown, 'no gesture yet: the song waits (sound banner shown)', { tap: s2.tap, lockShown });
    await page3.mouse.click(960, 300);
    await page3.waitForFunction(() => window.__partyMusic.info('tap') && window.__partyMusic.info('tap').playing, null, { timeout: 4000 });
    await sleep(300);
    s2 = await snap(page3);
    // a brand-new tab never saw the intro: it assumes the production intro + countdown (10 s)
    check(s2.hook && s2.hook.prelude === 10000, 'fresh tab: production intro length assumed (10 s)', s2.hook);
    const exp2 = expectedPos(s2, TAP_START, null, 10000);
    check(Math.abs(s2.tap.time - exp2) < 1, `after the unlock click: position ${s2.tap.time.toFixed(2)} vs expected ${exp2.toFixed(2)}`, s2.tap);
    await endRoundNow(page3);
    check(errors3.length === 0, 'gesture TV: no console errors', errors3);
    await browser2.close();
    browser2 = null;

    // ── songs B: no round.mp3 → a game with no file is silent, without errors ──
    vite.stop();
    await sleep(500);
    fs.rmSync(path.join(AUDIO, 'round.mp3'), { force: true });
    vite = startVite();
    await waitHttp(`http://localhost:${VITE_PORT}/host.html`);
    await page.reload();
    await page.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 30000 });
    await sleep(1800);
    errors.length = 0;
    await startGame(page, 'flappy');
    await L.waitPhase(page, 'playing', 6000);
    await sleep(800);
    s = await snap(page);
    check(s.live.length === 0, 'flappy with neither flappy.mp3 nor round.mp3: silence (no track at all)', s.live);
    check(s.hook && s.hook.cur === null, 'silence: the hook holds no track', s.hook);
    await endRoundNow(page);
    await L.waitPhase(page, 'results', 6000);
    check(errors.length === 0, 'TV: no console errors', errors);
  } finally {
    if (phones) phones.stop();
    if (browser) await browser.close().catch(() => undefined);
    if (browser2) await browser2.close().catch(() => undefined);
    for (const p of procs) p.stop();
    fs.writeFileSync(CONFIG, configBefore);
    cleanAudio();
    const audioAfter = fs.readdirSync(AUDIO).sort().join(',');
    console.log(audioAfter === audioBefore && fs.readFileSync(CONFIG, 'utf8') === configBefore ? '  ok   restored: audio folder and music-config.ts' : '  FAIL restore', audioAfter);
  }
  console.log(failures.length === 0 ? '\nqa-music: all checks passed' : `\nqa-music: ${failures.length} FAILED:\n - ${failures.join('\n - ')}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  for (const p of procs) p.stop();
  try {
    cleanAudio();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
