// Shared helpers of the qa-tv-* scripts (the TV host page under stress).
//
// Start the stack first (ports of the TV QA lane):
//   PARTY_SERVER_PORT=8813 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite
// Env: BASE_URL (default http://localhost:5213), SERVER_URL (default http://localhost:8813).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '../..');
const BASE = (process.env.BASE_URL || 'http://localhost:5213').replace(/\/+$/, '');
const SERVER = (process.env.SERVER_URL || 'http://localhost:8813').replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function outDir(name) {
  const dir = path.join(__dirname, 'out', 'qa-tv', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function checker() {
  const failures = [];
  const check = (ok, msg, extra) => {
    console.log(ok ? '  ok  ' : '  FAIL', msg, !ok && extra !== undefined ? JSON.stringify(extra).slice(0, 600) : '');
    if (!ok) failures.push(msg);
    return ok;
  };
  return { check, failures };
}

/** A host page on a fresh room. Collects console errors and page errors. */
async function openHost(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1920, height: 1080 }, deviceScaleFactor: opts.dpr || 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console ' + m.text() + ' @' + ((m.location() && m.location().url) || ''));
  });
  const url = BASE + (opts.path || '/host.html') + (opts.query || '');
  await page.goto(url);
  if (opts.keepRoom !== true) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(url);
  }
  await page.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 20000 });
  const code = await page.evaluate(() => window.__host.state().code);
  // the page ignores keys for 1.5 s after any screen change (the room just appeared)
  await sleep(1700);
  return { ctx, page, errors, code };
}

const state = (page) => page.evaluate(() => window.__host.state());
const waitPhase = (page, phase, ms = 40000) =>
  page.waitForFunction((p) => window.__host && window.__host.state() && window.__host.state().phase === p, phase, { timeout: ms });
const waitCut = (page, on, ms = 20000) =>
  page.waitForFunction((v) => !!(window.__host && window.__host.state() && window.__host.state().cutscene) === v, on, { timeout: ms });

/**
 * Turn the automatic cutscenes off from the TV's own cutscene menu (C → the switch → Esc).
 * For scripts that test something else: the tap game's automatic cutscene (tap_freeze, a few
 * seconds into the round) covers the screen and the TV ignores keys under a cutscene.
 */
async function autoCutscenesOff(page) {
  if ((await page.evaluate(() => window.__host.state().autoCutscenes)) === false) return;
  await page.keyboard.press('KeyC');
  await page.waitForSelector('[data-testid=cutscene-menu]');
  await page.click('[data-testid=auto-switch]');
  await page.waitForFunction(() => window.__host.state().autoCutscenes === false, null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await sleep(300);
}

/** tests/load/bots.ts joined to a room (detached; call .stop()). */
function spawnBots(code, players, extra = []) {
  const child = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', String(players), '--quiet', ...extra], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  return {
    stop() {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    },
  };
}

/**
 * Scripted phones: join with the given names, then while the room plays send
 * score(i, elapsedMs) every 250 ms (null = send nothing). Final = last score.
 */
async function scriptedPhones(code, names, score) {
  const socks = [];
  for (const name of names) {
    const s = io(SERVER, { transports: ['websocket'], forceNew: true });
    await new Promise((res, rej) => {
      s.once('connect', res);
      s.once('connect_error', rej);
    });
    const ack = await new Promise((res) => s.emit('player:join', { code, name }, res));
    if (!ack.ok) throw new Error('join failed ' + JSON.stringify(ack));
    socks.push({ s, id: ack.playerId, state: ack.state, last: 0 });
  }
  let offset = 0;
  const sync = await new Promise((res) => socks[0].s.emit('time:ping', Date.now(), res));
  offset = sync.serverNow - Date.now();
  for (const p of socks) p.s.on('state', (st) => (p.state = st));
  const timer = setInterval(() => {
    socks.forEach((p, i) => {
      const st = p.state;
      if (!st || st.phase !== 'playing' || !st.round || st.cutscene) return;
      const now = Date.now() + offset;
      const r = st.round;
      let t = now;
      if (r.frozenAt !== null) return;
      if (r.resumeAt !== null && now < r.resumeAt) return;
      const elapsed = t - r.startAt;
      if (elapsed < 0 || t > r.endAt) {
        if (t > r.endAt && !p.finalSent) {
          p.finalSent = r.index;
          p.s.emit('player:final', { round: r.index, score: p.last }, () => undefined);
        }
        return;
      }
      if (p.finalSent !== undefined && p.finalSent !== r.index) p.finalSent = undefined;
      const v = score(i, elapsed, r.index);
      if (v === null || v === undefined) return;
      p.last = Math.max(0, Math.round(v));
      p.s.emit('player:score', { round: r.index, score: p.last });
    });
  }, 250);
  return {
    ids: socks.map((p) => p.id),
    stop() {
      clearInterval(timer);
      for (const p of socks) p.s.close();
    },
  };
}

