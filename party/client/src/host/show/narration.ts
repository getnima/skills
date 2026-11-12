/**
 * The two party hosts narrating the show: the script (what they say at the big moments, in which
 * pose) and the pure logic around it (the queue that decides what is said next, and the rotation of
 * the variants). No DOM, no clock, no randomness of its own: the TV's narrator (../narrator.tsx)
 * feeds it time and a random source. The human-readable version of the script, with the notes on
 * voice and timing, is design/narration.he.md: change both together.
 *
 * Host A is the man in the lemon hat, host B the woman with the bangs: every line is written in its
 * speaker's grammatical gender. No guest name ever goes inside a line (the TV may show one as a tag
 * next to the bubble). A take is one line, or a banter pair (A sets it up, B answers).
 */
import type { GameId } from '../../../../shared/protocol';

export type HostId = 'a' | 'b';

/** The pose pictures: client/public/assets/hosts/poses/<host>_<pose>.webp. */
export const POSES = ['present', 'cheer', 'shocked', 'shush', 'laugh', 'wave'] as const;
export type Pose = (typeof POSES)[number];

export interface Beat {
  readonly host: HostId;
  readonly pose: Pose;
  readonly text: string;
}

/** One line, or a banter pair said one after the other. */
export type Take = readonly Beat[];

export const NARRATION_MOMENTS = [
  'opening', // the TV opens on an empty lobby
  'arrive', // the first guests are in
  'intro_tap',
  'intro_icy',
  'intro_flappy',
  'intro_plotzel',
  'intro_ninja',
  'go', // the round starts
  'final10', // ten seconds left
  'finale', // flappy: the last few in the air
  'race', // the hosts talking through a round, with the guests' names (show/banter.ts hands the take)
  'resume', // the round continues after a cutscene
  'timeup', // the round is over
  'suspense', // the drum roll before the round winner
  'reveal', // the round winner's name lands
  'standings', // the overall table
  'podium', // the final podium begins
  'champion', // the champion of the night
  'goodbye', // the end of the show
] as const;
export type NarrationMoment = (typeof NARRATION_MOMENTS)[number];

export interface MomentScript {
  /** 1..10: a higher priority cue waiting in the queue is said first; calm mode keeps only 7 and up. */
  readonly priority: number;
  readonly takes: readonly Take[];
}

const a = (pose: Pose, text: string): Beat => ({ host: 'a', pose, text });
const b = (pose: Pose, text: string): Beat => ({ host: 'b', pose, text });

export const NARRATION: Readonly<Record<NarrationMoment, MomentScript>> = {
  opening: {
    priority: 7,
    takes: [
      [a('present', 'ערב טוב, ישראל! זה פארטי ארנה.'), b('laugh', 'כמו האירוויזיון, רק עם במבה.')],
      [b('present', 'סרקו את הקוד. כרטיסים אחרונים, כמו בקיסריה.')],
    ],
  },
  arrive: {
    priority: 5,
    takes: [[a('shocked', 'וואו, אורחים אמיתיים! לא ניצבים.')], [b('cheer', 'יש לנו מתמודדים! אש!')]],
  },
  intro_tap: {
    priority: 8,
    takes: [[a('present', 'שימי טאפ: חוטטים לשימי באף, באישור משרד הבריאות.'), b('laugh', 'חצי דקה להתחיל, ומהנגיעה הראשונה עשרים שניות שלכם.')]],
  },
  intro_icy: {
    priority: 8,
    takes: [[a('present', 'אייסי שימי: מטפסים כמה שיותר גבוה.'), b('cheer', 'בקומה האחרונה מחכה פנטהאוז בעזריאלי.')]],
  },
  intro_flappy: {
    priority: 8,
    takes: [[a('present', 'פלאפי תבורי: מי שנשאר אחרון באוויר, מנצח.'), b('laugh', 'כמו טיסה לאילת, רק בלי לנחות.')]],
  },
  intro_plotzel: {
    priority: 8,
    takes: [[a('present', 'פלוצל: מחמוד לפלוץ, אות אחת בכל פעם.'), b('shocked', 'כל צעד מילה אמיתית. האקדמיה ללשון צופה.')]],
  },
  intro_ninja: {
    priority: 8,
    takes: [[a('present', 'נינג׳ה תבורי: חותכים פלאפל, סביח ובורקס.'), b('laugh', 'רק לא את הפצצות. הפצצות של הערב זה אנחנו.')]],
  },
  go: {
    priority: 6,
    takes: [[a('cheer', 'יאללה, אחשילי! מחורחר!')], [b('cheer', 'צאו לדרך! בן פורת יוסף!')]],
  },
  final10: {
    priority: 7,
    takes: [[a('shocked', 'עשר שניות! לחץ של גמר הישרדות.')], [b('cheer', 'עשר שניות! קצב של דיג׳יי בשלוש בלילה.')]],
  },
  finale: {
    priority: 7,
    takes: [[a('shocked', 'הגמר באוויר! מחורחר!')], [b('shush', 'רק האחרונים נשארו. אף אחד לא נושם.')]],
  },
  // a round's banter comes with its own take (show/banter.ts): these are only the fallback, with no names
  race: {
    priority: 4,
    takes: [[a('cheer', 'איזה מרוץ! מחורחר!')], [b('cheer', 'איזה ערב! בן פורת יוסף!')]],
  },
  resume: {
    priority: 6,
    takes: [[a('present', 'חזרנו מהפרסומות! הטלפונים ביד.')], [b('laugh', 'איפה היינו? אה כן, בחלק שבו אני מושלמת.')]],
  },
  timeup: {
    priority: 6,
    takes: [[a('shocked', 'סוף! מניחים את הטלפונים, לאט.')], [b('present', 'הזמן נגמר. ממתינים לדוז פואה מהשופטים.')]],
  },
  suspense: {
    priority: 7,
    takes: [[b('shush', 'ששש... אפילו אני עוד לא יודעת. נודר.')], [a('shush', 'אף מילה. גם לא ממני, וזה קשה לי.')]],
  },
  reveal: {
    priority: 9,
    takes: [
      [b('cheer', 'וואו! כמו אוסקר, רק עם כנפיים.')],
      [a('cheer', 'בן פורת יוסף! המלאך עובר דירה.')],
      [b('laugh', 'כפרה! המלאך כבר מחפש חניה ליד הבית.')],
    ],
  },
  standings: {
    priority: 5,
    takes: [[a('present', 'הטבלה הכללית. ואין ירידת ליגה.')], [b('present', 'והטבלה! מי למעלה, ומי בדרך למעלה.')]],
  },
  podium: {
    priority: 8,
    takes: [[a('present', 'הפודיום של הערב! טקס של פתיחת המכביה.')], [b('shush', 'נשמו עמוק, כמו ביוגה בפרדס חנה.')]],
  },
  champion: {
    priority: 9,
    takes: [
      [a('cheer', 'יש לנו אלוף ערב! בן פורת יוסף!'), b('cheer', 'צדיק! מחר זה בכותרת הראשית של ynet.')],
      [b('cheer', 'וואו! אלוף הערב, רשמית ובחתימה של שנינו.')],
    ],
  },
  goodbye: {
    priority: 8,
    takes: [[a('wave', 'זה היה פארטי ארנה. לילה טוב, ישראל!')], [b('wave', 'תודה שבאתם! מי שזכה, שמרו על המלאך.')]],
  },
};

