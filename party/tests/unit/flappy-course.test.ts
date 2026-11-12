/**
 * The flappy flight (client/src/games/flappy/course.ts): one deterministic course in round
 * time, the finale difficulty function, the survival score, and how long anybody can last.
 */
import { describe, expect, it } from 'vitest';

import { guestPilot, pilotFlap, simulateField, simulateFlight } from '../../client/src/games/flappy/bot';
import {
  createFlight,
  FIELD,
  FINALE,
  FINALE_IMPOSSIBLE_S,
  finaleDifficulty,
  PHYS,
  STEP_HZ,
  STEP_S,
  survivalRaw,
  TUNE,
} from '../../client/src/games/flappy/course';
import { createSimField } from '../../client/src/games/flappy/sim-field';
import { FINALE_LATEST_MS, FINALE_LEAD_MS, FINALE_SMALL_FIELD_MS, GAMES } from '../../shared/protocol';

const CAP_STEPS = (GAMES.flappy.durationMs / 1000) * STEP_HZ;
const SEEDS = [1, 7, 42, 1234, 0xdeadbeef, 987654321, 2 ** 31 + 5, 31337];

function obstacles(seed: number, finale: number | null, n: number): Array<{ x: number; gapY: number; gap: number }> {
  const f = createFlight(seed);
  f.setFinale(finale);
  return Array.from({ length: n }, (_, i) => {
    const o = f.get(i);
    return { x: o.x, gapY: o.gapY, gap: o.gap };
  });
}

describe('the course', () => {
  it('is a pure function of the seed: the same on every phone, different for another seed', () => {
    for (const seed of SEEDS) {
      expect(obstacles(seed, null, 120)).toEqual(obstacles(seed, null, 120));
      const a = createFlight(seed);
      const b = createFlight(seed);
      // one phone asks far ahead first, the other step by step
      b.distAt(5000);
      for (const k of [0, 1, 59, 600, 2400, 5399]) expect(a.distAt(k)).toBe(b.distAt(k));
    }
    expect(obstacles(1, null, 20)).not.toEqual(obstacles(2, null, 20));
  });

  it('starts generous and ramps gently: wide first gaps, small moves, everything inside the field', () => {
    for (const seed of SEEDS) {
      const list = obstacles(seed, null, 80);
      expect(list[0]?.x).toBe(PHYS.firstLead);
      for (let i = 0; i <= TUNE.easyCount; i++) expect(list[i]?.gap).toBeGreaterThan(TUNE.gapStart - 1.3);
      for (let i = 1; i < list.length; i++) {
        const o = list[i]!;
        const p = list[i - 1]!;
        expect(o.x - p.x).toBeGreaterThan(TUNE.spacingEnd - 2.6);
        expect(o.gap).toBeGreaterThan(TUNE.gapEnd - 1.3);
        expect(o.gapY - o.gap / 2).toBeGreaterThanOrEqual(8.9);
        expect(o.gapY + o.gap / 2).toBeLessThanOrEqual(FIELD - 8.9);
        expect(Math.abs(o.gapY - p.gapY)).toBeLessThanOrEqual(TUNE.jumpEnd + 1e-9);
      }
      // the first three gaps move at most a few units: a first-timer can hold a line
      for (let i = 1; i <= 3; i++) expect(Math.abs(list[i]!.gapY - list[i - 1]!.gapY)).toBeLessThanOrEqual(TUNE.jumpStart + 1e-9);
    }
  });

  it('the distance is a function of round time only: monotonic, at the documented speeds', () => {
    const f = createFlight(5);
    let prev = 0;
    for (let k = 1; k <= CAP_STEPS; k++) {
      const d = f.distAt(k);
      const v = (d - prev) / STEP_S;
      expect(v).toBeGreaterThanOrEqual(TUNE.speedStart - 1e-6);
      expect(v).toBeLessThanOrEqual(TUNE.speedEnd + 1e-6);
      prev = d;
    }
    expect(f.stepAtDist(f.distAt(777))).toBe(777);
    expect(f.nextIndex(0)).toBe(0);
  });
});

