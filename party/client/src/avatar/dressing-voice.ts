/**
 * Dressing room voice: what the doll says, the burst words, and the sounds and haptics.
 * Lines follow the owner's voice guide, design/punchlines.he.md (combination lines win over an item's own). Sounds and haptics never throw (audio may be locked).
 */
import { sfx } from '../kit/audio';
import { haptic } from '../kit/haptics';

import { linesFor } from './catalog';

import type { AvatarLook } from '../../../shared/avatar';
import type { AvatarItem, AvatarSnd } from './catalog';

export const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;

export const LINES = {
  hello: (name: string): string => (name !== '' ? `היי ${name}! תלבישו אותי. ככה תופיעו בטבלה.` : 'היי! תלבישו אותי. ככה תופיעו בטבלה.'),
  tower: ['הוספתי קומה. בלי היתר.', 'דופלקס. הנוף מלמעלה מדהים.'] as readonly string[],
  towerFull: ['שלוש קומות זה המקסימום. הוועדה המקומית לא מאשרת יותר.', 'החלפתי את הפנטהאוז. הדיירים למטה נשארים.'],
  flick: ['גם בלי זה אני אייקון.', 'הלך האביזר. הכריזמה נשארה.', 'זה היה בהשאלה. ממוזיאון ישראל.', 'מינימליזם. גם את זה אני עושה הכי טוב.'],
  bowOff: ['הפפיון ירד. האירוע ממשיך, כי האירוע זה אני.'],
  shake: ['גרסת אנפלאגד. הקהל ביקש.', 'ניעור! הכול עף. אני נשאר.', 'פינוי־בינוי. מתחילים מחדש.'],
  shakeEmpty: ['אין מה לנער. אני כבר אנפלאגד.', 'מקורי, בלי תוספות. כמו חומוס טוב.'],
  random: ['מחורחר! מי הלביש אותי?', 'לוק חדש, אותו ביטחון.', 'נודר? זה אני?', 'וואו! לא הייתי בוחר את זה. מושלם.'],
  bg: ['רקע חדש, אותו חתיך.', 'וואו, איזה רקע!', 'צבע של מנצחים.', 'ככה רואים אותי מכל הסלון.'],
  done: ['אש! ככה אני עולה לטבלה.', 'טפו חמסה! יאללה למסיבה.', 'מוכן! שמרו לי מקום ראשון.'],
} as const;

export const BURST = {
  land: ['וואו!', 'אש!', 'בום!', 'וואו!'],
  stack: 'עוד כובע!',
  off: ['אופס!', 'ביי!', 'וואו!'],
  shake: 'שייק!',
  random: 'הפתעה!',
  done: 'מוכן!',
} as const;

const turn = new Map<number, number>();

/**
 * What the doll says when `it` lands on `look` (the look with the item on): the line of a
 * combination the item completes, else the item's next line (they take turns), else a generic reaction.
 */
export function itemLine(it: AvatarItem, look: AvatarLook): string {
  const list = linesFor(look, it.id);
  const key = list === it.lines ? it.id : -it.id;
  const i = turn.get(key) ?? Math.floor(Math.random() * list.length);
  turn.set(key, i + 1);
  return list[i % list.length] ?? it.name;
}

let lastSound = 0;

/** Plays a sound unless one played in the last 35 ms (a flood of taps is not a wall of noise). */
function guard(fn: () => void): void {
  const now = performance.now();
  if (now - lastSound < 35) return;
  lastSound = now;
  try {
    fn();
  } catch {
    /* audio locked or unavailable */
  }
}

export const sound = {
  whoosh: (): void => guard(() => sfx.whoosh(1.1 + Math.random() * 0.3)),
  land(snd: AvatarSnd | undefined): void {
    guard(() => {
      switch (snd) {
        case 'thud':
          sfx.land(0.8);
          break;
        case 'fwump':
          sfx.land(1.15);
          break;
        case 'boom':
          sfx.hit();
          break;
        case 'snap':
          sfx.tap(1.5);
          break;
        case 'ping':
          sfx.coin(1.1);
          break;
        case 'boing':
          sfx.jump(1.15);
          break;
        case 'soft':
        case undefined:
          sfx.pop(1.25);
          break;
        default: {
          const never: never = snd;
          return never;
        }
      }
    });
  },
  off: (): void => guard(() => sfx.whoosh(0.75)),
  pop: (p = 1): void => guard(() => sfx.pop(p)),
  tap: (p = 1): void => guard(() => sfx.tap(p)),
  shake: (): void => guard(() => sfx.fall()),
  done: (): void => guard(() => sfx.success()),
  stack: (level: number): void => guard(() => sfx.coin(1 + level * 0.12)),
};

export const buzz = {
  tap: (): void => {
    try {
      haptic.tap();
    } catch {
      /* ignore */
    }
  },
  bump: (): void => {
    try {
      haptic.bump();
    } catch {
      /* ignore */
    }
  },
  done: (): void => {
    try {
      haptic.success();
    } catch {
      /* ignore */
    }
  },
};
