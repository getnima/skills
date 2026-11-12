// Helpers of the qa-tap-comedy scripts: open the tap game in the dev harness, drive it with
// real CDP touches at controlled rates, read window.__tap.
//   QA_BASE=http://localhost:5321 (vite with HMR off: tests/e2e/qa-icy-vite.config.mjs)
const lib = require('./qa-tap-lib.cjs');
const { openGame, sleep, tapAt } = lib;

async function openTap(browser, opts = {}) {
  const viewport = opts.viewport || { width: 390, height: 844 };
  const q = `seed=${opts.seed ?? 1}&duration=${opts.duration ?? 53000}${opts.query ? '&' + opts.query : ''}`;
  const o = await openGame(browser, 'tap', { viewport, fps: opts.fps, cpu: opts.cpu, init: opts.init, query: q, safe: opts.safe });
  await o.page.waitForFunction(() => window.__tap && window.__tap());
  return o;
}

const st = (page) => page.evaluate(() => window.__tap());

/** Wait until the round time (game elapsed) reaches ms. */
async function untilElapsed(page, ms) {
  await page.waitForFunction((m) => window.__tap() && window.__tap().elapsedMs >= m, ms, { timeout: 120000, polling: 16 });
}

/**
 * Tap with a schedule of ROUND times: `times` sorted; each touch is sent when the game's elapsed
 * round time reaches it (polled), `fingers` = touch points per touchstart. Points alternate
 * around the token centre (two thumbs). Returns the number of touchstarts sent.
 */
async function tapSchedule(page, cdp, times, opts = {}) {
  const s0 = await st(page);
  const cx = s0.x;
  const cy = s0.y + s0.r * 0.3;
  let i = 0;
  let sent = 0;
  while (i < times.length) {
    const now = await page.evaluate(() => (window.__tap() ? window.__tap().elapsedMs : 0));
    const fin = await page.evaluate(() => window.__party.ended);
    if (fin) break;
    while (i < times.length && times[i] <= now + 4) {
      const side = i % 2 === 0 ? -1 : 1;
      const n = opts.fingers || 1;
      const pts = [];
      for (let f = 0; f < n; f++) pts.push({ x: cx + side * 40 + f * 22 - (n - 1) * 11, y: cy + f * 9 });
      void tapAt(cdp, pts);
      sent++;
      i++;
    }
    if (i < times.length) {
      const wait = Math.max(0, Math.min(30, times[i] - now - 6));
      await sleep(wait);
    }
  }
  return sent;
}

/** Seeded steady taps: hz from `from` for `forMs`, jitter share of the gap. */
function steady(hz, from, forMs, jitter = 0, seed = 1) {
  const r = lib.mulberry(seed);
  const out = [];
  const gap = 1000 / hz;
  for (let t = from; t < from + forMs; t += gap * (1 + (r() - 0.5) * jitter)) out.push(Math.round(t));
  return out;
}

module.exports = { ...lib, openTap, st, untilElapsed, tapSchedule, steady };
