/**
 * The commentator's one-liners: the two party hosts at the microphone, in the owner's voice
 * (design/punchlines.he.md, design/humor-research.md): a show host delighted with the show,
 * a grand official frame on a tiny thing, a glamorous thing moved to a small Israeli place,
 * one image per line, the funny word last, the owner's own exclamations. Always on the
 * guests' side: the last place gets a hug, never a jab. Nothing gross.
 * {a} / {b} are player names, {n} a number. Read from across a room: short.
 * Every line fits any guest: the name is never the subject of a gendered verb or adjective
 * (a noun, "אצל {a}", "ל{a}" instead of "{a} מוביל / לוקח / עלה").
 */
import { isolate } from './common';

import type { MomentType } from './moments';

export type LinePool = MomentType | 'roast' | 'winner' | 'nobody' | 'climber' | 'newLeader' | 'champion' | 'finalIntro' | 'suspense';

export const LINES: Readonly<Record<LinePool, readonly string[]>> = {
  lead: [
    'כתר חדש בעיר: {a}. ההכתרה מחר בארומה.',
    '{a} במקום הראשון! נודר.',
    'ההובלה עוברת ל{a}. {b}, זה לא אישי.',
    'מבזק חדשות: {a} בראש. נעבור לחזאי.',
    '{a} בהובלה. תעדכנו את הקבוצה המשפחתית.',
    '{a} בראש! בן פורת יוסף!',
    'ההובלה אצל {a}. תצלמו מהר, זה עולה לסטורי.',
  ],
  overtake: [
    'עקיפה! {a} לפני {b}, ובלי לאותת.',
    'ביי {b}! {a} בנתיב המהיר.',
    'עקיפה עם נפנוף: {a} לפני {b}. אייקון.',
    '{b}, יש מישהו במראה. זה {a}.',
    'עקיפה בתור לקופה בשופרסל: {a} לפני {b}.',
    '{a} עכשיו לפני {b}. צדיק!',
    'עקיפה של {a}. נפתח נתיב פרטי באיילון.',
  ],
  jump: [
    'נמצא כפתור הטורבו: {a}. נודר!',
    'העלאה ל{a}. בלי לבקש.',
    '{a} בטיסה. מחלקת עסקים לאילת.',
    'גז מלא אצל {a}. מחורחר!',
    'מה זה היה?! {a} בגרסת הפרימיום.',
    '{a} עולה כמו מעלית בעזריאלי.',
  ],
  drop: [
    'בום! הנקודות של {a} יצאו לחופשה באילת.',
    'הפצצה זה אנחנו. סליחה, {a}.',
    'הנקודות של {a} בהמתנה. שיחתך חשובה לנו.',
    'חיתוך של פצצה, {a}. החלטה אמיצה.',
    'אוי {a}. זה לא היה פרי.',
    'נפילה, קימה וחיוך: {a}. אייקון.',
  ],
  // neck and neck at the top (there are no ties: whoever got there first is ahead)
  tie: [
    '{a} ו{b} ראש בראש. מחורחר!',
    'צמוד צמוד! {a} מול {b}, כמו גמר אירוויזיון.',
    'בין {a} ל{b} לא נכנסת אפילו פיתה.',
    'צמוד! מי שמגיע ראשון, לוקח. {a} או {b}?',
    '{a} מול {b}. דרבי של השכונה.',
  ],
  last: [
    'השמירה על הטבלה מלמטה: {a}. תפקיד אחראי.',
    '{a} מאחור, בכוונה. אסטרטגיה.',
    '{a} בכניסה אחרונה, כמו כל כוכב.',
    '{a} עושה חימום. השואו מתחיל עכשיו.',
    'סבלנות. {a} בונה מתח, כמו בטלנובלה.',
    '{a} בסוף הטבלה. מקום עם נוף.',
  ],
  comeback: [
    'קאמבק! {a} בחזרה, כמו להיט מ־2005.',
    'קודם למטה, עכשיו בצמרת: {a}. סינדרלה מחולון.',
    'מי העיר את {a}? בוקר טוב, צמרת.',
    'מאפס למאה: {a}. עונה שנייה.',
    'מישהו סיפר ל{a} שיש תחרות. וואו!',
  ],
  zero: [
    '{a} על אפס. מינימליזם סקנדינבי.',
    'הלו {a}? המשחק התחיל. נא לגשת לדלפק.',
    '{a} עוד לא בפנים. כניסה חגיגית בדרך.',
    'אצל {a} שומרים כוחות. לגמר, כנראה.',
    '{a} על אפס. זאת תמונת ה״לפני״.',
    '{a} עדיין בטעינה. תשעים ותשעה אחוז.',
  ],
  final10: [
    'עשר שניות! תנו הכול!',
    'ישורת אחרונה! אצבעות על המסך.',
    'עשר שניות. כמו סוף מבצע בשופרסל.',
    'עשר שניות! מי שמתעייף, מתעייף בבית.',
  ],
  photo: [
    'פוטו פיניש! {a} או {b}? מחורחר!',
    'צריך VAR. {a} ו{b} על חוט השערה.',
    'אני לא מסוגל להסתכל. {a} מול {b}.',
    '{a} מול {b}. זה הולך לצילום מהמסוק.',
  ],
  streak: [
    'אי אפשר לעצור את {a}. צדיק!',
    '{a} על האש, כמו חמין של שבת.',
    '{a} באש! השכנים כבר מתקשרים.',
    '{a} ברצף. אייקון, אין מה לעשות.',
    '{a} בכושר של גמר אירוויזיון.',
  ],
  roast: [
    'במקום האחרון: {a}. מקום ראשון בלב שלנו.',
    '{a}, העיקר ההשתתפות. נודר.',
    'סוף הטבלה: {a}. מישהו צריך לנעול.',
    '{a} כאן בשביל האוכל. החלטה נכונה.',
    'אחרון זה רק מספר. {a} זה אייקון.',
    '{a} על הפודיום ההפוך. גם זה פודיום.',
    'בסיבוב הבא: {a} עם מאמן אישי.',
  ],
  winner: [
    '{a}!!! תפנו מדף בסלון.',
    'וואו! מלאך הולך הביתה עם {a}!',
    'תנו כבוד! {a} והמלאך, סיפור אהבה.',
    '{a}! בן פורת יוסף! המלאך אורז מזוודה.',
    'מחורחר! הסיבוב של {a}!',
    '{a}!!! נודר! מלאך אחד, בלי שקית.',
  ],
  nobody: ['אף אחד לא קלע? המלאך חוזר למדף.', 'אפס לכולם. המלאך מבקש לדבר עם המנהל.', 'המלאך הסתכל, נאנח, ועף הביתה.'],
  climber: ['מעלית פרטית ל{a}: {n} מקומות למעלה.', 'הקפיצה של הסיבוב: {a}, {n} מקומות. וואו!', '{a}: {n} מקומות למעלה. צדיק!'],
  newLeader: ['ראש טבלה חדש: {a}. נודר!', '{a} בראש הטבלה. הודעה רשמית.', 'הטבלה התהפכה! {a} למעלה. מחורחר!'],
  champion: ['הערב של {a}! מישהו יביא כתר אמיתי.', 'גבירותיי ורבותיי: {a}! בן פורת יוסף!', 'אליפות הערב הולכת ל{a}. התמונה תיתלה בסלון.'],
  // the suspense before the winner when there is (almost) nobody to reveal: fills the quiet
  suspense: [
    'רגע... סופר את הנקודות על האצבעות.',
    'השופטים מתייעצים. במטבח.',
    'המלאך פרש כנפיים. לאן הוא יעוף?',
    'מי שמחזיק אצבעות, זה הזמן.',
    'עוד רגע... עוד רגע... עוד לא.',
    'שקט בבקשה. מבזק מיוחד.',
  ],
  finalIntro: ['רגע האמת! מי עולה לפודיום?', 'תופים בבקשה... הפודיום של הערב!', 'שלושה מקומות, כתר אחד. וואו.'],
};

