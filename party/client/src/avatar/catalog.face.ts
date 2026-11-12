/**
 * Extra glasses and face accessories (EYES and FACE slots). One artist owns this file.
 *
 * Id range of this file: 201-224 = EYES (glasses, masks, eye patches), 225-249 = FACE (moustaches, beards, noses, lipstick, stickers).
 * The id decides the slot (shared/avatar.ts, slotOfId); an item whose id is outside the range,
 * whose slot does not match its id, or whose id is already taken is skipped with a console warning
 * and fails tests/unit/avatar.test.ts.
 *
 * Per item provide (type AvatarItem, documented in ./catalog.ts):
 *   id     a free number in the range above. Never reuse or renumber an id: looks are saved by id.
 *   slot   'EYES' for 201-224, 'FACE' for 225-249. One item per slot is worn at a time; EYES are drawn over FACE.
 *   name   short Hebrew name, shown under the picture in the dressing room.
 *   file   '/assets/shimi/props/<name>.png' (the file goes in client/public/assets/shimi/props/).
 *          Transparent PNG, cropped tight to the object, long side 300-600 px, under about 250 KB.
 *   place  [left, top, width, height] in % of the doll box (doll.png, 483 x 1200): where the picture
 *          sits on the bare doll. width / height must keep the picture's own proportions:
 *          height% = width% * (pictureHeight / pictureWidth) * 483 / 1200.
 *   lines  optional: 1-3 funny Hebrew lines the doll says when it gets this item.
 *   colors / burst / fly / snd / contact  optional hints for the dressing room (see AvatarItem).
 *
 * For reference: the eyes are near top 27 .. 29.5 (left eye centre x 37, right 65), the nose tip near [51, 33],
 * the mouth near top 37 .. 41. Originals: heart glasses [21.739, 24, 60.248, 8.583], moustache [20.7, 32.75, 62.11, 5.5].
 *
 * The pictures (props/2xx_*.png) are generated product photos (Higgsfield, nano_banana_2_1), cut out
 * locally (tests/e2e/avatar-face-cut.py; see-through lenses: tests/e2e/avatar-face-lens.py) or with
 * Higgsfield's background remover where the local cut was not clean. Lines follow design/punchlines.he.md.
 * Check your work at /avatar-lab.html?view=items and ?view=slots (npx vite, then open the page).
 */
import type { AvatarItem } from './catalog';

/** height% of the doll box for a picture of `ar` (height / width) placed `w`% wide. */
const hOf = (w: number, ar: number): number => Math.round(w * ar * (483 / 1200) * 100) / 100;

/** Picture height / width of each file (the PNG's own pixel size). */
const AR = {
  aviators: 207 / 560,
  nerd: 241 / 640,
  anaglyph: 190 / 640,
  monocle: 420 / 389,
  patch: 293 / 640,
  stars: 242 / 520,
  nose: 256 / 256,
  blower: 256 / 640,
  rose: 254 / 640,
  pacifier: 310 / 360,
  beard: 415 / 420,
} as const;