describe('the finale difficulty function', () => {
  it('is pure and monotonic in time: gaps and spacing only shrink, the jump and the speed only grow', () => {
    let prev = finaleDifficulty(0);
    expect(prev).toEqual({ stage: 0, gap: FINALE.gap0, jump: FINALE.jump0, spacing: FINALE.spacing0, speed: 1 });
    for (let t = 0.05; t <= 60; t += 0.05) {
      const d = finaleDifficulty(t);
      expect(d).toEqual(finaleDifficulty(t));
      expect(d.stage).toBeGreaterThanOrEqual(prev.stage);
      expect(d.gap).toBeLessThanOrEqual(prev.gap);
      expect(d.spacing).toBeLessThanOrEqual(prev.spacing);
      expect(d.jump).toBeGreaterThanOrEqual(prev.jump);
      expect(d.speed).toBeGreaterThanOrEqual(prev.speed);
      prev = d;
    }
    // it steps: one stage every 2.5 s
    expect(finaleDifficulty(2.49).stage).toBe(0);
    expect(finaleDifficulty(2.5).stage).toBe(1);
    expect(finaleDifficulty(25).gap).toBeLessThan(2 * PHYS.hitRadius - 1.2);
    expect(FINALE_IMPOSSIBLE_S).toBe(25);
  });

  it('the course is deterministic in (seed, finale step): whenever a phone learns of the finale, whatever it built before', () => {
    for (const seed of SEEDS) {
      for (const finale of [300, 1200, 2400, 3600]) {
        const want = obstacles(seed, finale, 140);
        // a phone that had built the whole plain course first (a late message, a reload)
        const late = createFlight(seed);
        for (let i = 0; i < 140; i++) late.get(i);
        late.distAt(5400);
        late.setFinale(finale);
        // a phone that first heard a wrong step and was corrected
        const fixed = createFlight(seed);
        fixed.setFinale(finale + 37);
        fixed.get(139);
        fixed.setFinale(finale);
        // a phone that set it, cleared it and set it again
        const again = createFlight(seed);
        again.setFinale(finale);
        again.get(90);
        again.setFinale(null);
        again.get(90);
        again.setFinale(finale);
        for (const f of [late, fixed, again]) {
          expect(Array.from({ length: 140 }, (_, i) => ({ x: f.get(i).x, gapY: f.get(i).gapY, gap: f.get(i).gap }))).toEqual(want);
          const ref = createFlight(seed);
          ref.setFinale(finale);
          for (const k of [finale - 1, finale, finale + 1, finale + 600, 5400]) expect(f.distAt(k)).toBe(ref.distAt(k));
        }
      }
    }
  });

  it('nothing before the finale changes; after it the course is harder and faster than without it', () => {
    for (const seed of SEEDS) {
      const finale = 1500;
      const plain = createFlight(seed);
      const hard = createFlight(seed);
      hard.setFinale(finale);
      for (let k = 0; k <= finale + 1; k++) expect(hard.distAt(k)).toBe(plain.distAt(k));
      for (let k = finale + 2; k < finale + 1800; k += 60) expect(hard.distAt(k)).toBeGreaterThan(plain.distAt(k));
      const dF = plain.distAt(finale);
      let i = 0;
      // every obstacle the bird reaches before the finale begins is the same
      for (; plain.get(i).x < dF; i++) expect(hard.get(i)).toEqual(plain.get(i));
      // the first obstacle built after it already follows the finale rules
      const first = hard.get(i + 1);
      expect(first.gap).toBeLessThanOrEqual(FINALE.gap0 + 1.2);
      // and from there the gaps shrink stage by stage down to nothing a bird fits through
      let lastStage = -1;
      let lastMax = Infinity;
      for (let j = i + 1; j < i + 60; j++) {
        const tau = (hard.stepAtDist(hard.get(j - 1).x) - finale) * STEP_S;
        const d = finaleDifficulty(tau);
        expect(hard.get(j).gap).toBeLessThanOrEqual(d.gap + 1.2 + 1e-9);
        expect(hard.get(j).x - hard.get(j - 1).x).toBeLessThanOrEqual(d.spacing + 2.5 + 1e-9);
        expect(d.stage).toBeGreaterThanOrEqual(lastStage);
        expect(d.gap).toBeLessThanOrEqual(lastMax);
        lastStage = d.stage;
        lastMax = d.gap;
        if (tau >= FINALE_IMPOSSIBLE_S) expect(hard.get(j).gap).toBeLessThan(2 * PHYS.hitRadius);
      }
    }
  });
});