export interface LineArgs {
  readonly a?: string;
  readonly b?: string;
  readonly n?: number;
}

function fill(template: string, args: LineArgs): string {
  return template
    .replace(/\{a\}/g, args.a !== undefined ? isolate(args.a) : '')
    .replace(/\{b\}/g, args.b !== undefined ? isolate(args.b) : '')
    .replace(/\{n\}/g, args.n !== undefined ? String(args.n) : '');
}

export interface LinePicker {
  /** Next line of the pool: every line is used once before any repeats, and never twice in a row. */
  pick(pool: LinePool, args?: LineArgs): string;
  /** Like pick, but null once every line of the pool was used by this picker (no repeats at all). */
  fresh(pool: LinePool, args?: LineArgs): string | null;
}

export function createLinePicker(random: () => number): LinePicker {
  const decks = new Map<LinePool, number[]>();
  const lastUsed = new Map<LinePool, number>();
  /** Templates already spoken, per pool. */
  const spoken = new Map<LinePool, Set<string>>();

  /** The next template of the pool's shuffled deck (refilled when empty). */
  function draw(pool: LinePool, args: LineArgs): string {
    const lines = LINES[pool];
    let deck = decks.get(pool);
    if (deck === undefined || deck.length === 0) {
      deck = lines.map((_, i) => i);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const a = deck[i];
        const b = deck[j];
        if (a !== undefined && b !== undefined) {
          deck[i] = b;
          deck[j] = a;
        }
      }
      // the next line to be dealt is the last element: keep it different from the previous one
      const top = deck[deck.length - 1];
      if (deck.length > 1 && top === lastUsed.get(pool)) {
        const first = deck[0];
        if (first !== undefined && top !== undefined) {
          deck[0] = top;
          deck[deck.length - 1] = first;
        }
      }
      decks.set(pool, deck);
    }
    const index = deck.pop() ?? 0;
    lastUsed.set(pool, index);
    // a template that needs {b} without one falls back to a line that does not
    let template = lines[index] ?? '';
    if (template.includes('{b}') && args.b === undefined) {
      template = lines.find((l) => !l.includes('{b}')) ?? template;
    }
    return template;
  }

  function remember(pool: LinePool, template: string): void {
    let set = spoken.get(pool);
    if (set === undefined) {
      set = new Set();
      spoken.set(pool, set);
    }
    set.add(template);
  }

  return {
    pick(pool: LinePool, args: LineArgs = {}): string {
      const template = draw(pool, args);
      remember(pool, template);
      return fill(template, args);
    },
    fresh(pool: LinePool, args: LineArgs = {}): string | null {
      const set = spoken.get(pool);
      // one full deck is enough to meet every template that has not been spoken yet
      for (let tries = 0; tries < LINES[pool].length * 2; tries++) {
        const template = draw(pool, args);
        if (set === undefined || !set.has(template)) {
          remember(pool, template);
          return fill(template, args);
        }
      }
      return null;
    },
  };
}