const INTRO: Readonly<Record<GameId, NarrationMoment>> = {
  tap: 'intro_tap',
  icy: 'intro_icy',
  flappy: 'intro_flappy',
  plotzel: 'intro_plotzel',
  ninja: 'intro_ninja',
};

/** The intro moment of a game. */
export function introMoment(gameId: GameId): NarrationMoment {
  return INTRO[gameId];
}

/** How long a beat stays up: about 3 to 4 seconds, longer for a longer line. */
export function beatHoldMs(text: string): number {
  return Math.round(Math.min(4_000, Math.max(2_800, 1_700 + Array.from(text).length * 52)));
}

/** Every line of the script, in order (for the tests and the design doc). The round's banter is show/banter.ts. */
export function allBeats(script: Readonly<Record<NarrationMoment, MomentScript>> = NARRATION): readonly (Beat & { readonly moment: NarrationMoment })[] {
  const out: (Beat & { readonly moment: NarrationMoment })[] = [];
  for (const moment of NARRATION_MOMENTS) for (const take of script[moment].takes) for (const beat of take) out.push({ ...beat, moment });
  return out;
}

// ───────────────────────────── rotation ─────────────────────────────

export interface PickedTake {
  readonly moment: NarrationMoment;
  /** Index of the take in the moment's script. */
  readonly index: number;
  readonly take: Take;
}

export interface TakePicker {
  /**
   * The next take of a moment: every take is used once before any repeats (a shuffled deck), and
   * a moment with two or more takes never gives the same take twice in a row. Null for a moment
   * with no takes.
   */
  pick(moment: NarrationMoment): PickedTake | null;
}

export function createTakePicker(random: () => number, script: Readonly<Record<NarrationMoment, MomentScript>> = NARRATION): TakePicker {
  const decks = new Map<NarrationMoment, number[]>();
  const last = new Map<NarrationMoment, number>();
  return {
    pick(moment) {
      const takes = script[moment].takes;
      if (takes.length === 0) return null;
      let deck = decks.get(moment);
      if (deck === undefined || deck.length === 0) {
        deck = takes.map((_, i) => i);
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.min(i, Math.floor(random() * (i + 1)));
          const x = deck[i];
          const y = deck[j];
          if (x !== undefined && y !== undefined) {
            deck[i] = y;
            deck[j] = x;
          }
        }
        // the next take is dealt from the end: never the one that was said last
        const top = deck[deck.length - 1];
        if (deck.length > 1 && top === last.get(moment)) {
          const first = deck[0];
          if (first !== undefined && top !== undefined) {
            deck[0] = top;
            deck[deck.length - 1] = first;
          }
        }
        decks.set(moment, deck);
      }
      const index = deck.pop() ?? 0;
      last.set(moment, index);
      const take = takes[index] ?? takes[0] ?? [];
      return { moment, index, take };
    },
  };
}

