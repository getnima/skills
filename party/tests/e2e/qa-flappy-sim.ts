// Node simulation of flappy (the game's own course + collision) with the QA player models.
// Tuning tool, not a browser test. From the party folder:
//   npx tsx tests/e2e/qa-flappy-sim.ts [rounds=20] [kinds=clumsy,normal,expert,rhythm:420,mashTop]
// Override any PHYS / TUNE knob with FL_<name>=<value> (e.g. FL_gapStart=52).
import { createCourse, FIELD, hitsObstacle, PHYS, speedAt, TUNE } from '../../client/src/games/flappy/course';

const DT = 1 / 60;
const GLIDE = 1.1;
const DEAD = 0.72;
const HOVER_Y = FIELD * 0.42;
/** What a new run starts in: 'hover' (waits for the first tap) or 'glide' (the old 1.1 s glide). */
const RESPAWN = process.env.FL_RESPAWN || 'hover';
/** Timing error of a person tapping to a beat (s, uniform +-). */
const RHYTHM_JITTER = Number(process.env.FL_RHYTHM_JITTER || 0);
const P = PHYS as unknown as Record<keyof typeof PHYS, number>;
// tuning experiments: FL_gravity=230 FL_maxFall=100 ... npx tsx qa-flappy-sim.ts
for (const key of Object.keys(P) as Array<keyof typeof PHYS>) {
  const v = process.env[`FL_${key}`];
  if (v !== undefined) P[key] = Number(v);
}
const T = TUNE as Record<keyof typeof TUNE, number>;
for (const key of Object.keys(T) as Array<keyof typeof TUNE>) {
  const v = process.env[`FL_${key}`];
  if (v !== undefined) T[key] = Number(v);
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const KINDS: Record<string, { lat: [number, number]; comp: number; jitter: number; minGap: number; sloppy: number; anticipate: number; miss: number; extra: number }> = {
  // a second first-timer model: taps as soon as the bird is falling and not above the gap centre
  novice: { lat: [0.25, 0.4], comp: 0, jitter: 0.08, minGap: 0.3, sloppy: 0.2, anticipate: 25, miss: 0.08, extra: 0.06 },
  clumsy: { lat: [0.25, 0.4], comp: 0.6, jitter: 0.09, minGap: 0.24, sloppy: 0.22, anticipate: 22, miss: 0.08, extra: 0.06 },
  normal: { lat: [0.18, 0.25], comp: 0.85, jitter: 0.05, minGap: 0.17, sloppy: 0.12, anticipate: 38, miss: 0.03, extra: 0.02 },
  expert: { lat: [0.12, 0.15], comp: 1, jitter: 0.015, minGap: 0.11, sloppy: 0.03, anticipate: 60, miss: 0, extra: 0 },
};

export function sim(kind: string, seed: number, durS: number, period = 0.42): { runs: number[]; deaths: string[] } {
  const course = createCourse(seed);
  const r = rng(seed * 7 + kind.length);
  const k = KINDS[kind];
  let mode: 'hover' | 'glide' | 'fly' | 'dead' = 'hover';
  let y = HOVER_Y, vy = 0, dist = 0, modeT = 0, nextIdx = 0, run = 0;
  const runs: number[] = [];
  const deaths: string[] = [];
  const pending: number[] = [];
  let lastTap = -9, hes = -1, aimFor = -1, aimErr = 0;
  const steps = Math.round(durS * 60);
  for (let st = 0; st < steps; st++) {
    const t = st * DT;
    const left = durS - t;
    let flap = false;
    while (pending.length && (pending[0] ?? 99) <= t) { pending.shift(); if (mode === 'hover' || mode === 'glide' || mode === 'fly') flap = true; }
    // ── player decision (sees the state at t) ──
    if (mode !== 'dead') {
      if (kind.startsWith('rhythm')) { if (t - lastTap >= period) { lastTap = t; pending.push(t + (r() - 0.5) * 2 * RHYTHM_JITTER); } }
      else if (kind === 'mashTop') { if (t - lastTap >= 0.15) { lastTap = t; pending.push(t); } }
      else if (mode === 'hover') { if (modeT > 0.5 + r() * 0.8 && !pending.length) pending.push(t + 0.3); }
      else if (k) {
        let idx = nextIdx;
        let o = course.get(idx);
        const rel = o.x - dist;
        let gapY = o.gapY, gap = o.gap, oi = o.i;
        const n1 = course.get(idx + 1);
        if (rel < -P.headW * 0.2 && n1.x - dist < k.anticipate) { gapY = n1.gapY; gap = n1.gap; oi = n1.i; }
        else if (rel > k.anticipate && idx > 0) { gapY = y; gap = 40; oi = -2; }
        if (oi !== aimFor) { aimFor = oi; aimErr = (r() - 0.5) * 2 * k.sloppy * gap; }
        const aim = kind === 'novice' ? gapY - gap * 0.1 + aimErr : gapY + gap * 0.12 + aimErr;
        const lat = k.lat[0] + r() * (k.lat[1] - k.lat[0]);
        let fy = y, fvy = mode === 'glide' ? 0 : vy;
        for (let i = 0; i < Math.round(lat * k.comp * 60); i++) { fvy = Math.min(P.maxFall, fvy + P.gravity * DT); fy += fvy * DT; }
        const falling = kind === 'novice' ? fvy > 30 : fvy > -30;
        if (fy > aim && falling && t - lastTap >= k.minGap && !pending.length) {
          if (t < hes) { /* frozen */ }
          else if (r() < k.miss) hes = t + 0.2 + r() * 0.2;
          else {
            lastTap = t;
            const at = t + lat + (r() - 0.5) * 2 * k.jitter;
            pending.push(at);
            if (r() < k.extra) pending.push(at + 0.09 + r() * 0.08);
          }
        }
      }
    }
    if (process.env.FL_DEBUG && seed === 101 && st % 6 === 0 && st < 600) console.log(t.toFixed(2), mode, y.toFixed(1), vy.toFixed(0), 'next', (course.get(nextIdx).x - dist).toFixed(0), course.get(nextIdx).gapY.toFixed(0), course.get(nextIdx).gap.toFixed(0), flap ? 'FLAP' : '');
    // ── game step ──
    modeT += DT;
    switch (mode) {
      case 'hover':
        if (flap) { mode = 'fly'; vy = P.flapVy; modeT = 0; }
        break;
      case 'glide': {
        y = HOVER_Y;
        dist += speedAt(dist) * DT;
        if (flap) { mode = 'fly'; vy = P.flapVy; modeT = 0; }
        else if (modeT >= GLIDE) { mode = 'fly'; modeT = 0; vy = 0; }
        break;
      }
      case 'fly': {
        if (flap) vy = P.flapVy;
        vy = Math.min(P.maxFall, vy + P.gravity * DT);
        y += vy * DT;
        if (y < P.radius * 0.6) { y = P.radius * 0.6; if (vy < 0) vy = 0; }
        dist += speedAt(dist) * DT;
        for (;;) { const o = course.get(nextIdx); if (o.x - dist < -P.poleW / 2 - P.hitRadius) { run++; nextIdx++; } else break; }
        if (y + P.hitRadius >= FIELD) { runs.push(run); deaths.push(`g${nextIdx}`); mode = 'dead'; modeT = 0; }
        else if (hitsObstacle(course, nextIdx, dist, 0, y)) { runs.push(run); deaths.push(`o${nextIdx}${y < course.get(nextIdx).gapY ? 't' : 'b'}`); mode = 'dead'; modeT = 0; }
        break;
      }
      case 'dead':
        if (modeT >= DEAD) {
          if (left > 1.3) { mode = RESPAWN as 'glide'; modeT = 0; run = 0; dist = 0; nextIdx = 0; y = HOVER_Y; vy = 0; }
          else { mode = 'dead'; modeT = -999; }
        }
        break;
    }
  }
  if (mode !== 'dead') runs.push(run);
  return { runs, deaths };
}

const N = Number(process.argv[2] || 20);
const kinds = (process.argv[3] || 'clumsy,normal,expert,rhythm,mashTop').split(',');
for (const kind of kinds) {
  const best: number[] = [];
  const all: number[] = [];
  const dcount: Record<string, number> = {};
  let runsN = 0;
  for (let s = 1; s <= N; s++) {
    const res = sim(kind.split(':')[0] === 'rhythm' ? 'rhythm' : kind, s * 101, 60, Number(kind.split(':')[1] || 420) / 1000);
    best.push(Math.max(0, ...res.runs));
    all.push(...res.runs);
    runsN += res.runs.length;
    for (const d of res.deaths) { const key = d.replace(/\d+/, (m) => (Number(m) > 4 ? '5+' : m)); dcount[key] = (dcount[key] ?? 0) + 1; }
  }
  best.sort((a, b) => a - b);
  all.sort((a, b) => a - b);
  const past3 = all.filter((v) => v >= 3).length;
  console.log(kind.padEnd(10), 'best med', best[Math.floor(N / 2)], 'min', best[0], 'max', best[N - 1], '| runs/round', (runsN / N).toFixed(1), 'run median', all[Math.floor(all.length / 2)], 'past3', `${Math.round((100 * past3) / all.length)}%`, '| deaths', JSON.stringify(dcount));
}
