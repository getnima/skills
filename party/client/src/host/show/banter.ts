/**
 * The two hosts talking through a round on the TV: the race banter. The owner wanted both hosts
 * to narrate more during the competition and trash talk the players, in the הפשוטע voice.
 *
 * During a round the posed hosts (../narrator.tsx) say these lines in the margin under the timer,
 * with the guests' names in them: a reaction to what just happened in the race (a new leader, an
 * overtake, a bomb, a crash), and, when the race is quiet for a few seconds, a jab at somebody
 * (the leader, the middle of the table, the last place, a line about the game). Most takes are a
 * banter pair: one host sets it up, the other answers.
 *
 * The voice (design/punchlines.he.md, design/narration.he.md): two TV hosts delighted with
 * themselves, a grand frame on a small local thing, a local proper noun as the punch. The trash
 * talk is about the play (the score, the crash, the bomb), never about a guest's looks, family,
 * money or anything sad, and the hosts make fun of themselves just as much. Nothing gross.
 *
 * Host A (the man) speaks in the masculine, host B (the woman) in the feminine. A guest can be
 * anyone, so the name is never the subject of a gendered verb or adjective: a noun ("{a} בראש",
 * "קאמבק של {a}"), "ל{a}" / "אצל {a}", or the guest addressed in the past tense, which Hebrew
 * writes the same for everyone ("{a}, חתכת פצצה!").
 *
 * Pure: no DOM, no clock of its own; the round (playing.tsx) feeds it moments and time. What the
 * evening has already said (which lines, who was named how often) is remembered for the whole TV
 * page, so the lines rotate across the rounds and everybody gets their turn.
 */
import type { GameId } from '../../../../shared/protocol';
import type { Moment } from './moments';
import type { Beat, Pose, Take } from './narration';

export const BANTER_KINDS = [
  // a race moment happened (show/moments.ts)
  'lead',
  'overtake',
  'jump',
  'drop',
  'tie',
  'last',
  'comeback',
  'zero',
  'photo',
  'streak',
  // an elimination round (flappy): somebody fell
  'firstOut',
  'out',
  // the race is quiet: the hosts fill it
  'stillLead',
  'mid',
  'room',
  // a line about the game being played (anybody still in it)
  'tap',
  'icy',
  'flappy',
  'plotzel',
  'ninja',
] as const;
export type BanterKind = (typeof BANTER_KINDS)[number];

const a = (pose: Pose, text: string): Beat => ({ host: 'a', pose, text });
const b = (pose: Pose, text: string): Beat => ({ host: 'b', pose, text });

/**
 * The lines. {a} is the guest the take is about, {b} the other one (overtaken, the runner-up).
 * Kept short: the bubble stands in a narrow margin, read from across the room.
 */
