// Shared helpers of the qa-tap / qa-ninja scripts. Needs vite on :5221
// (PARTY_SERVER_PORT=8821 PARTY_CLIENT_PORT=5221 npx vite).
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.QA_BASE || 'http://localhost:5221';
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
  return ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function outDir(prefix) {
  const d = path.join(__dirname, 'out', prefix);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Seeded PRNG for the bots (their aim jitter must be reproducible run to run). */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rAF at a fixed low rate (a slow phone): every callback is delayed to the next 1000/fps tick. */
function lowFpsScript(fps) {
  return `(() => {
    const period = 1000 / ${fps};
    const q = new Map(); let id = 0; let timer = 0;
    const flush = () => { timer = 0; const now = performance.now(); const cbs = [...q.values()]; q.clear(); for (const cb of cbs) { try { cb(now); } catch (e) { console.error(e); } } };
    window.requestAnimationFrame = (cb) => { id++; q.set(id, cb); if (!timer) timer = setTimeout(flush, period); return id; };
    window.cancelAnimationFrame = (n) => { q.delete(n); };
  })();`;
}

/**
 * Open the dev harness for one game on a phone.
 * opts: { device, viewport, fps, cpu, query }
 */
async function openGame(browser, game, opts = {}) {
  const base = opts.device ? { ...devices[opts.device] } : { viewport: opts.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  if (opts.viewport && opts.device) base.viewport = opts.viewport;
  const context = await browser.newContext(base);
  if (opts.fps) await context.addInitScript(lowFpsScript(opts.fps));
  if (opts.init) await context.addInitScript(opts.init);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  const cdp = await context.newCDPSession(page);
  if (opts.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu });
  await page.goto(`${BASE}/dev.html?game=${game}&${opts.query || ''}`);
  await page.waitForSelector('.pa-stage-game canvas');
  // the harness' own ❄️ / 🔇 / ✕ buttons sit over the bottom-left of the game: a bot tap
  // there would leave the page. They are not part of the real phone; hide them.
  if (!opts.keepTools) await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  return { context, page, cdp, errors };
}

/** Raw touch through CDP (real touch events: pointerdown/move/up on the page). */
async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: p.r || 8, radiusY: p.r || 8, force: 1 })),
  });
}
/**
 * One quick tap with n fingers at once. CDP waits ~2 frames per touch command, so the
 * start and the end are queued without waiting for each other (a human-speed tapper
 * would otherwise be capped at ~14 taps/s by the tool). Await the result only if needed.
 */
let tapIds = 1000;
function tapAt(cdp, pts) {
  const points = pts.map((p) => ({ x: p.x, y: p.y, id: tapIds++ }));
  return Promise.all([touch(cdp, 'touchStart', points), touch(cdp, 'touchEnd', [])]);
}

const party = (page) =>
  page.evaluate(() => ({ score: window.__party.score, ended: window.__party.ended, frozen: window.__party.frozen, leftMs: window.__party.leftMs }));

/** Frame times over `ms` (rAF deltas measured in the page). */
async function frameTimes(page, ms) {
  return page.evaluate(
    (ms) =>
      new Promise((res) => {
        const out = [];
        let last = performance.now();
        const t0 = last;
        const f = (now) => {
          out.push(now - last);
          last = now;
          if (now - t0 < ms) requestAnimationFrame(f);
          else res(out);
        };
        requestAnimationFrame(f);
      }),
    ms,
  );
}
function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
}

module.exports = { chromium, devices, BASE, fails, check, sleep, outDir, mulberry, openGame, touch, tapAt, party, frameTimes, pct, lowFpsScript };
