/**
 * The commentator's one-liners. {a} / {b} are player names, {n} a number.
 * All good-natured: it is a party, the last place gets a hug.
 */
import { isolate } from './common';

import type { MomentType } from './moments';

export type LinePool = MomentType | 'roast' | 'winner' | 'tieWin' | 'nobody' | 'climber' | 'newLeader' | 'champion' | 'finalIntro';

export const LINES: Readonly<Record<LinePool, readonly string[]>> = {
  lead: [
    '{a} לוקח את ההובלה! אמא גאה',
    'יש לנו מוביל חדש: {a}! תחזיקו חזק',
    'ההובלה עוברת ל{a}! {b}, מה קרה שם?',
    '{a} בראש! מישהו יבדוק שזה חוקי',
    'כתר חדש בעיר: {a}!',
    '{a} דוהר קדימה! {b} אוכל אבק',
    '{a} במקום הראשון! תצלמו מהר, לפני שזה משתנה',
  ],
  overtake: [
    'וואו, {a} עקף את {b} בסיבוב!',
    '{a} חולף על פני {b} ומנופף לשלום',
    'ביי ביי {b}! {a} כבר לא רואה אותך במראה',
    '{b}, זה היה {a} שחלף לידך. כן, שוב',
    'עקיפה מסוכנת של {a}! {b} בהלם',
    '{a} מטפס בטבלה כמו חתול על וילון',
    '{b} מצמץ לשנייה, ו{a} כבר לפניו',
  ],
  jump: [
    'מה זה היה?! {a} קפץ כמו קנגורו על אספרסו',
    '{a} מצא את כפתור הטורבו!',
    'מישהו בדק ל{a} את האצבעות? זה לא אנושי',
    '{a} בהתקף ניקוד! שמישהו יביא מים',
    'בום! {a} מוסיף נקודות כאילו אין מחר',
    '{a} לחץ על הגז ושכח איפה הברקס',
  ],
  drop: [
    'אוי אוי אוי! הניקוד של {a} התאדה',
    '{a} מאבד נקודות! זה כאב גם לי',
    'בוווום! הניקוד של {a} יצא לחופשה',
    '{a}, הפצצה היא לא חברה שלך!',
    'דקה דומייה לזכר הנקודות של {a}',
    '{a} בדיוק הבין למה קוראים לזה פצצה',
  ],
  tie: [
    'תיקו בצמרת! {a} ו{b} צמודים כמו מסטיק לנעל',
    '{a} ו{b} ראש בראש! מי ימצמץ ראשון?',
    'צמוד, צמוד, צמוד! {a} מול {b}',
    'אי אפשר להכניס סיכה בין {a} ל{b}!',
    '{a} ו{b} באותו ניקוד בדיוק. תיאמתם?',
  ],
  last: [
    '{a} סוגר את הטבלה, אבל עם סטייל',
    '{a} במקום האחרון. מישהו צריך לשמור על הטבלה מלמטה',
    '{a}, החילזון שלח הודעה: הוא מחכה לך',
    'אל דאגה {a}, גם האחרון מקבל חיבוק',
    '{a} לוקח את הזמן. הרבה זמן',
    '{a} לא ממהר לשום מקום, ובצדק',
  ],
  comeback: [
    'קאמבק של החיים! {a} חוזר מהמתים',
    '{a} היה בתחתית ועכשיו בצמרת! איזה סיפור',
    'מי העיר את {a}? הוא טס למעלה!',
    'מאפס לגיבור: {a}!',
    '{a} נזכר שיש תחרות ומפרק את כולם',
  ],
  zero: [
    '{a} על אפס? מישהו יעיר אותו',
    '{a}, במסך נוגעים. עם האצבע',
    'אפס עגול ויפה ל{a}. לפחות זה סימטרי',
    'הלו {a}? המשחק כבר התחיל!',
    '{a} שומר כוחות. לשנה הבאה כנראה',
    '{a} עדיין מחפש איפה מדליקים את הטלפון',
  ],
  final10: [
    'עשר שניות אחרונות! תנו הכול!',
    'הישורת האחרונה! אצבעות על המסך!',
    'עוד עשר שניות וזה נגמר! לא לעצור!',
    'ספרינט סיום! מי שממצמץ מפסיד',
  ],
  photo: [
    'פוטו פיניש! {a} ו{b} על חוט השערה',
    'זה ייגמר על חודה של נקודה! {a} או {b}?',
    'אני לא מסוגל להסתכל! {a} מול {b} עד הסוף',
    'צריך מצלמה בקו הסיום! {a} ו{b} צמודים',
  ],
  streak: [
    '{a} על אש! שמישהו יביא מטף',
    'אי אפשר לעצור את {a}!',
    '{a} בוער! כולם לזוז הצידה',
    '{a} ברצף מטורף, המסך שלו מעלה עשן',
    '{a} חם יותר מחמין של שבת',
  ],
  roast: [
    '{a} במקום האחרון, אבל ראשון בלב שלנו',
    '{a}, העיקר ההשתתפות. באמת',
    'מישהו צריך להיות אחרון, והיום {a} התנדב',
    '{a} שומר על הטבלה שלא תיפול',
    '{a} הוא אגדה. אגדה עצובה, אבל אגדה',
    'לא נורא {a}, בסיבוב הבא יהיה... סיבוב הבא',
    '{a} בא בשביל האוכל, וזה לגיטימי',
  ],
  winner: [
    'אני לא מאמין!!! {a}!!! השימי אנג׳ל שלך!!!',
    '{a}!!! תפנו מדף, יש מלאך בדרך!',
    'איזה ניצחון! {a} הולך הביתה עם מלאך!',
    '{a} לוקח את הסיבוב! המלאך כבר אורז מזוודה',
    'תנו כבוד! {a} והשימי אנג׳ל, סיפור אהבה',
    'וואו וואו וואו! {a}! מלאך אחד, בבקשה!',
  ],
  tieWin: ['תיקו! כולכם זוכים! המלאך משתכפל!', 'אין פה מפסידים! מלאך לכל מנצח!', 'שיתוף פעולה מרגש. מלאך לכל אחד!'],
  nobody: ['אף אחד לא קלע? המלאך נעלב וחוזר הביתה', 'אפס נקודות לכולם. המלאך נשאר על המדף', 'המלאך הסתכל, נאנח, ועף חזרה'],
  climber: ['{a} טיפס {n} מקומות! מעלית פרטית', 'הקפיצה של הסיבוב: {a}, {n} מקומות למעלה!', '{a} עלה {n} מקומות. מישהו אכל ארוחת בוקר'],
  newLeader: ['יש מוביל חדש בטבלה הכללית: {a}!', '{a} תופס את המקום הראשון בטבלה! להחזיק חזק', 'הטבלה התהפכה! {a} למעלה'],
  champion: ['{a} לוקח את הערב!!! מישהו יביא כתר אמיתי', 'גבירותיי ורבותיי: {a}! בלי עוררין!', 'היסטוריה נכתבת! {a} לוקח את הכול!'],
  finalIntro: ['רגע האמת! מי עולה על הפודיום?', 'תופים בבקשה... הפודיום של הערב!', 'זה הזמן. שלושה מקומות, כתר אחד'],
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
}

export function createLinePicker(random: () => number): LinePicker {
  const decks = new Map<LinePool, number[]>();
  const lastUsed = new Map<LinePool, number>();
  return {
    pick(pool: LinePool, args: LineArgs = {}): string {
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
      return fill(template, args);
    },
  };
}