/** Rectangles intersect by more than `tol` px in both directions. */
function overlaps(a, b, tol = 1) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > tol && h > tol;
}

/**
 * Geometry of the race at this instant: for every row the part a viewer can see
 * (the row content clipped by its slot), and the "rotating places" label.
 */
const raceGeometry = (page) =>
  page.evaluate(() => {
    const rect = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    const rows = [...document.querySelectorAll('.sh-row')].map((slot) => {
      const s = slot.getBoundingClientRect();
      const inner = slot.querySelector('.sh-row-in');
      const r = inner ? inner.getBoundingClientRect() : s;
      const vis = { left: Math.max(s.left, r.left), right: Math.min(s.right, r.right), top: Math.max(s.top, r.top), bottom: Math.min(s.bottom, r.bottom) };
      const op = Number(getComputedStyle(slot).opacity);
      return { name: (slot.querySelector('.sh-name') || {}).textContent || '', vis, op, slot: rect(s) };
    });
    const div = document.querySelector('.sh-divider span');
    const label = div ? rect(div.parentElement.getBoundingClientRect()) : null;
    return { rows: rows.filter((r) => r.op > 0.05 && r.vis.bottom - r.vis.top > 1), label };
  });

/**
 * Check the race geometry on EVERY animation frame for `ms` inside the page:
 * the visible part of each row (content clipped by its slot) against every other
 * row and the rotating-places label. Returns { frames, bad, examples, orders, blink }.
 */
const raceOverlapFrames = (page, ms) =>
  page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        let frames = 0;
        let bad = 0;
        let orders = 0;
        let blink = 0;
        let misorder = 0;
        let prev = '';
        const examples = [];
        const t0 = performance.now();
        const step = () => {
          frames++;
          const vis = [];
          for (const slot of document.querySelectorAll('.sh-row')) {
            const s = slot.getBoundingClientRect();
            if (Number(getComputedStyle(slot).opacity) < 0.05) continue;
            const inner = slot.querySelector('.sh-row-in');
            const r = inner ? inner.getBoundingClientRect() : s;
            const v = { left: Math.max(s.left, r.left), right: Math.min(s.right, r.right), top: Math.max(s.top, r.top), bottom: Math.min(s.bottom, r.bottom) };
            if (v.bottom - v.top > 1) vis.push({ v, name: (slot.querySelector('.sh-name') || {}).textContent || '' });
          }
          // a board that blinks: fewer than half of the rows readable (entrance animations all at once)
          const enters = [...document.querySelectorAll('.sh-row-enter')];
          const readable = enters.filter((e) => Number(getComputedStyle(e).opacity) >= 0.5).length;
          if (enters.length > 0 && readable < enters.length / 2) blink++;
          // the numbers agree with the places: no row shows clearly more than the row above it
          const nums = [...document.querySelectorAll('.sh-row')]
            .sort((a, b) => Number(a.dataset.slot) - Number(b.dataset.slot))
            .map((r) => Number(((r.querySelector('.sh-score') || {}).textContent || '').replace(/[^0-9]/g, '')));
          if (nums.some((v, k) => k > 0 && v > nums[k - 1] * 1.02 + 1)) misorder++;
          const order = vis.map((x) => x.name).join('|');
          if (order !== prev) orders++;
          prev = order;
          const lab = document.querySelector('.sh-divider');
          const L = lab ? lab.getBoundingClientRect() : null;
          let problem = null;
          for (let a = 0; a < vis.length && !problem; a++) {
            for (let b = a + 1; b < vis.length && !problem; b++) if (hit(vis[a].v, vis[b].v)) problem = vis[a].name + ' / ' + vis[b].name;
            if (!problem && L && hit(vis[a].v, L)) problem = vis[a].name + ' / label';
          }
          if (problem) {
            bad++;
            if (examples.length < 5) examples.push(Math.round(performance.now() - t0) + 'ms ' + problem);
          }
          if (performance.now() - t0 < dur) requestAnimationFrame(step);
          else resolve({ frames, bad, examples, orders, blink, misorder });
        };
        requestAnimationFrame(step);
      }),
    ms,
  );

/** CDP screencast: JPEG frames about every `everyMs` into `dir`. Returns stop() → frame count. */
async function startScreencast(page, dir, everyMs = 100) {
  const cdp = await page.context().newCDPSession(page);
  let n = 0;
  let last = 0;
  const writes = [];
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
    const t = Date.now();
    if (t - last < everyMs * 0.8) return;
    last = t;
    const file = path.join(dir, `frame-${String(n++).padStart(3, '0')}.jpg`);
    writes.push(fs.promises.writeFile(file, Buffer.from(f.data, 'base64')));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    await Promise.all(writes);
    await cdp.detach().catch(() => undefined);
    return n;
  };
}

module.exports = { autoCutscenesOff, raceOverlapFrames, startScreencast, ROOT, BASE, SERVER, sleep, outDir, checker, openHost, state, waitPhase, waitCut, spawnBots, scriptedPhones, overlaps, raceGeometry };
