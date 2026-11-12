/**
 * Live place in the running round, from the server's `scores` broadcast. Pure (no DOM),
 * shared by the stage HUD, the phone's test hooks and tests/unit/live-standing.test.ts.
 *
 * The broadcast is already in the strict live order (score descending, then who reached it
 * first, then join order), so a player's place is simply its index + 1. Nothing is re-sorted
 * here: equal scores keep the order the server gave.
 */

/** One `scores` message body: [playerId, raw score] pairs in the strict live order. */
export type ScoresList = ReadonlyArray<readonly [string, number]>;

export interface Rival {
  readonly id: string;
  /** Display name (already shortened, see shortName). */
  readonly name: string;
  /** Points between the two players, never negative. */
  readonly gap: number;
}

/** Who this player is chasing (not first) or holding off (first). */
export type Chase = { readonly kind: 'behind'; readonly rival: Rival } | { readonly kind: 'lead'; readonly rival: Rival };

export interface LiveStanding {
  /** 1-based strict live place. */
  readonly place: number;
  /** Number of players ranked in this round (the list length). */
  readonly count: number;
  readonly score: number;
  /** Null when alone, or when this player and the rival are both still on 0. */
  readonly chase: Chase | null;
}

/** Longest name the HUD prints, in graphemes (NAME_MAX_LEN is 14; one more cut keeps the line short). */
export const CHASE_NAME_MAX = 12;
const NO_NAME = 'מישהו';

function graphemes(s: string): string[] {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(s), (x) => x.segment);
  } catch {
    return Array.from(s);
  }
}

/** Grapheme-safe shortening (an emoji or a letter with niqqud is never split): "abcdefghijk…". */
export function shortName(raw: string, max = CHASE_NAME_MAX): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name === '') return NO_NAME;
  const g = graphemes(name);
  if (g.length <= max) return name;
  return `${g
    .slice(0, Math.max(1, max - 1))
    .join('')
    .trimEnd()}…`;
}

/**
 * The player's live place and chase from one `scores` list, or null when the player is not in
 * the list (joined late, not a participant of this round).
 */
export function liveStanding(scores: ScoresList, me: string, nameOf: (id: string) => string | undefined): LiveStanding | null {
  const at = scores.findIndex(([id]) => id === me);
  if (at < 0) return null;
  const mine = scores[at]?.[1] ?? 0;
  const count = scores.length;
  const rivalAt = at === 0 ? 1 : at - 1;
  const rival = count > 1 ? scores[rivalAt] : undefined;
  let chase: Chase | null = null;
  if (rival !== undefined && (mine > 0 || rival[1] > 0)) {
    const r: Rival = {
      id: rival[0],
      name: shortName(nameOf(rival[0]) ?? ''),
      gap: Math.max(0, at === 0 ? mine - rival[1] : rival[1] - mine),
    };
    chase = at === 0 ? { kind: 'lead', rival: r } : { kind: 'behind', rival: r };
  }
  return { place: at + 1, count, score: mine, chase };
}

/** The chase line in pieces, so the HUD can colour the number and isolate the name. */
export interface ChaseParts {
  readonly lead: string;
  /** The gap, '' when there is none to show. Printed LTR (so "+25" keeps its plus on the left). */
  readonly num: string;
  readonly mid: string;
  readonly name: string;
  readonly tail: string;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function chaseParts(chase: Chase): ChaseParts {
  const { gap, name } = chase.rival;
  if (chase.kind === 'behind') {
    // Same score but they got there first: nothing to "add", just stick to them.
    if (gap === 0) return { lead: 'צמוד ל־', num: '', mid: '', name, tail: '!' };
    return { lead: 'עוד ', num: fmt(gap), mid: ' ל־', name, tail: '' };
  }
  if (gap === 0) return { lead: 'מוביל/ה! ', num: '', mid: '', name, tail: ' צמוד/ה' };
  return { lead: 'מוביל/ה! ', num: `+${fmt(gap)}`, mid: ' על ', name, tail: '' };
}

const LRI = '⁦';
const FSI = '⁨';
const PDI = '⁩';

/** The whole line as one string, the number LTR-isolated and the name first-strong-isolated. */
export function chaseText(chase: Chase | null): string {
  if (chase === null) return '';
  const p = chaseParts(chase);
  return `${p.lead}${p.num === '' ? '' : `${LRI}${p.num}${PDI}`}${p.mid}${FSI}${p.name}${PDI}${p.tail}`;
}

/** chaseText without the invisible isolation marks (what a person reads; test hooks). */
export function plainChase(text: string): string {
  return text.replace(/[⁦-⁩]/g, '');
}