export const BANTER: Readonly<Record<BanterKind, readonly Take[]>> = {
  lead: [
    [a('cheer', '{a} בהובלה! נודר!'), b('laugh', 'תהנו. זה כמו חניה בתל אביב: זמני.')],
    [b('shocked', '{a} בראש? מי אישר את זה?'), a('present', 'אני. תמורת קפה בארומה.')],
    [a('present', 'הכתר עובר ל{a}.'), b('laugh', 'כתר מבורגר קינג. אבל עדיין כתר.')],
    [b('present', 'מבזק: {a} במקום הראשון.'), a('shocked', 'ובחדשות אחרות: {b} בהלם.')],
    [a('laugh', '{a}, הגעת לפסגה.'), b('shush', 'תצלמו מהר. מכאן רק יורדים.')],
    [b('cheer', '{a} למעלה! אש!'), a('laugh', '{b}, זה לא אישי. זה קצת אישי.')],
  ],
  overtake: [
    [a('shocked', 'עקיפה! {a} לפני {b}.'), b('laugh', '{b}, זה מה שקורה כשעוצרים לבורקס.')],
    [b('present', '{b}, מישהו עקף אותך.'), a('laugh', 'קוראים לזה {a}. תתרגלו.')],
    [a('cheer', 'עקיפה מימין של {a}!'), b('shush', 'לא ראיתי כלום. אני רק מנחה.')],
    [b('shocked', 'ביי ביי, {b}!'), a('present', '{a} בנתיב המהיר. באיילון זה נס.')],
    [a('present', '{b}, עקפו אותך בלי לאותת.'), b('laugh', 'תתלוננו על {a} בווייז. אף אחד לא קורא.')],
  ],
  jump: [
    [b('shocked', 'וואו, {a}! מאיפה הנקודות?'), a('shush', 'אל תשאלו. יש דברים שעדיף לא לדעת.')],
    [a('cheer', '{a} בטורבו!'), b('laugh', 'תבדקו שהטלפון לא מחובר לחשמל.')],
    [b('present', '{a}, על מה לחצת שם?'), a('shocked', 'זה נקרא כישרון. אני מזהה, יש לי.')],
    [a('shocked', '{a} במעלית של עזריאלי!'), b('laugh', 'ואנחנו במדרגות. כרגיל.')],
  ],
  // the ninja bombs are the two hosts themselves (bomb_hosts.png)
  drop: [
    [a('shocked', '{a}, חתכת פצצה!'), b('laugh', 'הפצצה זאת אני. נעים מאוד.')],
    [b('shocked', 'בום! הנקודות של {a} עפו.'), a('present', 'הן בדרך לאילת. יחזרו ביום ראשון.')],
    [a('laugh', '{a}, זה לא סביח. זה אני.')],
    [b('shush', '{a}, פגעת בי. אני סולחת.'), a('laugh', 'היא לא סולחת. היא רושמת.')],
  ],
  tie: [
    [a('shocked', '{a} מול {b}. ראש בראש!'), b('present', 'דרבי של השכונה. אני מוכרת כרטיסים.')],
    [b('cheer', 'בין {a} ל{b} לא נכנסת פיתה.'), a('laugh', 'אולי לאפה. קטנה. בלי חריף.')],
    [a('present', '{a} ו{b} צמודים.'), b('laugh', 'כמו בחתונמי. רק בלי החתונה.')],
  ],
  last: [
    [a('present', '{a} במקום האחרון.'), b('laugh', 'מישהו צריך לכבות את האור בסוף.')],
    [b('shush', 'ששש. {a} בונה מתח.'), a('laugh', 'כבר שלוש עונות. כמו טלנובלה.')],
    [a('laugh', '{a}, ראינו אותך. מלמטה.'), b('cheer', 'ומשם הנוף הכי יפה. נודר.')],
    [b('present', '{a}, הטלפון בכלל דולק?'), a('present', 'אולי במצב טיסה. נוחת ביום שלישי.')],
    [a('present', '{a} כאן בשביל הכיבוד.'), b('cheer', 'החלטה נבונה. ראיתם את הבורקס?')],
  ],
  comeback: [
    [a('shocked', 'קאמבק של {a}!'), b('cheer', 'כמו להיט מ־2005 בחתונה. כולם לרחבה.')],
    [b('shocked', '{a}, מאיפה הגעת?!'), a('laugh', 'מהמקום האחרון. בלי לאותת, כמובן.')],
    [a('present', '{a} בצמרת!'), b('laugh', 'בבוקר לא האמנו. גם עכשיו לא.')],
  ],
  zero: [
    [b('shocked', '{a} על אפס.'), a('present', 'מינימליזם סקנדינבי. ראיתי באיקאה.')],
    [a('laugh', '{a}, המשחק התחיל. מזמן.'), b('present', 'זה בסדר. גם הטכנאי של בזק מאחר.')],
    [b('present', '{a}, נגעת במסך? בכלל?'), a('present', 'אני מכבד. אמנות של מינימום מאמץ.')],
    [a('shocked', 'אפס נקודות ל{a}.'), b('laugh', 'לפחות מספר עגול. אסתטי.')],
  ],
  photo: [
    [a('shocked', '{a} מול {b}! צמוד!'), b('shush', 'אני לא נושמת. גם אתם לא.')],
    [b('cheer', 'פוטו פיניש! {a} או {b}?'), a('present', 'מזמינים צילום מהמסוק של החדשות.')],
  ],
  streak: [
    [a('cheer', '{a} על האש!'), b('laugh', 'כמו מנגל ביום העצמאות. השכנים מתקשרים.')],
    [b('cheer', 'אי אפשר לעצור את {a}.'), a('present', 'ניסיתי. קיבלתי כרטיס צהוב.')],
    [a('shocked', '{a} ברצף! מחורחר!'), b('present', 'מישהו יביא לטלפון הזה מים. הוא רותח.')],
  ],
  firstOut: [
    [a('shocked', 'יציאה ראשונה: {a}!'), b('laugh', 'מישהו היה צריך לפתוח. תודה על השירות.')],
    [b('shocked', '{a}, כבר?!'), a('present', 'טיסה קצרה. כמו לאילת, רק בלי אילת.')],
  ],
  out: [
    [a('shocked', '{a} בחוץ!'), b('laugh', 'נחיתה בנתב״ג. בלי מחיאות כפיים.')],
    [b('present', 'הטיסה של {a} הסתיימה.'), a('laugh', 'תודה שטסתם איתנו. החגורות פתוחות.')],
    [a('laugh', '{a}, הנחיתה הייתה... אמנותית.'), b('cheer', 'עשר בסגנון. אפס בתעופה.')],
    [b('shocked', 'אוי, {a}!'), a('present', 'המלאך ראה. המלאך מצחקק.')],
  ],
  stillLead: [
    [a('present', '{a} עדיין בראש.'), b('shush', 'חשוד. מישהו יבדוק את הטלפון הזה.')],
    [b('laugh', '{b}, ראית את {a}?'), a('present', 'רק את הגב. מרחוק.')],
    [a('laugh', '{a}, נראה לך שזה סגור?'), b('cheer', 'פה שום דבר לא סגור. חוץ מהמטבח.')],
  ],
  mid: [
    [a('present', 'ואיפה {a}? באמצע.'), b('laugh', 'שווייץ של המרוץ. ניטרלי, ושוקולד טוב.')],
    [b('present', '{a} באמצע הטבלה.'), a('laugh', 'קומה שלוש בלי מעלית. אבל עם נוף.')],
  ],
  room: [
    [a('present', 'כולם על הטלפונים. כמו בחתונה.'), b('laugh', 'רק שהפעם זה מותר.')],
    [b('shush', 'תסתכלו על הפרצופים. מחורחר.'), a('present', 'אני רואה פה ריכוז. כמו בבגרות.')],
    [a('cheer', 'איזה מרוץ! בן פורת יוסף!')],
  ],
  tap: [
    [a('present', '{a}, האצבע שלך בכושר.'), b('laugh', 'מנוי שנתי בחדר כושר. רק לאצבע.')],
    [b('shocked', '{a}, זה מסך. לא תוף.'), a('laugh', 'תגידו את זה לשכנים מלמטה.')],
  ],
  icy: [
    [a('present', '{a}, איזה טיפוס!'), b('cheer', 'קומה אחרי קומה. תמ״א 38.')],
    [b('shocked', '{a}, החלקת?'), a('laugh', 'קרח זה בוגדני. כמו מדרכה בירושלים בשלג.')],
  ],
  flappy: [
    [a('present', '{a} עדיין באוויר.'), b('laugh', 'אל על מתקשרים. רוצים להחתים.')],
    [b('present', '{a}, טסת יפה.'), a('laugh', 'טיסת שכר. בלי ארוחה.')],
  ],
  plotzel: [
    [b('present', '{a}, המילון פתוח אצלך?'), a('laugh', 'אבן שושן. מהדורת 84׳.')],
    [a('present', '{a}, איזו מילה זאת?'), b('shush', 'ששש. האקדמיה ללשון בודקת.')],
  ],
  ninja: [
    [a('present', '{a}, סכין זה לא שרביט.'), b('laugh', 'אבל הפלאפל דווקא התרגש.')],
    [b('shocked', '{a}, חתכת סביח בלי עמבה?'), a('shocked', 'זה פשע. מעבירים לשופט.')],
  ],
};

