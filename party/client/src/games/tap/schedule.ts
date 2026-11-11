/**
 * The level of "שימי טאפ": every face change, nose-pick window and hop of a
 * round, computed up front from the seed and the round length only, so every
 * phone in the room plays exactly the same show. Times are ms of round time.
 */
import { createRng } from '../../kit/rng';

/** Expressions the face cycles through (indexes into the face slots). */
export const EXPRESSION_COUNT = 6;

export interface PickWindow {
  readonly start: number;
  readonly end: number;
}

export interface Hop {
  readonly at: number;
  /** Target center, normalized 0..1 inside the free area of the play field. */
  readonly u: number;
  readonly v: number;
  /** Size factor of the face after the hop. */
  readonly scale: number;
}

export interface ExprChange {
  readonly at: number;
  readonly expr: number;
}

export interface TapLevel {
  readonly durationMs: number;
  /** Round time at which the face stops sitting still in the middle. */
  readonly hopsFrom: number;
  /** Round time at which the frenzy ("last 15 seconds") starts. */
  readonly frenzyFrom: number;
  readonly picks: readonly PickWindow[];
  readonly hops: readonly Hop[];
  readonly exprs: readonly ExprChange[];
  /** Short stable string of the whole level (for tests and logs). */
  readonly fingerprint: string;
}

/** Nose-pick windows are protected: no hop inside them or right before. */
const PICK_GUARD_BEFORE = 350;
const PICK_GUARD_AFTER = 250;

function inPick(picks: readonly PickWindow[], t: number): PickWindow | null {
  for (const p of picks) if (t >= p.start - PICK_GUARD_BEFORE && t <= p.end + PICK_GUARD_AFTER) return p;
  return null;
}

function hash(parts: readonly number[]): string {
  let h = 2166136261;
  for (const n of parts) {
    h ^= Math.round(n * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function buildLevel(seed: number, durationMs: number): TapLevel {
  const dur = Math.max(1000, durationMs);
  const root = createRng(seed);
  // Phases scale with the round so a shortened test round still shows them all.
  const hopsFrom = Math.min(12_000, dur * 0.2);
  const frenzyFrom = dur - Math.min(15_000, dur * 0.25);

  // ── nose picks ──
  const rp = root.fork('picks');
  const picks: PickWindow[] = [];
  let t = Math.min(rp.float(4_500, 6_000), dur * 0.15);
  while (t < dur - 1_400) {
    const len = rp.float(1_200, 1_800);
    picks.push({ start: t, end: Math.min(dur, t + len) });
    const late = t + len >= frenzyFrom;
    t += len + (late ? rp.float(4_200, 6_000) : rp.float(6_000, 9_000));
  }

  // ── hops ──
  const rh = root.fork('hops');
  const hops: Hop[] = [];
  let lastU = 0.5;
  let lastV = 0.5;
  t = hopsFrom;
  while (t < dur - 300) {
    const blocked = inPick(picks, t);
    if (blocked) {
      t = blocked.end + PICK_GUARD_AFTER + 1;
      continue;
    }
    const late = t >= frenzyFrom;
    let u = 0.5;
    let v = 0.5;
    for (let i = 0; i < 12; i++) {
      u = rh.next();
      v = rh.next();
      if (Math.hypot(u - lastU, v - lastV) >= 0.38) break;
    }
    const scale = late ? rh.float(0.7, 0.95) : rh.float(0.84, 1.08);
    hops.push({ at: t, u, v, scale });
    lastU = u;
    lastV = v;
    t += late ? rh.float(1_050, 1_750) : rh.float(2_400, 4_000);
  }

  // ── expressions ──
  const re = root.fork('faces');
  const exprs: ExprChange[] = [];
  let cur = 0;
  t = re.float(500, 1_000);
  while (t < dur) {
    let next = re.int(0, EXPRESSION_COUNT - 2);
    if (next >= cur) next++; // never the same face twice in a row
    cur = next;
    exprs.push({ at: t, expr: cur });
    t += t >= frenzyFrom ? re.float(450, 950) : re.float(550, 1_450);
  }

  const parts: number[] = [dur];
  for (const p of picks) parts.push(p.start, p.end);
  for (const h of hops) parts.push(h.at, h.u, h.v, h.scale);
  for (const e of exprs) parts.push(e.at, e.expr);

  return { durationMs: dur, hopsFrom, frenzyFrom, picks, hops, exprs, fingerprint: hash(parts) };
}
