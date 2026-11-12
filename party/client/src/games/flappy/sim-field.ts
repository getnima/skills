/**
 * Dev harness only (/dev.html?game=flappy&field=8): a simulated field of opponents that
 * drop out on a seeded schedule, so the finale, the "out" view and the win can be played
 * and screenshotted without a server. Pure in (seed, count, round time): no DOM.
 *
 * It follows the server's rules: the finale is announced when 3 are left (participants - 1
 * for a field of 3 or 4; a fixed 20 s for 1 or 2), 3 s of round time ahead.
 */
import { FINALE_LEAD_MS, FINALE_PLAYERS, FINALE_SMALL_FIELD_MS } from '../../../../shared/protocol';

import type { FieldPlayer, RoundField } from '../types';

/** Dolls for the simulated guests (encoded looks, shared/avatar.ts): towers, glasses, ears, neck items. */
const LOOKS = [
  '1.8.8-17.9.0.11.7', '1.5.10-8-17.201.13.229.325', '1.2.12.206.0.11.0', '1.4.14.9.301.226.15', '1.6.4.202.0.0.329', '1.3.106.0.0.0.0',
  '1.9.2-16.0.303.227.0', '1.10.104.204.0.225.326', '1.1.0.203.6.0.15', '1.7.112.0.0.228.0', '1.11.110.205.0.0.330', '1.0.3-1.9.13.11.328',
] as const;

const NAMES = ['נועה', 'איתי', 'מאיה', 'עומר', 'שירה', 'יואב', 'תמר', 'דניאל', 'רוני', 'גיא', 'ליה', 'עידו', 'אלה', 'נדב', 'יעל', 'אורי'] as const;

function rand(seed: number, i: number): number {
  let t = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i + 7, 0x85ebca6b)) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface SimField {
  /** Advance to this round time. `meAlive`: the player of this phone is still flying. */
  update(elapsedMs: number, meAlive: boolean): void;
  /** Still flying, this phone included while it is. */
  active(): number;
  finaleInMs(elapsedMs: number): number | null;
  /** Elapsed ms at which the finale begins; null until announced. */
  readonly finaleAtMs: number | null;
  field(): RoundField;
}

interface Opp {
  readonly id: string;
  readonly name: string;
  readonly avatar: number;
  /** A doll, as every guest of a room has one (looks only). */
  readonly look: string;
  /** Round time at which it crashes (pre-finale schedule). */
  dieAt: number;
  out: boolean;
  outAt: number;
}

/** `count` opponents; `forcedFinaleMs` pins the finale to a round time (fairness tests). */
export function createSimField(seed: number, count: number, forcedFinaleMs: number | null = null): SimField {
  const n = Math.max(0, Math.min(59, Math.floor(count)));
  const field = n + 1;
  const threshold = Math.min(FINALE_PLAYERS, field - 1);
  // deaths spread over 3..26 s, earliest first; the last ones are re-timed when the finale begins
  const opps: Opp[] = [];
  for (let i = 0; i < n; i++) {
    opps.push({ id: `sim${i}`, name: NAMES[i % NAMES.length] ?? 'שחקן', avatar: i + 1, look: LOOKS[(i + Math.floor(rand(seed, 200) * LOOKS.length)) % LOOKS.length] ?? '1.0.0.0.0.0.0', dieAt: 3_000 + rand(seed, i) * 23_000, out: false, outAt: 0 });
  }
  opps.sort((a, b) => a.dieAt - b.dieAt);
  let finaleAt: number | null = forcedFinaleMs ?? (field <= 2 ? FINALE_SMALL_FIELD_MS : null);
  let retimed = false;
  let meOut = false;
  let meOutAt = 0;
  let cached: RoundField | null = null;

  function alive(): number {
    let k = 0;
    for (const o of opps) if (!o.out) k++;
    return k;
  }

  return {
    get finaleAtMs(): number | null {
      return finaleAt;
    },
    update(elapsedMs: number, meAlive: boolean): void {
      if (!meAlive && !meOut) {
        meOut = true;
        meOutAt = elapsedMs;
        cached = null;
      }
      for (const o of opps) {
        if (!o.out && elapsedMs >= o.dieAt) {
          o.out = true;
          o.outAt = o.dieAt;
          cached = null;
        }
      }
      const left = alive() + (meOut ? 0 : 1);
      if (finaleAt === null && field > 2 && left <= threshold && left > 1) finaleAt = Math.round(elapsedMs) + FINALE_LEAD_MS;
      if (finaleAt !== null && !retimed) {
        retimed = true;
        // whoever is still in goes down in the finale: 4..16 s after it begins, one by one
        let k = 0;
        for (const o of opps) {
          if (o.out) continue;
          o.dieAt = Math.max(o.dieAt, finaleAt + 4_000 + k * 3_500 + rand(seed, 100 + k) * 2_500);
          k++;
        }
      }
    },
    active: (): number => alive() + (meOut ? 0 : 1),
    finaleInMs: (elapsedMs: number): number | null => (finaleAt === null ? null : finaleAt - elapsedMs),
    field(): RoundField {
      if (cached) return cached;
      // strict live order: still flying first, then out, latest crash first
      const rows: Array<FieldPlayer & { at: number }> = opps.map((o) => ({ id: o.id, name: o.name, avatar: o.avatar, look: o.look, out: o.out, me: false, at: o.out ? o.outAt : Infinity }));
      rows.push({ id: 'me', name: 'אני', avatar: 0, out: meOut, me: true, at: meOut ? meOutAt : Infinity });
      rows.sort((a, b) => b.at - a.at);
      cached = { players: rows, outRaw: null };
      return cached;
    },
  };
}