/** 1..10, on the narrator's scale: under the big moments (GO 6, the last ten seconds 7); calm mode (7 and up) mutes all of it. */
export const BANTER_PRIORITY: Readonly<Record<BanterKind, number>> = {
  photo: 6,
  lead: 5,
  drop: 5,
  comeback: 5,
  firstOut: 5,
  overtake: 4,
  jump: 4,
  tie: 4,
  streak: 4,
  zero: 4,
  last: 4,
  out: 4,
  stillLead: 3,
  mid: 3,
  room: 3,
  tap: 3,
  icy: 3,
  flappy: 3,
  plotzel: 3,
  ninja: 3,
};

/** The same kind of moment is talked about at most this often (ms). */
const KIND_GAP_MS: Partial<Record<BanterKind, number>> = {
  lead: 7_000,
  overtake: 6_000,
  jump: 7_000,
  drop: 3_500,
  tie: 9_000,
  last: 15_000,
  comeback: 7_000,
  zero: 14_000,
  photo: 5_000,
  streak: 9_000,
  out: 2_500,
};
/** A guest just talked about is left alone this long by the ordinary moments. */
const PLAYER_GAP_MS = 9_000;
/** The moments that name a guest whatever: they are the news. */
const PLAYER_GAP_EXEMPT: ReadonlySet<BanterKind> = new Set<BanterKind>(['lead', 'drop', 'photo', 'comeback', 'firstOut', 'out']);
/** The hosts fill a quiet race after this long without a word. */
export const AMBIENT_IDLE_MS = 3_000;
/** Two quiet-race takes are offered at least this far apart (one that waits for room on the screen is not doubled). */
const AMBIENT_EVERY_MS = 4_500;
/** Not in the first seconds of a round (GO is being said, nothing has happened yet). */
const AMBIENT_FROM_MS = 5_000;
/** Not in the last stretch: the last ten seconds and the photo finish are the moments' own. */
const AMBIENT_UNTIL_LEFT_MS = 12_500;

