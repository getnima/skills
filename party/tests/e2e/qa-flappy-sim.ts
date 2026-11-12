// flappy as an elimination round, simulated (no browser, no server): how long whole rounds
// last with 12 and with 60 guests of mixed skill, and how long the best pilot survives the
// finale. Uses the game's own course and pilot (client/src/games/flappy/course.ts, bot.ts).
//   npx tsx tests/e2e/qa-flappy-sim.ts
import { guestPilot, simulateField, simulateFlight } from '../../client/src/games/flappy/bot';
import { createFlight, FINALE_IMPOSSIBLE_S, STEP_HZ } from '../../client/src/games/flappy/course';
import { FINALE_LATEST_MS, FINALE_SMALL_FIELD_MS, GAMES } from '../../shared/protocol';

const CAP = (GAMES.flappy.durationMs / 1000) * STEP_HZ;
const s = (steps: number | null): string => (steps === null ? '-' : (steps / STEP_HZ).toFixed(1));

console.log('single guests (20 seeds each): seconds in the air min / median / max, obstacles passed min / median');
for (const skill of [0, 0.3, 0.6, 0.85, 1]) {
  const t: number[] = [];
  const p: number[] = [];
  for (let k = 1; k <= 20; k++) {
    const r = simulateFlight(createFlight(k * 31), CAP, guestPilot(k * 17, skill));
    t.push(r.diedAtStep ?? CAP);
    p.push(r.passed);
  }
  t.sort((a, b) => a - b);
  p.sort((a, b) => a - b);
  console.log(`  skill ${skill}: ${s(t[0] ?? 0)} / ${s(t[10] ?? 0)} / ${s(t[19] ?? 0)} s, passed ${p[0]} / ${p[10]}`);
}

console.log(`\nthe finale: a perfect-play pilot, seconds survived after it begins (nobody can pass ${FINALE_IMPOSSIBLE_S} s + one obstacle)`);
for (const at of [3, 8, 20, 40, 60]) {
  const out: number[] = [];
  for (let k = 1; k <= 30; k++) {
    const f = createFlight(k * 104729 + at);
    f.setFinale(at * STEP_HZ);
    out.push(((simulateFlight(f, CAP).diedAtStep ?? CAP) - at * STEP_HZ) / STEP_HZ);
  }
  out.sort((a, b) => a - b);
  console.log(`  finale at ${at} s: min ${out[0]?.toFixed(1)}, median ${out[15]?.toFixed(1)}, max ${out[29]?.toFixed(1)} s`);
}

console.log('\nwhole rounds (guests of skill 0.15-0.95): finale at / round ends at');
const skills = (n: number, seed: number): number[] => Array.from({ length: n }, (_, i) => 0.15 + (((i * 2654435761 + seed * 40503) >>> 0) / 4294967296) * 0.8);
for (const n of [2, 4, 12, 30, 60]) {
  const rows: string[] = [];
  let sum = 0;
  let max = 0;
  const runs = 8;
  for (let k = 1; k <= runs; k++) {
    const r = simulateField(k * 7 + 1, skills(n, k), CAP, (FINALE_LATEST_MS / 1000) * STEP_HZ, (FINALE_SMALL_FIELD_MS / 1000) * STEP_HZ);
    rows.push(`${s(r.finaleStep)}/${s(r.endStep)}`);
    sum += r.endStep / STEP_HZ;
    max = Math.max(max, r.endStep / STEP_HZ);
  }
  console.log(`  ${String(n).padStart(2)} guests: ${rows.join('  ')}   mean ${(sum / runs).toFixed(1)} s, longest ${max.toFixed(1)} s`);
}
