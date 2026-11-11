/**
 * The event engine of the funny layer: feed it consecutive samples of a race
 * and it reports the moments worth shouting about. Pure (no DOM, no clock,
 * no randomness): the same samples always give the same moments.
 */

export const MOMENT_TYPES = [
  'lead', // a new leader took over
  'overtake', // a passed b near the top
  'jump', // one big score jump
  'drop', // a score went DOWN (the bomb!)
  'tie', // dead heat at the top
  'last', // a friendly word for the last place
  'comeback', // from the bottom half to the top three
  'zero', // still on zero after 15 seconds
  'final10', // ten seconds left
  'photo', // photo finish: the top two almost level in the last seconds
  'streak', // keeps climbing: on fire
] as const;
export type MomentType = (typeof MOMENT_TYPES)[number];

export interface Who {
  readonly id: string;
  readonly name: string;
}

export interface Moment {
  readonly type: MomentType;
  readonly a: Who | null;
  readonly b: Who | null;
  /** 1..10: higher wins the commentator when moments collide. */
  readonly priority: number;
}

export interface RaceEntry {
  readonly id: string;
  readonly name: string;
  readonly score: number;
}

export interface RaceSample {
  /** Round time elapsed in ms (stands still while frozen). */
  readonly elapsedMs: number;
  readonly leftMs: number;
  readonly frozen: boolean;
  /** Sorted best first. */
  readonly entries: readonly RaceEntry[];
}

export interface MomentEngine {
  update(sample: RaceSample): Moment[];
  reset(): void;
}

export const MOMENT_PRIORITY: Readonly<Record<MomentType, number>> = {
  final10: 10,
  drop: 9,
  photo: 9,
  lead: 8,
  comeback: 7,
  tie: 7,
  streak: 5,
  jump: 5,
  zero: 4,
  last: 4,
  overtake: 3,
};

export function makeMoment(type: MomentType, a: Who | null = null, b: Who | null = null): Moment {
  return { type, a, b, priority: MOMENT_PRIORITY[type] };
}

const SETTLE_MS = 4_000; // the first seconds are chaos: no lead / overtake talk
const ZERO_AFTER_MS = 15_000;
const ZERO_GAP_MS = 10_000;
const ZERO_MAX = 3;
const LAST_AFTER_MS = 20_000;
const LAST_GAP_MS = 18_000;
const TIE_HOLD_MS = 1_200;
const STREAK_WINDOW_MS = 6_000;
const STREAK_COOLDOWN_MS = 14_000;
const JUMP_COOLDOWN_MS = 9_000;
const COMEBACK_MEMORY_MS = 25_000;

function who(e: RaceEntry): Who {
  return { id: e.id, name: e.name };
}