export interface BanterWho {
  readonly id: string;
  readonly name: string;
}

/** One take the round hands to the narrator. */
export interface BanterLine {
  readonly kind: BanterKind;
  /** The take's index in BANTER[kind]. */
  readonly index: number;
  readonly take: Take;
  /** The guest the take is about ({a}), or null for a line about everybody. */
  readonly a: BanterWho | null;
  /** The other guest ({b}), or null when the take does not name one. */
  readonly b: BanterWho | null;
  readonly priority: number;
}

export interface BanterEntry extends BanterWho {
  readonly score: number;
  /** An elimination round: fell already. */
  readonly out?: boolean;
}

/** The race as the round sees it now. */
export interface BanterRace {
  readonly gameId: GameId;
  readonly elimination: boolean;
  readonly elapsedMs: number;
  readonly leftMs: number;
  readonly frozen: boolean;
  /** Best first. */
  readonly entries: readonly BanterEntry[];
}

export interface BanterDirector {
  /** A race moment: the take to say about it, or null (too soon, said already, nothing to say). `force` skips the waits (the demo's buttons). */
  moment(m: Moment, now: number, force?: boolean): BanterLine | null;
  /** Somebody fell out of an elimination round. */
  out(who: BanterWho, first: boolean, now: number): BanterLine | null;
  /** The hosts have said nothing for `idleMs`: a jab at somebody, or null. */
  ambient(race: BanterRace, idleMs: number, now: number): BanterLine | null;
  /** A take went unsaid (the race moved on): it goes back to be said next time, and nobody was named. */
  unsay(line: BanterLine): void;
}

// ───────────────────────── what the evening has said ─────────────────────────

interface Memory {
  /** How often each guest has been named tonight. */
  readonly mentions: Map<string, number>;
  /** Per kind: the takes not said yet in this round of the deck (shuffled). */
  readonly decks: Map<BanterKind, number[]>;
  readonly lastTake: Map<BanterKind, number>;
}

const memory: Memory = { mentions: new Map(), decks: new Map(), lastTake: new Map() };

/** Tests only: forget the evening. */
export function resetBanterMemory(): void {
  memory.mentions.clear();
  memory.decks.clear();
  memory.lastTake.clear();
}

/** How often a guest has been named tonight (tests, and the choice of whom to talk about). */
export function mentionsOf(id: string): number {
  return memory.mentions.get(id) ?? 0;
}

function usesB(take: Take): boolean {
  return take.some((beat) => beat.text.includes('{b}'));
}

function usesA(take: Take): boolean {
  return take.some((beat) => beat.text.includes('{a}'));
}

