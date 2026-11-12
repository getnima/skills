/**
 * Dressing room voice: what the doll says, the burst words, and the sounds and haptics.
 * Lines follow the owner's page (design/albert-14-11.source.html) and the voice notes in
 * client/public/assets/shimi/README.md. Sounds and haptics never throw (audio may be locked).
 */
import { sfx } from '../kit/audio';
import { haptic } from '../kit/haptics';

import type { AvatarItem, AvatarSnd } from './catalog';

export const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;

export const LINES = {
  hello: (name: string): string => (name !== '' ? `היי ${name}! תלבישו אותי. ככה תופיעו בטבלה.` : 'היי! תלבישו אותי. ככה תופיעו בטבלה.'),
  tower: ['', '', 'שני כובעים. כמו דוד בפורים.', 'שלושה כובעים, אפס מכנסיים. סדר עדיפויות.'] as readonly string[],
  towerFull: ['תקרה! החלפתי את הקומה העליונה.', 'שלושה זה המקסימום. הוועדה המקומית לא מאשרת יותר.', 'הכובע העליון הוחלף. הקומות למטה נשארות.'],
  flick: ['הוריד לי את זה! איזו חוצפה.', 'אוקיי, אוקיי. קיבלתי את המסר.', 'זה היה בתשלומים!', 'הלך האביזר. הביטחון העצמי נשאר.'],
  bowOff: ['רגע! זה היה כל הבגד שלי!', 'בלי הפפיון אני שוב בגרסת הבסיס.'],
  shake: ['מתחילים מחדש. ערום ומאושר.', 'ניעור! הכל עף. אני נשאר.', 'פינוי־בינוי! מתחילים מחדש.'],
  shakeEmpty: ['אין מה להוריד. אני כבר בגרסת הבסיס.', 'ניערת אותי סתם. אני כבר ערום.'],
  random: ['מחורחר! מי הלביש אותי?', 'לוק חדש, אותו ביטחון.', 'נודר? זה אני?', 'וואו! לא הייתי בוחר את זה. מושלם.'],
  bg: ['רקע חדש, אותו חתיך.', 'וואו, איזה רקע!', 'צבע של מנצחים.', 'ככה רואים אותי מכל הסלון.'],
  done: ['צדיק! ככה אני עולה לטבלה.', 'בן פורת יוסף! יאללה למסיבה.', 'מוכן! שמרו לי מקום ראשון.'],
  generic: (it: AvatarItem): string[] => [`${it.name}! וואו!`, `${it.name}. צדיק!`, 'נודר, זה יושב עליי מושלם.'],
} as const;

export const BURST = {
  land: ['וואו!', 'צדיק!', 'בום!', 'וואו!'],
  stack: 'עוד כובע!',
  off: ['אופס!', 'ביי!', 'וואו!'],
  shake: 'שייק!',
  random: 'הפתעה!',
  done: 'מוכן!',
} as const;

const turn = new Map<number, number>();

/** The item's next funny line (they take turns), or a generic one. */
export function itemLine(it: AvatarItem): string {
  const list = it.lines !== undefined && it.lines.length > 0 ? it.lines : LINES.generic(it);
  const i = turn.get(it.id) ?? Math.floor(Math.random() * list.length);
  turn.set(it.id, i + 1);
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