describe('how long anybody can last', () => {
  it('before the finale the course is flyable: a strong pilot is still in the air after 60 s', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const r = simulateFlight(createFlight(seed), 60 * STEP_HZ);
      expect(r.diedAtStep).toBeNull();
      expect(r.passed).toBeGreaterThan(40);
    }
  });

  it('a guest who never taps hangs for 1.5 s, falls and is out before the first obstacle', () => {
    const r = simulateFlight(createFlight(9), CAP_STEPS, () => false);
    expect(r.diedAtStep).not.toBeNull();
    expect((r.diedAtStep ?? 0) / STEP_HZ).toBeGreaterThan(1.5);
    expect((r.diedAtStep ?? 0) / STEP_HZ).toBeLessThan(3);
    expect(r.passed).toBe(0);
    expect(r.dist).toBeLessThan(PHYS.firstLead);
  });

  it('in the finale a perfect-play pilot is down within 22 s, whenever the finale begins; nobody can pass 25 s + one obstacle', () => {
    let worst = 0;
    for (const finaleS of [3, 8, 20, 40, 60]) {
      for (let s = 1; s <= 12; s++) {
        const f = createFlight(s * 104729 + finaleS);
        f.setFinale(finaleS * STEP_HZ);
        const r = simulateFlight(f, CAP_STEPS, (step, bird, fl) => pilotFlap(fl, step, bird));
        expect(r.diedAtStep).not.toBeNull();
        worst = Math.max(worst, (r.diedAtStep ?? CAP_STEPS) / STEP_HZ - finaleS);
      }
    }
    expect(worst).toBeLessThan(22);
    // the hard bound, by geometry: every gap reached 25 s into the finale is narrower than the bird
    expect(FINALE_LATEST_MS / 1000 + FINALE_IMPOSSIBLE_S + 2).toBeLessThan(GAMES.flappy.durationMs / 1000);
  });

  it('whole rounds with 12 and with 60 simulated guests resolve well before the cap, with one last one standing', () => {
    const skills = (n: number, seed: number): number[] => Array.from({ length: n }, (_, i) => 0.15 + (((i * 2654435761 + seed * 40503) >>> 0) / 4294967296) * 0.8);
    const latest = (FINALE_LATEST_MS / 1000) * STEP_HZ;
    for (const n of [12, 60]) {
      for (let s = 1; s <= 3; s++) {
        const r = simulateField(s * 7 + 1, skills(n, s), CAP_STEPS, latest, (FINALE_SMALL_FIELD_MS / 1000) * STEP_HZ);
        expect(r.finaleStep).not.toBeNull();
        expect(r.endStep / STEP_HZ).toBeLessThan(GAMES.flappy.durationMs / 1000 - 3);
        expect(r.endStep / STEP_HZ).toBeGreaterThan(8);
        // exactly one outlasts everybody: no two guests go down in the same step at the very end
        const order = r.diedAt.map((d) => d ?? Infinity).sort((a, b) => b - a);
        expect(order[0]).toBeGreaterThan(order[1] ?? 0);
      }
    }
  });

  it('a guest with a clumsy thumb usually gets through the first obstacles', () => {
    let through = 0;
    for (let s = 1; s <= 40; s++) {
      const r = simulateFlight(createFlight(s * 31), CAP_STEPS, guestPilot(s * 17, 0.3));
      if (r.passed >= 3) through++;
    }
    expect(through).toBeGreaterThanOrEqual(22);
  });
});

describe('the survival score', () => {
  it('grows with every step of round time: two crashes at different moments never give the same number', () => {
    for (const finale of [null, 900]) {
      const f = createFlight(3);
      f.setFinale(finale);
      let prev = 0;
      for (let k = 1; k <= CAP_STEPS; k++) {
        const raw = survivalRaw(f.distAt(k));
        expect(Number.isInteger(raw)).toBe(true);
        expect(raw).toBeGreaterThan(prev);
        prev = raw;
      }
      expect(prev).toBeLessThanOrEqual(GAMES.flappy.maxRaw);
    }
    expect(survivalRaw(0)).toBe(1);
  });

  it('two phones that crash in the same gap: the one that flew longer has the higher score', () => {
    const f = createFlight(11);
    const o = f.get(4);
    const enter = f.stepAtDist(o.x - 5);
    const a = survivalRaw(f.distAt(enter + 2));
    const b = survivalRaw(f.distAt(enter + 3));
    expect(b).toBeGreaterThan(a);
  });
});

describe('the dev harness field (?field=N)', () => {
  it('drops opponents on a seeded schedule and announces the finale by the server rule', () => {
    const run = (seed: number, n: number): { finale: number | null; ends: number[] } => {
      const sim = createSimField(seed, n);
      const ends: number[] = [];
      let before = sim.active();
      for (let t = 0; t <= 60_000; t += 50) {
        sim.update(t, true);
        if (sim.active() !== before) {
          before = sim.active();
          ends.push(t);
        }
      }
      return { finale: sim.finaleAtMs, ends };
    };
    expect(run(7, 8)).toEqual(run(7, 8));
    expect(run(7, 8)).not.toEqual(run(8, 8));
    const r = run(7, 8);
    expect(r.ends).toHaveLength(8); // all eight go down, this phone outlasts them
    // 9 in the field: the finale comes 3 s after the 6th crash (3 left)
    expect(r.finale).toBe((r.ends[5] ?? 0) + FINALE_LEAD_MS);
    for (const t of r.ends.slice(6)) expect(t).toBeGreaterThan(r.finale ?? 0);
    expect(createSimField(1, 1).finaleAtMs).toBe(FINALE_SMALL_FIELD_MS);
    expect(createSimField(1, 0, 8_000).finaleAtMs).toBe(8_000);
    const sim = createSimField(3, 5);
    sim.update(1_000, false);
    const field = sim.field();
    expect(field.players).toHaveLength(6);
    expect(field.players.at(-1)).toMatchObject({ me: true, out: true });
    expect(sim.active()).toBe(5);
  });
});