/**
 * The next take of a kind: every take once before any repeats (across the whole evening), never
 * the same twice in a row, and only takes the guests at hand can fill.
 */
function drawTake(kind: BanterKind, hasA: boolean, hasB: boolean, random: () => number): { index: number; take: Take } | null {
  const takes = BANTER[kind];
  const fits = (t: Take): boolean => (hasA || !usesA(t)) && (hasB || !usesB(t));
  if (!takes.some(fits)) return null;
  for (let pass = 0; pass < 2; pass++) {
    let deck = memory.decks.get(kind);
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
      // dealt from the end: never the take said last
      const top = deck[deck.length - 1];
      const first = deck[0];
      if (deck.length > 1 && top === memory.lastTake.get(kind) && top !== undefined && first !== undefined) {
        deck[0] = top;
        deck[deck.length - 1] = first;
      }
      memory.decks.set(kind, deck);
    }
    for (let i = deck.length - 1; i >= 0; i--) {
      const index = deck[i];
      const take = index === undefined ? undefined : takes[index];
      if (index === undefined || take === undefined || !fits(take)) continue;
      deck.splice(i, 1);
      memory.lastTake.set(kind, index);
      return { index, take };
    }
    // what is left in this deck does not fit these guests: start a fresh deck
    memory.decks.delete(kind);
  }
  return null;
}

/** Whoever of `list` has been named least tonight (ties: at random). */
function leastMentioned<T extends BanterWho>(list: readonly T[], random: () => number): T | null {
  let best: T[] = [];
  let min = Number.POSITIVE_INFINITY;
  for (const w of list) {
    const n = mentionsOf(w.id);
    if (n < min) {
      min = n;
      best = [w];
    } else if (n === min) best.push(w);
  }
  if (best.length === 0) return null;
  return best[Math.min(best.length - 1, Math.floor(random() * best.length))] ?? null;
}

/** The order the quiet stretches go through (a kind that does not fit the race is skipped). */
const AMBIENT_WHEEL: readonly ('game' | 'stillLead' | 'mid' | 'last' | 'room')[] = ['game', 'stillLead', 'mid', 'game', 'last', 'room'];
const ELIMINATION_WHEEL: readonly ('game' | 'room')[] = ['game', 'game', 'room'];