export function createMomentEngine(): MomentEngine {
  let prevScore = new Map<string, number>();
  let prevRank = new Map<string, number>();
  let prevLeader: string | null = null;
  let prevLeft = Number.POSITIVE_INFINITY;
  let prevElapsed = -1;
  let tieKey: string | null = null;
  let tieSince = 0;
  let tieSaid: string | null = null;
  let lastSaidAt = Number.NEGATIVE_INFINITY;
  let lastSaidId: string | null = null;
  let zeroSaidAt = Number.NEGATIVE_INFINITY;
  const zeroSaid = new Set<string>();
  let final10Done = false;
  let photoDone = false;
  const bottomAt = new Map<string, number>();
  const comebackDone = new Set<string>();
  const climbs = new Map<string, number[]>();
  const streakAt = new Map<string, number>();
  const jumpAt = new Map<string, number>();
  let avgGain = 0;
  let first = true;

  function reset(): void {
    prevScore = new Map();
    prevRank = new Map();
    prevLeader = null;
    prevLeft = Number.POSITIVE_INFINITY;
    prevElapsed = -1;
    tieKey = null;
    tieSaid = null;
    lastSaidAt = Number.NEGATIVE_INFINITY;
    lastSaidId = null;
    zeroSaidAt = Number.NEGATIVE_INFINITY;
    zeroSaid.clear();
    final10Done = false;
    photoDone = false;
    bottomAt.clear();
    comebackDone.clear();
    climbs.clear();
    streakAt.clear();
    jumpAt.clear();
    avgGain = 0;
    first = true;
  }

  function update(sample: RaceSample): Moment[] {
    const out: Moment[] = [];
    if (sample.frozen) return out;
    const t = sample.elapsedMs;
    if (t < prevElapsed - 2_000) reset(); // the clock jumped back: a new round
    const list = sample.entries;
    const n = list.length;
    const top = list[0];
    const second = list[1];
    const settled = t >= SETTLE_MS && !first;

    const rank = new Map<string, number>();
    list.forEach((e, i) => rank.set(e.id, i));

    // ── drop / jump ──
    let gainSum = 0;
    let gainCount = 0;
    let bestJump: { e: RaceEntry; gain: number } | null = null;
    let worstDrop: { e: RaceEntry; loss: number } | null = null;
    for (const e of list) {
      const before = prevScore.get(e.id);
      if (before === undefined) continue;
      const d = e.score - before;
      if (d < 0) {
        if (worstDrop === null || -d > worstDrop.loss) worstDrop = { e, loss: -d };
      } else if (d > 0) {
        gainSum += d;
        gainCount++;
        if (bestJump === null || d > bestJump.gain) bestJump = { e, gain: d };
      }
    }
    if (worstDrop !== null && !first) out.push(makeMoment('drop', who(worstDrop.e)));
    if (bestJump !== null && settled && t >= 5_000 && avgGain > 0 && top !== undefined) {
      const big = bestJump.gain >= Math.max(avgGain * 4, top.score * 0.12, 2);
      const cooled = t - (jumpAt.get(bestJump.e.id) ?? Number.NEGATIVE_INFINITY) >= JUMP_COOLDOWN_MS;
      if (big && cooled) {
        jumpAt.set(bestJump.e.id, t);
        out.push(makeMoment('jump', who(bestJump.e)));
      }
    }
    if (gainCount > 0) {
      const mean = gainSum / gainCount;
      avgGain = avgGain === 0 ? mean : avgGain * 0.85 + mean * 0.15;
    }

    // ── new leader ──
    const leader = top !== undefined && top.score > 0 && (second === undefined || top.score > second.score) ? top.id : null;
    if (leader !== null && leader !== prevLeader && top !== undefined) {
      if (prevLeader !== null && settled) {
        const old = list.find((e) => e.id === prevLeader);
        out.push(makeMoment('lead', who(top), old ? who(old) : null));
      }
      prevLeader = leader;
    }

    // ── overtake near the top (not the leader change itself) ──
    if (settled) {
      for (let i = 1; i < Math.min(n, 5); i++) {
        const e = list[i];
        const behind = list[i + 1];
        if (!e || !behind) continue;
        const was = prevRank.get(e.id);
        const behindWas = prevRank.get(behind.id);
        if (was !== undefined && behindWas !== undefined && was > i && behindWas < was && e.score > behind.score) {
          out.push(makeMoment('overtake', who(e), who(behind)));
          break;
        }
      }
    }

    // ── streak: three climbs in a short while ──
    for (const e of list) {
      const was = prevRank.get(e.id);
      const now = rank.get(e.id);
      if (was === undefined || now === undefined) continue;
      let hist = climbs.get(e.id);
      if (now > was) {
        if (hist) hist.length = 0; // lost a place: the streak is over
        continue;
      }
      if (now < was && settled && t >= 8_000) {
        if (!hist) {
          hist = [];
          climbs.set(e.id, hist);
        }
        hist.push(t);
        while (hist.length > 0 && t - (hist[0] ?? t) > STREAK_WINDOW_MS) hist.shift();
        const cooled = t - (streakAt.get(e.id) ?? Number.NEGATIVE_INFINITY) >= STREAK_COOLDOWN_MS;
        if (hist.length >= 3 && cooled) {
          streakAt.set(e.id, t);
          hist.length = 0;
          out.push(makeMoment('streak', who(e)));
        }
      }
    }

    // ── comeback: bottom half not long ago, top three now ──
    if (n >= 5) {
      list.forEach((e, i) => {
        if (i >= Math.ceil(n / 2)) bottomAt.set(e.id, t);
      });
      for (let i = 0; i < 3; i++) {
        const e = list[i];
        if (!e || comebackDone.has(e.id) || e.score <= 0) continue;
        const at = bottomAt.get(e.id);
        if (at !== undefined && t - at <= COMEBACK_MEMORY_MS && t >= 10_000) {
          comebackDone.add(e.id);
          bottomAt.delete(e.id);
          out.push(makeMoment('comeback', who(e)));
        }
      }
    }

    // ── dead heat at the top ──
    if (top !== undefined && second !== undefined && top.score > 0 && top.score === second.score && settled) {
      const key = [top.id, second.id].sort().join('|');
      if (key !== tieKey) {
        tieKey = key;
        tieSince = t;
      } else if (t - tieSince >= TIE_HOLD_MS && tieSaid !== key) {
        tieSaid = key;
        out.push(makeMoment('tie', who(top), who(second)));
      }
    } else {
      tieKey = null;
      tieSaid = null;
    }

    // ── still on zero ──
    if (t >= ZERO_AFTER_MS && zeroSaid.size < ZERO_MAX && t - zeroSaidAt >= ZERO_GAP_MS && sample.leftMs > 4_000) {
      const sleepy = list.find((e) => e.score === 0 && !zeroSaid.has(e.id));
      if (sleepy) {
        zeroSaid.add(sleepy.id);
        zeroSaidAt = t;
        out.push(makeMoment('zero', who(sleepy)));
      }
    }

    // ── last place ──
    const tail = list[n - 1];
    if (n >= 3 && tail !== undefined && t >= LAST_AFTER_MS && t - lastSaidAt >= LAST_GAP_MS && sample.leftMs > 12_000) {
      const tailAlone = (list[n - 2]?.score ?? -1) > tail.score;
      if (tailAlone && tail.score > 0 && (tail.id !== lastSaidId || t - lastSaidAt >= LAST_GAP_MS * 2)) {
        lastSaidAt = t;
        lastSaidId = tail.id;
        out.push(makeMoment('last', who(tail)));
      }
    }

    // ── the clock ──
    if (!final10Done && sample.leftMs <= 10_000 && sample.leftMs > 0) {
      final10Done = true;
      if (prevLeft > 10_000 && (prevLeft !== Number.POSITIVE_INFINITY || sample.leftMs > 7_000)) out.push(makeMoment('final10'));
    }
    if (!photoDone && sample.leftMs <= 6_000 && sample.leftMs > 500 && top !== undefined && second !== undefined && top.score > 0) {
      if (top.score - second.score <= Math.max(1, top.score * 0.04)) {
        photoDone = true;
        out.push(makeMoment('photo', who(top), who(second)));
      }
    }

    prevScore = new Map(list.map((e) => [e.id, e.score]));
    prevRank = rank;
    prevLeft = sample.leftMs;
    prevElapsed = t;
    first = false;
    return out;
  }

  return { update, reset };
}
