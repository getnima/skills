/**
 * The pictures of the ninja throws (client/src/games/ninja/skins.ts) are looks only: which
 * food a throw wears and which host's bomb it is come from the finished schedule and never
 * change it. The schedule itself (client/src/games/ninja/waves.ts) is pinned here, so a
 * change of the rules cannot hide behind a change of the art.
 */
import { describe, expect, it } from 'vitest';

import { BOMB_KEYS, buildSkins, FOOD_KEYS, JOKE_EVERY, JOKE_FREE_START, JOKE_KEYS, TARGET_KEYS } from '../../client/src/games/ninja/skins';
import { buildSchedule, scheduleSignature, TARGET_VARIANTS } from '../../client/src/games/ninja/waves';
import { GAMES } from '../../shared/protocol';

const ROUND_MS = GAMES.ninja.durationMs;
const SEEDS = [1, 2, 3, 7, 11, 42, 1234, 31337, 987654321, 2 ** 31 + 5];

/** Skins of one kind of throw, in schedule order. */
function skinsOf(seed: number, durationMs: number, kind: 'fruit' | 'gold' | 'bomb'): number[] {
  const schedule = buildSchedule(seed, durationMs);
  const skins = buildSkins(schedule);
  const out: number[] = [];
  schedule.forEach((t, i) => {
    if (t.kind === kind) out.push(skins[i] ?? -1);
  });
  return out;
}

describe('ninja schedule (the rules) is what it was before the food pictures', () => {
  it('has the signatures recorded before the change', () => {
    // look-ninja.cjs proof, taken before the food set went in (30 s rounds)
    expect(scheduleSignature(buildSchedule(7, 30_000))).toBe('84:95ddef2f');
    expect(scheduleSignature(buildSchedule(11, 30_000))).toBe('70:d8238d03');
  });

  it('still draws its variant from the same five (the pictures no longer use it)', () => {
    expect(TARGET_VARIANTS).toBe(5);
    for (const seed of SEEDS) for (const t of buildSchedule(seed, ROUND_MS)) expect(t.variant).toBeLessThan(TARGET_VARIANTS);
  });
});

describe('ninja skins are looks only', () => {
  it('leaves the schedule untouched and gives the same skins every time', () => {
    for (const seed of SEEDS) {
      const schedule = buildSchedule(seed, ROUND_MS);
      const before = JSON.stringify(schedule);
      const a = buildSkins(schedule);
      const b = buildSkins(buildSchedule(seed, ROUND_MS));
      expect(JSON.stringify(schedule)).toBe(before);
      expect(scheduleSignature(schedule)).toBe(scheduleSignature(buildSchedule(seed, ROUND_MS)));
      expect(a.length).toBe(schedule.length);
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });

  it('differs between rounds', () => {
    const rounds = new Set(SEEDS.map((seed) => skinsOf(seed, ROUND_MS, 'fruit').slice(0, 11).join(',')));
    expect(rounds.size).toBeGreaterThan(SEEDS.length / 2);
  });
});

describe('ninja targets are the food set', () => {
  it('has 11 foods and 2 joke items', () => {
    expect(FOOD_KEYS.length).toBe(11);
    expect(JOKE_KEYS.length).toBe(2);
    expect(TARGET_KEYS.length).toBe(13);
    expect(new Set(TARGET_KEYS).size).toBe(13);
  });

  it('shows every food in every round, evenly, and never the same food twice in a row', () => {
    for (const seed of SEEDS) {
      const food = skinsOf(seed, ROUND_MS, 'fruit').filter((k) => k < FOOD_KEYS.length);
      const counts = new Array<number>(FOOD_KEYS.length).fill(0);
      for (const k of food) counts[k] = (counts[k] ?? 0) + 1;
      expect(Math.min(...counts)).toBeGreaterThan(0);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      for (let i = 1; i < food.length; i++) expect(food[i]).not.toBe(food[i - 1]);
      // dealt in bags: every 11 food throws from the start hold all 11
      for (let i = 0; i + FOOD_KEYS.length <= food.length; i += FOOD_KEYS.length) expect(new Set(food.slice(i, i + FOOD_KEYS.length)).size).toBe(FOOD_KEYS.length);
    }
  });

  it('shows the joke items rarely, taking turns, never at the start and never back to back', () => {
    for (const seed of SEEDS) {
      const all = skinsOf(seed, ROUND_MS, 'fruit');
      const at: number[] = [];
      all.forEach((k, i) => {
        if (k >= FOOD_KEYS.length) at.push(i);
      });
      const jokes = at.map((i) => all[i] ?? -1);
      expect(Math.min(...at)).toBeGreaterThanOrEqual(JOKE_FREE_START);
      // one per block of JOKE_EVERY, so both come in a full round and they stay rare
      expect(jokes.length).toBeGreaterThanOrEqual(2);
      expect(jokes.length).toBeLessThanOrEqual(Math.ceil((all.length - JOKE_FREE_START) / JOKE_EVERY));
      expect(new Set(jokes).size).toBe(JOKE_KEYS.length);
      for (let i = 1; i < jokes.length; i++) expect(jokes[i]).not.toBe(jokes[i - 1]);
      for (let i = 1; i < at.length; i++) expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThan(1);
      for (const k of all) expect(k).toBeLessThan(TARGET_KEYS.length);
    }
  });

  it('keeps one look for the golden target', () => {
    for (const seed of SEEDS) for (const k of skinsOf(seed, ROUND_MS, 'gold')) expect(k).toBe(0);
  });
});

describe('ninja bombs are the two hosts, taking turns', () => {
  it('alternates A, B, A, B through the whole round, so both hosts appear', () => {
    for (const seed of SEEDS) {
      const bombs = skinsOf(seed, ROUND_MS, 'bomb');
      expect(bombs.length).toBeGreaterThanOrEqual(2);
      for (const k of bombs) expect(k).toBeLessThan(BOMB_KEYS.length);
      for (let i = 1; i < bombs.length; i++) expect(bombs[i]).toBe(1 - (bombs[i - 1] ?? 0));
    }
  });

  it('lets either host open a round', () => {
    const first = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) first.add(skinsOf(seed, ROUND_MS, 'bomb')[0] ?? -1);
    expect([...first].sort()).toEqual([0, 1]);
  });
});