export function createBanterDirector(random: () => number): BanterDirector {
  const kindAt = new Map<BanterKind, number>();
  const namedAt = new Map<string, number>();
  let wheel = Math.floor(random() * AMBIENT_WHEEL.length);
  let ambientAt = Number.NEGATIVE_INFINITY;

  function make(kind: BanterKind, who: BanterWho | null, other: BanterWho | null, now: number): BanterLine | null {
    const drawn = drawTake(kind, who !== null, other !== null, random);
    if (drawn === null) return null;
    const take = drawn.take;
    const a2 = usesA(take) ? who : null;
    const b2 = usesB(take) ? other : null;
    kindAt.set(kind, now);
    for (const w of [a2, b2]) {
      if (w === null) continue;
      namedAt.set(w.id, now);
      memory.mentions.set(w.id, mentionsOf(w.id) + 1);
    }
    return { kind, index: drawn.index, take, a: a2, b: b2, priority: BANTER_PRIORITY[kind] };
  }

  const recently = (kind: BanterKind, now: number): boolean => now - (kindAt.get(kind) ?? Number.NEGATIVE_INFINITY) < (KIND_GAP_MS[kind] ?? 0);

  return {
    moment(m, now, force = false) {
      if (m.type === 'final10') return null;
      const kind: BanterKind = m.type;
      if (!force) {
        if (recently(kind, now)) return null;
        if (m.a !== null && !PLAYER_GAP_EXEMPT.has(kind) && now - (namedAt.get(m.a.id) ?? Number.NEGATIVE_INFINITY) < PLAYER_GAP_MS) return null;
      }
      return make(kind, m.a, m.b, now);
    },
    out(who, first, now) {
      const kind: BanterKind = first ? 'firstOut' : 'out';
      if (!first && recently(kind, now)) return null;
      return make(kind, who, null, now);
    },
    ambient(race, idleMs, now) {
      if (idleMs < AMBIENT_IDLE_MS || race.frozen || race.elapsedMs < AMBIENT_FROM_MS) return null;
      if (race.leftMs > 0 && race.leftMs < AMBIENT_UNTIL_LEFT_MS) return null;
      if (now - ambientAt < AMBIENT_EVERY_MS) return null;
      const list = race.elimination ? race.entries.filter((e) => e.out !== true) : race.entries;
      if (list.length === 0) return null;
      const order = race.elimination ? ELIMINATION_WHEEL : AMBIENT_WHEEL;
      for (let tries = 0; tries < order.length; tries++) {
        const slot = order[wheel % order.length];
        wheel++;
        const n = list.length;
        const top = list[0];
        const second = list[1] ?? null;
        const bottom = list[n - 1];
        const aboveBottom = list[n - 2];
        let line: BanterLine | null = null;
        switch (slot) {
          case 'game': {
            const who = leastMentioned(list, random);
            if (who !== null) line = make(race.gameId, who, null, now);
            break;
          }
          case 'stillLead':
            if (top !== undefined && top.score > 0 && (second === null || second.score < top.score)) line = make('stillLead', top, second, now);
            break;
          case 'mid': {
            if (n >= 4) {
              const who = leastMentioned(list.slice(1, n - 1), random);
              if (who !== null) line = make('mid', who, null, now);
            }
            break;
          }
          case 'last':
            if (n >= 3 && bottom !== undefined && aboveBottom !== undefined && bottom.score < aboveBottom.score && !recently('last', now)) line = make('last', bottom, null, now);
            break;
          case 'room':
            line = make('room', null, null, now);
            break;
          case undefined:
            break;
          default: {
            const _exhaustive: never = slot;
            throw new Error(`Unhandled ambient slot: ${String(_exhaustive)}`);
          }
        }
        if (line !== null) {
          ambientAt = now;
          return line;
        }
      }
      return null;
    },
    unsay(line) {
      for (const w of [line.a, line.b]) {
        if (w === null) continue;
        namedAt.delete(w.id);
        memory.mentions.set(w.id, Math.max(0, mentionsOf(w.id) - 1));
      }
      kindAt.delete(line.kind);
      // back on top of the deck (it was never said, so it may come next)
      const deck = memory.decks.get(line.kind);
      if (deck === undefined) memory.decks.set(line.kind, [line.index]);
      else {
        const at = deck.indexOf(line.index);
        if (at >= 0) deck.splice(at, 1);
        deck.push(line.index);
      }
    },
  };
}

/**
 * Is a take still true when its turn comes (a second or two later)? The leader still leads, the
 * overtake still stands, the zero is still a zero. Otherwise it is dropped unsaid.
 */
export function banterStillTrue(line: BanterLine, entries: readonly BanterEntry[]): boolean {
  const at = (w: BanterWho | null): number => (w === null ? -1 : entries.findIndex((e) => e.id === w.id));
  const ia = at(line.a);
  const ib = at(line.b);
  if (line.a !== null && ia < 0) return false;
  if (line.b !== null && ib < 0) return false;
  switch (line.kind) {
    case 'lead':
    case 'stillLead':
      return ia === 0;
    case 'overtake':
      return ib < 0 || ia < ib;
    case 'zero':
      return (entries[ia]?.score ?? 1) === 0;
    case 'last':
      return ia === entries.length - 1;
    case 'comeback':
      return ia < 3;
    case 'tie':
    case 'photo':
      return ia <= 1 && (ib < 0 || ib <= 1);
    case 'tap':
    case 'icy':
    case 'flappy':
    case 'plotzel':
    case 'ninja':
      return ia < 0 || entries[ia]?.out !== true;
    case 'jump':
    case 'drop':
    case 'streak':
    case 'mid':
    case 'room':
    case 'firstOut':
    case 'out':
      return true;
    default: {
      const _exhaustive: never = line.kind;
      throw new Error(`Unhandled banter kind: ${String(_exhaustive)}`);
    }
  }
}

/** A beat's text with the guests' names in it (the TV shows the names highlighted; this is the plain text). */
export function fillBanter(text: string, names: { readonly a?: string; readonly b?: string }): string {
  return text.replace(/\{a\}/g, names.a ?? '').replace(/\{b\}/g, names.b ?? '');
}
