// Flappy QA player (real CDP touch taps), for scripts that need a phone that plays from
// the outside: it reads what a person sees through window.__flappy (the bird, the next gap)
// and taps the screen. Flappy is one life: it plays until the bird is down or `maxMs` passed.
const { sleep, makeRand } = require('./qa-icy-lib.cjs');

/**
 * One flappy flight. kind: clumsy | normal | expert (how exact the taps are).
 * Returns { score (raw), runs: [obstacles passed], taps, ms }.
 */
async function playFlappy(page, touch, vp, kind, seed, opts = {}) {
  const rand = makeRand(seed);
  const sloppy = { clumsy: 0.3, normal: 0.12, expert: 0.03 }[kind] ?? 0.12;
  const minGap = { clumsy: 240, normal: 170, expert: 110 }[kind] ?? 170;
  const t0 = Date.now();
  const hardEnd = t0 + (opts.maxMs || 100000);
  let lastTap = 0;
  let taps = 0;
  let last = { run: 0, raw: 0 };
  for (;;) {
    if (Date.now() > hardEnd) break;
    let s = null;
    try {
      s = await page.evaluate(() => {
        const f = window.__flappy;
        const p = window.__party;
        if (!f) return { gone: true, score: p ? p.score : 0 };
        return { mode: f.mode, y: f.birdY, vy: f.vy, next: f.next, run: f.run, raw: f.raw ?? f.best ?? 0, frozen: p ? p.frozen : false, ended: p ? p.ended : false };
      });
    } catch {
      await sleep(30);
      continue;
    }
    if (!s || s.gone || s.ended) break;
    last = { run: s.run, raw: s.raw };
    if (s.mode !== 'fly' && s.mode !== 'hover') {
      if (opts.untilDown !== false) break;
      await sleep(40);
      continue;
    }
    if (!s.frozen) {
      const aim = (s.next.x < 34 ? s.next.gapY + s.next.gap * 0.15 : 48) + (rand() - 0.5) * sloppy * 60;
      if ((s.mode === 'hover' || (s.y > aim && s.vy > -25)) && Date.now() - lastTap > minGap) {
        await touch.tap(Math.round(vp.width * (0.25 + rand() * 0.5)), Math.round(vp.height * (0.4 + rand() * 0.3)));
        lastTap = Date.now();
        taps++;
      }
    }
    await sleep(12);
  }
  return { score: last.raw, runs: [last.run], taps, ms: Date.now() - t0 };
}

module.exports = { playFlappy };