export const items: AvatarItem[] = [
  {
    id: 201, slot: 'EYES', name: 'משקפי טייסים', file: '/assets/shimi/props/201_aviators.png',
    place: [23, 24.1, 58, hOf(58, AR.aviators)], ar: AR.aviators, contact: [51.5, 28],
    fly: 'ninja', snd: 'ping', weight: 0.3, power: 1,
    colors: ['#C9A23A', '#3E4A3C', '#E8D08A'], burst: '#FFD21F',
    lines: [
      'קברניט. בשם הצוות, תודה שבחרתם בי.',
      'טופ גאן מקריית מלאכי. ממריא רק לבופה.',
      'מאבטח של סלב. הסלב זה אני.',
    ],
  },
  {
    id: 202, slot: 'EYES', name: 'משקפי חנון', file: '/assets/shimi/props/202_nerd_glasses.png',
    place: [21, 23.3, 62, hOf(62, AR.nerd)], ar: AR.nerd, contact: [51.5, 28],
    fly: 'ninja', snd: 'snap', weight: 0.35, power: 1,
    colors: ['#16120E', '#FFFFFF', '#55585F'], burst: '#1E3FD8',
    lines: [
      'איש מחשבים. ניסיתם לכבות ולהדליק? ידעתי.',
      '800 בפסיכומטרי. פעמיים, ליתר ביטחון.',
      'גאון. אלוף חידון התנ״ך של הבניין.',
    ],
  },
  {
    id: 203, slot: 'EYES', name: 'משקפי תלת־ממד', file: '/assets/shimi/props/203_3d_glasses.png',
    place: [20.5, 23.55, 62, hOf(62, AR.anaglyph)], ar: AR.anaglyph, contact: [51.5, 28],
    fly: 'frisbee', snd: 'snap', weight: 0.2, power: 1,
    colors: ['#F4F2EE', '#D8262E', '#18A9C9'], burst: '#25C3DF',
    lines: [
      'אני בתלת־ממד. אתם עוד בדו.',
      'במאי הוליוודי. האולפן: הסלון בנס ציונה.',
      'מבקר קולנוע. חמישה כוכבים, כולם לי.',
    ],
  },
  {
    id: 204, slot: 'EYES', name: 'מונוקל', file: '/assets/shimi/props/204_monocle.png',
    place: [26.8, 23.6, 28, hOf(28, AR.monocle)], ar: AR.monocle, contact: [38, 28],
    fly: 'feather', snd: 'ping', weight: 0.2, power: 0.8,
    colors: ['#C9962E', '#F2D27A', '#FFFFFF'], burst: '#FFD21F',
    lines: [
      'ג׳נטלמן. פותח לכם דלת בסופר־פארם.',
      'לורד אנגלי. תה של חמש, בחמש וחצי.',
      'בלש. פיצחתי את תעלומת המטען שנעלם.',
    ],
  },
  {
    id: 205, slot: 'EYES', name: 'רטייה', file: '/assets/shimi/props/205_eye_patch.png',
    place: [16.2, 19.4, 70.6, hOf(70.6, AR.patch)], ar: AR.patch, contact: [38, 28],
    fly: 'snapback', snd: 'snap', weight: 0.25, power: 1,
    colors: ['#16120E', '#3A3632', '#6B6560'], burst: '#F2361B',
    lines: [
      'שודד ים. הים: הבריכה של הקאנטרי.',
      'אני רואה רק חצי מכם. החצי היפה.',
      'עין אחת על המסיבה. השנייה על הבורקס.',
    ],
  },
  {
    id: 206, slot: 'EYES', name: 'משקפי כוכב', file: '/assets/shimi/props/206_star_glasses.png',
    place: [21.5, 22.2, 60, hOf(60, AR.stars)], ar: AR.stars, contact: [51.5, 28],
    fly: 'boomerang', snd: 'boing', weight: 0.3, power: 1,
    colors: ['#D4A93A', '#F5D77A', '#9C7A1E'], burst: '#FFD21F',
    lines: [
      'כוכב נולד. בחוג דרמה של המתנ״ס.',
      'סלב. מזהים אותי ברחוב. ברחוב שלי.',
      'וי־איי־פי. את הרשימה בכניסה אני כתבתי.',
    ],
  },
  {
    id: 225, slot: 'FACE', name: 'אף ליצן', file: '/assets/shimi/props/225_clown_nose.png',
    place: [42.5, 28.9, 17, hOf(17, AR.nose)], ar: AR.nose, contact: [51, 32.4],
    fly: 'lob', snd: 'boing', weight: 0.2, power: 1,
    colors: ['#E32B2B', '#B5200A', '#FF8A80'], burst: '#F2361B',
    lines: [
      'ליצן רפואי. מופיע בתור לאחות בקופת חולים.',
      'ליצן הכיתה. מחזור 2009, עדיין בתפקיד.',
      'קרקס. אני גם האריה וגם המאלף.',
    ],
  },
  {
    id: 226, slot: 'FACE', name: 'משרוקית מסיבה', file: '/assets/shimi/props/226_party_blower.png',
    place: [42, 30.7, 54, hOf(54, AR.blower)], ar: AR.blower, contact: [44, 38.6],
    fly: 'boomerang', snd: 'boing', weight: 0.15, power: 1,
    colors: ['#E8213C', '#F5A623', '#1F6FD0', '#7AA62A'], burst: '#D63DC9',
    lines: [
      'ועד שמחות. מאה שקל לראש, ואני הראש.',
      'שופט כדורגל. שורק רק לעצמי.',
      'אני לא הולך למסיבות. מסיבות באות אליי.',
    ],
  },
  {
    id: 227, slot: 'FACE', name: 'ורד בשיניים', file: '/assets/shimi/props/227_rose.png',
    place: [15, 32.2, 72, hOf(72, AR.rose)], ar: AR.rose, contact: [51, 38.8],
    fly: 'feather', snd: 'soft', weight: 0.15, power: 0.8,
    colors: ['#C4161C', '#3F7A2A', '#8E0F14'], burst: '#F2361B',
    lines: [
      'רקדן טנגו. בואנוס איירס, סניף בת ים.',
      'הרווק. את הוורד האחרון שמרתי לעצמי.',
      'רומנטיקן. קטפתי מהגינה של ועד הבית.',
    ],
  },
  {
    id: 228, slot: 'FACE', name: 'מוצץ', file: '/assets/shimi/props/228_pacifier.png',
    place: [37, 34.2, 28, hOf(28, AR.pacifier)], ar: AR.pacifier, contact: [51, 38.6],
    fly: 'lob', snd: 'boing', weight: 0.2, power: 1,
    colors: ['#F05AA8', '#FF8CC6', '#C2337E'], burst: '#FF7EB6',
    lines: [
      'התינוק של המשפחה. גיל: לא רלוונטי.',
      'מנכ״ל. של גן תות, אבל מנכ״ל.',
      'לא בוכה. מנהל משא ומתן.',
    ],
  },
  {
    id: 229, slot: 'FACE', name: 'זקן', file: '/assets/shimi/props/229_beard.png',
    place: [15, 30.9, 72, hOf(72, AR.beard)], ar: AR.beard, contact: [51, 40],
    fly: 'lob', snd: 'fwump', weight: 0.5, power: 1,
    colors: ['#4A3020', '#6B4A33', '#2E1D12'], burst: '#FF9F0A',
    lines: [
      'בריסטה בפלורנטין. הקפה מוכן כשאני מוכן.',
      'חזרתי מהודו. נהיה לי אור פנימי.',
      'סנטה קלאוס מחיפה. המתנות כולן לי.',
    ],
  },
];
