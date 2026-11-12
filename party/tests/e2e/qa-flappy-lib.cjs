// Flappy QA players (real CDP touch taps): clumsy / normal / expert, plus the
// degenerate strategies (fixed rhythm, mash the top).
const { sleep, makeRand } = require('./qa-icy-lib.cjs');

const FLAPPY_STATE = () => {
  const f = window.__flappy;
  const p = window.__party;
  if (!p) return null;
  if (!f) return p.ended ? { ended: true, score: p.score } : null;
  return {
    mode: f.mode,
    y: f.birdY,
    vy: f.vy,
    dist: f.dist,
    run: f.run,
    best: f.best,
    runs: f.runs,
    speed: f.speed,
    steps: f.steps,
    ended: p.ended,
    frozen: p.frozen,
    score: p.score,
    leftMs: p.leftMs,
  };
};

/**
 * One flappy player. kind: clumsy | normal | expert | rhythm | mashTop.
 * The decisions use what a person sees (bird, next gaps); every tap is a real touch.
 */
async function playFlappy(page, touch, vp, kind, seed, opts = {}) {
  const rand = makeRand(seed);
  const meta = await page.evaluate(() => ({ phys: window.__flappy.phys, course: window.__flappy.course(400) }));
  const P = meta.phys;
  const course = meta.course.map((o, i) => ({ ...o, i }));
  const cfg = {
    // lat: reaction time; comp: how much of it the player anticipates (1 = fully);
    // jitter: timing error of a tap; sloppy: aim error (share of the gap);
    // miss / extra: chance of a frozen thumb / a nervous double tap
    clumsy: { lat: [250, 400], comp: 0.6, jitter: 90, minGap: 240, sloppy: 0.22, anticipate: 22, miss: 0.08, extra: 0.06 },
    normal: { lat: [180, 250], comp: 0.85, jitter: 50, minGap: 170, sloppy: 0.12, anticipate: 38, miss: 0.03, extra: 0.02 },
    expert: { lat: [120, 150], comp: 1, jitter: 15, minGap: 110, sloppy: 0.03, anticipate: 60, miss: 0, extra: 0 },
    rhythm: {},
    mashTop: {},
  }[kind];
  let lastTap = 0;
  let aimErr = 0;
  let aimFor = -1;
  let hesitateUntil = 0;
  let last = null;
  let taps = 0;
  const t0 = Date.now();
  const hardEnd = Date.now() + (opts.maxMs || 200000);
  const doTap = async () => {
    const x = Math.round(vp.width * (0.2 + rand() * 0.6));
    const y = Math.round(vp.height * (0.35 + rand() * 0.4));
    await touch.tap(x, y);
    taps++;
  };
  const pending = [];
  /** y and vy after t seconds without a tap (the game's own integration, coarse). */
  const fall = (y, vy, t) => {
    const dt = 1 / 60;
    for (let k = 0; k < Math.round(t * 60); k++) {
      vy = Math.min(P.maxFall, vy + P.gravity * dt);
      y += vy * dt;
    }
    return { y, vy };
  };
  for (;;) {
    if (Date.now() > hardEnd) throw new Error(`${kind}: round did not end`);
    let st;
    try {
      st = await page.evaluate(FLAPPY_STATE);
    } catch {
      await sleep(30);
      continue;
    }
    if (!st) {
      await sleep(30);
      continue;
    }
    if (st.ended) break;
    last = st;
    const now = Date.now();
    // taps decided earlier land after the reaction time
    while (pending.length && pending[0] <= now) {
      pending.shift();
      await doTap();
    }
    if (st.frozen || st.mode === 'dead' || st.mode === 'over') {
      await sleep(16);
      continue;
    }
    if (kind === 'rhythm') {
      if (now - lastTap >= (opts.period || 420)) {
        lastTap = now;
        await doTap();
      }
      await sleep(8);
      continue;
    }
    if (kind === 'mashTop') {
      if (now - lastTap >= 150) {
        lastTap = now;
        await doTap();
      }
      await sleep(8);
      continue;
    }
    if (st.mode === 'hover') {
      if (now - t0 > 700 + rand() * 600 && !pending.length) pending.push(now + 300);
      await sleep(16);
      continue;
    }
    // which gap matters: the next one not passed yet; once inside it, look at the one after
    let idx = course.findIndex((o) => o.x - st.dist > -P.poleW / 2 - P.hitRadius);
    if (idx < 0) idx = 0;
    let o = course[idx];
    const rel = o.x - st.dist;
    if (rel < -P.headW * 0.2 && course[idx + 1] && course[idx + 1].x - st.dist < cfg.anticipate) o = course[idx + 1];
    else if (rel > cfg.anticipate && idx > 0) o = { gapY: st.y, gap: 40 }; // too far to care: keep height
    if (o.i !== aimFor && o.i !== undefined) {
      aimFor = o.i;
      aimErr = (rand() - 0.5) * 2 * cfg.sloppy * o.gap;
    }
    const aim = o.gapY + o.gap * 0.12 + aimErr;
    const lat = (cfg.lat[0] + rand() * (cfg.lat[1] - cfg.lat[0])) / 1000;
    // everyone anticipates gravity over their reaction time, the expert fully, a first-timer partly
    const seen = fall(st.y, st.vy, lat * cfg.comp);
    const want = seen.y > aim && seen.vy > -30;
    if (want && now - lastTap >= cfg.minGap && !pending.length) {
      if (now < hesitateUntil) {
        // frozen thumb
      } else if (rand() < cfg.miss) {
        hesitateUntil = now + 200 + rand() * 200;
      } else {
        lastTap = now;
        const at = now + lat * 1000 + (rand() - 0.5) * 2 * cfg.jitter;
        pending.push(at);
        if (rand() < cfg.extra) pending.push(at + 90 + rand() * 80); // nervous double tap
      }
    }
    await sleep(8);
  }
  const final = await page.evaluate(() => window.__party.score).catch(() => (last ? last.score : 0));
  const runs = last ? [...last.runs] : [];
  const sorted = [...runs].sort((a, b) => a - b);
  return {
    kind,
    score: final,
    runs: runs.length,
    runList: runs,
    medianRun: sorted[Math.floor(sorted.length / 2)],
    runsPast3: runs.filter((r) => r >= 3).length,
    taps,
  };
}

module.exports = { playFlappy, FLAPPY_STATE };