// ───────────────────────────── the queue ─────────────────────────────

/** A moment the show wants narrated. */
export interface NarrationCue {
  /** Each id is said at most once (a moment that fires again with the same id is ignored). */
  readonly id: string;
  readonly moment: NarrationMoment;
  /** Defaults to the moment's priority. */
  readonly priority?: number;
  /** When it was cued (ms, the caller's clock). */
  readonly at: number;
  /** It is dropped when its turn has not come this long after `at`. */
  readonly ttlMs: number;
  /** Checked again when its turn comes: false drops it (the show moved on, it is no longer true). */
  readonly valid?: () => boolean;
  /** A guest's name the TV shows as a tag next to the bubble (never inside the line). */
  readonly name?: string;
  /**
   * The take to say instead of the moment's own script: a round's banter (show/banter.ts), whose
   * lines carry {a} / {b} for the guests' names.
   */
  readonly take?: Take;
  /** The guests' names for {a} / {b} in `take` (the TV highlights them in the bubble). */
  readonly names?: { readonly a?: string; readonly b?: string };
  /** Called when the cue goes unsaid (stale, no longer true, crowded out, calm mode, nowhere to stand). */
  readonly onDropped?: () => void;
  /** Overrides the hold of every beat of the take. */
  readonly holdMs?: number;
}

export interface NarrationQueue {
  /** Adds a cue. False when the same id was offered before (each moment fires once) or it is already stale. */
  offer(cue: NarrationCue, now: number): boolean;
  /** Removes and returns the cue to say now: the highest priority, then the oldest. Stale and invalid cues are dropped on the way. */
  next(now: number): NarrationCue | null;
  /** The cue `next` would return, left in the queue (it may wait for room on the screen). */
  peek(now: number): NarrationCue | null;
  /** Cues waiting (stale ones included until the next `next`/`prune`). */
  size(): number;
  /** Drops what is stale or no longer valid. */
  prune(now: number): void;
  /** Drops every waiting cue (the ids stay used). */
  clear(): void;
  /** True when this id was offered before. */
  seen(id: string): boolean;
}

function priorityOf(cue: NarrationCue): number {
  return cue.priority ?? NARRATION[cue.moment].priority;
}

export type DropReason = 'stale' | 'gone' | 'crowded';

export function createNarrationQueue(maxWaiting = 4, onDrop?: (cue: NarrationCue, reason: DropReason) => void): NarrationQueue {
  const waiting: NarrationCue[] = [];
  const offered = new Set<string>();

  function prune(now: number): void {
    for (let i = waiting.length - 1; i >= 0; i--) {
      const cue = waiting[i];
      if (cue === undefined) continue;
      const reason: DropReason | null = now - cue.at > cue.ttlMs ? 'stale' : cue.valid !== undefined && !cue.valid() ? 'gone' : null;
      if (reason === null) continue;
      waiting.splice(i, 1);
      onDrop?.(cue, reason);
    }
  }

  function bestIndex(now: number): number {
    prune(now);
    let best = -1;
    for (let i = 0; i < waiting.length; i++) {
      const c = waiting[i];
      const w = best >= 0 ? waiting[best] : undefined;
      if (c === undefined) continue;
      if (w === undefined || priorityOf(c) > priorityOf(w) || (priorityOf(c) === priorityOf(w) && c.at < w.at)) best = i;
    }
    return best;
  }

  return {
    offer(cue, now) {
      if (offered.has(cue.id)) return false;
      offered.add(cue.id);
      if (now - cue.at > cue.ttlMs) {
        onDrop?.(cue, 'stale');
        return false;
      }
      waiting.push(cue);
      if (waiting.length > maxWaiting) {
        // too much at once: the least important (then the newest) goes
        let worst = 0;
        for (let i = 1; i < waiting.length; i++) {
          const w = waiting[worst];
          const c = waiting[i];
          if (w === undefined || c === undefined) continue;
          if (priorityOf(c) < priorityOf(w) || (priorityOf(c) === priorityOf(w) && c.at > w.at)) worst = i;
        }
        const [dropped] = waiting.splice(worst, 1);
        if (dropped !== undefined) onDrop?.(dropped, 'crowded');
      }
      return true;
    },
    next(now) {
      const best = bestIndex(now);
      if (best < 0) return null;
      const [cue] = waiting.splice(best, 1);
      return cue ?? null;
    },
    peek(now) {
      const best = bestIndex(now);
      return best < 0 ? null : (waiting[best] ?? null);
    },
    size: () => waiting.length,
    prune,
    clear() {
      waiting.length = 0;
    },
    seen: (id) => offered.has(id),
  };
}
