/**
 * The accessory catalog: every picture the doll can wear, where it sits, and the 12 background plates.
 * Plain data, no DOM (the unit tests and, if it ever wants to, the server can import it).
 *
 * Items 1-17 are ported exactly from ITEMS in design/albert-14-11.source.html (the owner's
 * "dress the doll" page). Extra items come from the three part files, one per artist:
 *   catalog.hats.ts 101-149 (HEAD) · catalog.face.ts 201-249 (EYES, FACE) · catalog.extras.ts 301-349 (EARS, NECK)
 */
import { AVATAR_BG_COUNT, AVATAR_MAX_TOWER, sanitizeLook, slotOfId } from '../../../shared/avatar';
import { items as extraItems } from './catalog.extras';
import { items as faceItems } from './catalog.face';
import { items as hatItems } from './catalog.hats';

import type { AvatarLook, AvatarSlot } from '../../../shared/avatar';

/** How an accessory flies onto the doll (names of the source page's flight styles). */
export type AvatarFly = 'lob' | 'frisbee' | 'cannon' | 'snapback' | 'ninja' | 'boomerang' | 'feather';
/** Landing sound of the source page. */
export type AvatarSnd = 'thud' | 'fwump' | 'boom' | 'snap' | 'ping' | 'boing' | 'soft';

/**
 * Hat-tower geometry, in fractions of the hat picture's height (0 = top edge, 1 = bottom edge).
 * The next hat's `bottom` line is placed `crown + sink` below this hat's top edge.
 */
export interface AvatarTower {
  /** Empty space above the top of the hat. */
  crown: number;
  /** Where the brim / lower edge of the hat is (the line that rests on what is below). */
  bottom: number;
  /** How deep the hat above sinks into this one. */
  sink: number;
  /** Where the top of the head is inside the hat (the source page uses it for a tower on a bare head). */
  seat: number;
}

export interface AvatarItem {
  /** Unique, stable id: looks are stored by id. 1-17 originals, 101-149 hats, 201-249 face, 301-349 extras. */
  id: number;
  /** Must equal slotOfId(id) from shared/avatar.ts. */
  slot: AvatarSlot;
  /** Short Hebrew name. */
  name: string;
  /** Public path of a transparent PNG, e.g. '/assets/shimi/props/chef_hat.png'. */
  file: string;
  /**
   * [left, top, width, height] in % of the doll box (doll.png, 483 x 1200 px): where the picture sits
   * on the bare doll. May be negative / wider than 100 (hats stick out).
   */
  place: readonly [number, number, number, number];
  /** Picture height / width. Default: taken from `place` (height% * 1200) / (width% * 483). Used for tower hats. */
  ar?: number;
  /** Hats only: without it the hat can be worn and can top a tower, but no hat stacks on it. */
  tw?: AvatarTower;
  /** Funny Hebrew lines the doll says when it gets the item. */
  lines?: readonly string[];
  /** Main colours of the picture (confetti, the shelf tile). */
  colors?: readonly string[];
  /** Colour of the "wow" burst when it lands. */
  burst?: string;
  /** Where the item touches the doll, [x, y] in % of the doll box (squash origin, landing shadow). */
  contact?: readonly [number, number];
  /** Flight style hint. */
  fly?: AvatarFly;
  /** Landing sound hint. */
  snd?: AvatarSnd;
  /** 0..1, how heavy it lands. */
  weight?: number;
  /** How hard it knocks off what was there (1 = normal). */
  power?: number;
}

/**
 * The doll picture all placement refers to, and how the source page layers things.
 * Paint order (the source's DOM order): doll body, doll head, EARS, FACE, EYES, HEAD (the worn hat),
 * the hat tower (bottom to top), NECK. The source has no per-item z rules.
 */
export const DOLL = {
  file: '/assets/shimi/doll.png',
  width: 483,
  height: 1200,
  /** The head is the top 43% of the doll (the chin dips to 48%). */
  headSplit: 43,
  /** Source `.d-head` clip-path: the head part of doll.png, in % of the doll box. */
  headClip: [[0, 0], [100, 0], [100, 43], [73, 43], [71, 45.3], [62, 47.4], [51, 48], [40, 47.4], [32, 45], [30, 43], [0, 43]],
  /** Source `.d-body` clip-path. */
  bodyClip: [[0, 43], [30, 43], [34, 44.8], [40, 46], [51, 46.6], [62, 46], [67.5, 45.2], [71, 45], [100, 45], [100, 100], [0, 100]],
  /** The bobblehead pivot (`.head` transform-origin) and the doll's centre line, in %. */
  headPivot: [51, 46],
  centerX: 51,
  /** Opaque bounds of the bare head (ears included) in %: [left, top, right, bottom]. */
  headBox: [13, 0.3, 89.5, 48.2],
  /** Head and shoulders. */
  bustBox: [6, 0.3, 95, 63],
  /** The whole doll. */
  fullBox: [1, 0.3, 99, 99.7],
  /** Tower hats shrink by this factor per level (source: Math.pow(.93, level + 1)). */
  towerShrink: 0.93,
} as const;

/** Paint order of the accessory layers over the doll. */
export const LAYER_ORDER: readonly AvatarSlot[] = ['EARS', 'FACE', 'EYES', 'HEAD', 'NECK'];

/** Used for a tower hat that has no `tw` of its own. */
export const DEFAULT_TOWER: AvatarTower = { crown: 0.05, bottom: 0.97, sink: 0.15, seat: 0.3 };

/** Accessories 1-17, exactly as on the owner's page. */
export const BASE_ITEMS: readonly AvatarItem[] = [
  {
    id: 1, slot: 'HEAD', name: 'קסדת בירה', file: '/assets/shimi/prop_01_beer_helmet.png',
    place: [-5.59, -13.07, 110, 53.99], ar: 589 / 483, contact: [50.5, 3],
    tw: { crown: 0.08, bottom: 0.5, sink: 0.1, seat: 0.261 },
    fly: 'lob', snd: 'thud', weight: 1, power: 1.3,
    colors: ['#2F55E4', '#FFD21F', '#FFFFFF'], burst: '#4F6CFF',
    lines: [
      'קסדת בירה. כי בטיחות זה לא רק לפועלי בניין.',
      'שתי כוסות, קש אחד, אפס ידיים. ככה עושים מולטיטאסקינג.',
      'המחזיקים ריקים. מישהו מביא בירה, או שאני מזמין משלוח?',
    ],
  },
  {
    id: 2, slot: 'HEAD', name: 'כובע קש', file: '/assets/shimi/prop_02_straw_hat.png',
    place: [8.53, -4.45, 87, 20.62], ar: 225 / 382, contact: [51, 9],
    tw: { crown: 0.04, bottom: 0.97, sink: 0.2, seat: 0.264 },
    fly: 'frisbee', snd: 'fwump', weight: 0.35, power: 1,
    colors: ['#D9B45A', '#1E8A4C', '#F3DE9A'], burst: '#3CC85A',
    lines: [
      'כובע קש. רשמית אני בחופש עד הודעה חדשה.',
      'לוק של דוד בבר־מצווה בקיסריה. מושלם.',
      'שמש, ים, כובע קש. בגד ים? נדבר על זה.',
    ],
  },
  {
    id: 3, slot: 'HEAD', name: 'כובע פיראטים', file: '/assets/shimi/prop_03_pirate_hat.png',
    place: [3.98, -6.28, 94.06, 23.47], ar: 256 / 413, contact: [51, 9],
    tw: { crown: 0.05, bottom: 0.97, sink: 0.17, seat: 0.31 },
    fly: 'cannon', snd: 'boom', weight: 0.85, power: 1.6,
    colors: ['#1B1B1F', '#D4A63A', '#C0392B'], burst: '#F2361B',
    lines: [
      'ארררר! זו לא קללה, זו פיראטית.',
      'קפטן הבובה. בלי ספינה, בלי מכנסיים, עם המון ביטחון.',
      'חיפשתם אוצר? מצאתם. אני האוצר.',
    ],
  },
  {
    id: 4, slot: 'HEAD', name: 'כובע הפוך', file: '/assets/shimi/prop_04_backwards_cap.png',
    place: [24.02, -3.81, 55.11, 19.34], ar: 211 / 242, contact: [51.5, 7],
    tw: { crown: 0.05, bottom: 0.97, sink: 0.15, seat: 0.249 },
    fly: 'snapback', snd: 'snap', weight: 0.4, power: 1,
    colors: ['#2A2C31', '#55585F', '#9AA0A6'], burst: '#1E3FD8',
    lines: [
      'כובע הפוך. עכשיו אני ג׳וניור בסטארטאפ.',
      'אחי. אחי. אחי. זהו, זה כל המשפט.',
      'יאללה, מתחילים ספרינט. הכובע כבר הפוך.',
    ],
  },
  {
    id: 5, slot: 'EYES', name: 'משקפי תריס', file: '/assets/shimi/prop_05_shutter_glasses.png',
    place: [24.62, 23.95, 53.33, 8.15], ar: 85 / 224, contact: [51, 28],
    fly: 'ninja', snd: 'ping', weight: 0.3, power: 1,
    colors: ['#FF7A1A', '#FFB067', '#FFFFFF'], burst: '#FF9F0A',
    lines: [
      'השמש של תל אביב, אחי. אין ברירה.',
      'רואים דרך התריסים? כן. רואים אותי? מאוד.',
      'משקפי מסיבה הופעלו. המסיבה: אני.',
    ],
  },
  {
    id: 6, slot: 'EARS', name: 'אוזני ענק ירוקות', file: '/assets/shimi/prop_06_green_ears.png',
    place: [7.3, 23.98, 87.09, 10.63], ar: 145 / 478, contact: [51, 29],
    fly: 'boomerang', snd: 'boing', weight: 0.5, power: 1,
    colors: ['#8BC34A', '#5E9E1F', '#C5E86C'], burst: '#3CC85A',
    lines: [
      'עכשיו אני שומע הכל. במיוחד רכילות.',
      'אוזניים ירוקות, לב של זהב.',
      'מה אמרת? סתם, שמעתי. שמעתי גם את השכנים.',
    ],
  },
  {
    id: 7, slot: 'NECK', name: 'פפיון ורוד', file: '/assets/shimi/prop_07_pink_bow.png',
    place: [32.63, 43.96, 38.25, 12.14], ar: 233 / 296, contact: [51.7, 48],
    fly: 'feather', snd: 'soft', weight: 0.25, power: 1,
    colors: ['#F7B6CF', '#F28DB2', '#FFE3EE'], burst: '#FF7EB6',
    lines: [
      'פפיון ורוד. סוף סוף אני צנוע.',
      'קוד לבוש: חגיגי. אז שמתי פפיון. וזהו.',
      'עכשיו אפשר להכיר אותי להורים.',
    ],
  },
  {
    id: 8, slot: 'HEAD', name: 'כתר', file: '/assets/shimi/prop_08_crown.png',
    place: [9.524, -15.833, 82.816, 33.583], ar: 645 / 640, contact: [51, 14],
    tw: { crown: 0.24, bottom: 0.985, sink: 0.08, seat: 0.5 },
    fly: 'feather', snd: 'ping', weight: 0.6, power: 1.1,
    colors: ['#C9A23A', '#FFD21F', '#1D3A7A', '#F2EFE6'], burst: '#FFD21F',
    lines: [
      'כתר. מהיום פונים אליי ״הוד מעלתו הבובה״.',
      'מלך הסלון. הממלכה: שלושה חדרים ומרפסת שירות.',
      'הכתר אמיתי. הממלכה בשכירות.',
    ],
  },
  {
    id: 9, slot: 'EYES', name: 'משקפי לב', file: '/assets/shimi/prop_09_heart_glasses.png',
    place: [21.739, 24, 60.248, 8.583], ar: 165 / 466, contact: [51.8, 28],
    fly: 'ninja', snd: 'ping', weight: 0.3, power: 1,
    colors: ['#FF7EB6', '#D98AA8', '#F7B6CF'], burst: '#FF7EB6',
    lines: [
      'משקפי לב. הכל ורוד, אפילו חשבון הארנונה.',
      'מאוהב. במי? בעצמי, כרגיל.',
      'ראיתי אתכם ונפל לי הלב. ישר לתוך המשקפיים.',
    ],
  },
  {
    id: 10, slot: 'HEAD', name: 'כובע צילינדר', file: '/assets/shimi/prop_10_top_hat.png',
    place: [9.52, -10.67, 84.47, 29.83], ar: 572 / 653, contact: [51, 15],
    tw: { crown: 0.02, bottom: 0.99, sink: 0.06, seat: 0.38 },
    fly: 'snapback', snd: 'fwump', weight: 0.55, power: 1.1,
    colors: ['#16120E', '#4A4436', '#FFFFFF'], burst: '#6A3FB5',
    lines: [
      'צילינדר. עכשיו אני שולף ממנו ארנב. סתם, יש שם רק חשבונית.',
      'ערב גאלה. קוד לבוש: כובע. רק כובע.',
      'אצולה בריטית. משכורת ישראלית.',
    ],
  },
  {
    id: 11, slot: 'FACE', name: 'שפם', file: '/assets/shimi/prop_11_moustache.png',
    place: [20.7, 32.75, 62.11, 5.5], ar: 105 / 480, contact: [51.8, 34],
    fly: 'ninja', snd: 'snap', weight: 0.2, power: 1,
    colors: ['#3A2416', '#5E3C24', '#FFD21F'], burst: '#F2361B',
    lines: [
      'שפם. עכשיו אני נראה כמו דוד שמגיע עם מגש בורקס.',
      'שפם של יו״ר ועד בית. מי חנה בחניה שלי?',
      'שפם של בלש משנות השמונים. התעלומה: איפה המכנסיים.',
    ],
  },
  {
    id: 12, slot: 'HEAD', name: 'סומבררו', file: '/assets/shimi/prop_12_sombrero.png',
    place: [-13.46, -9.17, 140.79, 30.33], ar: 461 / 860, contact: [51, 15],
    tw: { crown: 0.03, bottom: 0.98, sink: 0.12, seat: 0.32 },
    fly: 'frisbee', snd: 'fwump', weight: 0.5, power: 1.2,
    colors: ['#111114', '#C8C8C8', '#3CC85A', '#F2361B'], burst: '#3CC85A',
    lines: [
      'סומבררו! אולה! מישהו הזמין טאקו לחנוכת הבית?',
      'צל לכל המשפחה. גם לשכנים מלמטה.',
      'סייסטה בסלון. כל יום משתיים עד ארבע, אל תצלצלו.',
    ],
  },
  {
    id: 13, slot: 'EARS', name: 'אוזניות', file: '/assets/shimi/prop_13_headphones.png',
    place: [-9.73, -3.58, 122.15, 43.33], ar: 706 / 800, contact: [51, 30],
    fly: 'lob', snd: 'thud', weight: 0.7, power: 1.2,
    colors: ['#E8E4DC', '#4A4A4A', '#A0A0A0'], burst: '#4F6CFF',
    lines: [
      '"תנו לי רק מוזיקה". קיבלתי. תודה.',
      'אוזניות. אני לא שומע אתכם, אני בהופעה פרטית.',
      'ביטול רעשים. גם של השיפוצים של השכנים.',
    ],
  },
  {
    id: 14, slot: 'HEAD', name: 'קסדת ויקינגים', file: '/assets/shimi/prop_14_viking_helmet.png',
    place: [-24.43, -17.17, 153.21, 35.08], ar: 546 / 960, contact: [51, 14],
    tw: { crown: 0.36, bottom: 0.985, sink: 0.06, seat: 0.52 },
    fly: 'cannon', snd: 'boom', weight: 1, power: 1.6,
    colors: ['#6B5A3A', '#C9A86A', '#3A3020'], burst: '#FF9F0A',
    lines: [
      'קסדת ויקינגים. באתי לבזוז את המזנון.',
      'ויקינג בחנוכת בית: שובר כוסות, אבל מביא מתנה.',
      'הקרניים אמיתיות. גם הרעב.',
    ],
  },
  {
    id: 15, slot: 'NECK', name: 'זר הוואי', file: '/assets/shimi/prop_15_lei.png',
    place: [20.7, 47.67, 60.04, 27], ar: 520 / 464, contact: [50.7, 48],
    fly: 'feather', snd: 'soft', weight: 0.25, power: 1,
    colors: ['#FBF6E6', '#F2D23A', '#FF7EB6'], burst: '#25C3DF',
    lines: [
      'אלוהה! זה כמו הוואי, רק עם ממ״ד.',
      'זר פרחים. עכשיו אני גם לבוש וגם ריחני.',
      'נחתתי מהוואי. המזוודה עוד בבן גוריון.',
    ],
  },
  {
    id: 16, slot: 'HEAD', name: 'כובע טמבל', file: '/assets/shimi/prop_16_bucket_hat.png',
    place: [4.55, -14.33, 96.48, 33.75], ar: 649 / 746, contact: [52.5, 15],
    tw: { crown: 0.06, bottom: 0.96, sink: 0.14, seat: 0.45 },
    fly: 'boomerang', snd: 'fwump', weight: 0.35, power: 1,
    colors: ['#9A9A78', '#C8C8A8', '#1E3FD8', '#FFFFFF'], burst: '#1E3FD8',
    lines: [
      'כובע טמבל! ריח של קיבוץ, ארטיק קרטיב ומים מהברזייה.',
      'עם הכובע הזה ייבשתי ביצות. בסלון.',
      'סבתא אמרה שבלי כובע טמבל לא יוצאים לשמש. סבתא צדקה.',
    ],
  },
  {
    id: 17, slot: 'HEAD', name: 'כובע מסיבה', file: '/assets/shimi/prop_17_party_hat.png',
    place: [29.61, -15.17, 43.89, 25.17], ar: 355 / 249, contact: [51.5, 8],
    tw: { crown: 0.03, bottom: 0.96, sink: 0.16, seat: 0.63 },
    fly: 'boomerang', snd: 'boing', weight: 0.25, power: 1,
    colors: ['#E8213C', '#1F6FD0', '#F5A623', '#7AA62A', '#6A3FB5'], burst: '#D63DC9',
    lines: [
      'כובע מסיבה! עכשיו זה רשמי: יש מסיבה.',
      'יום הולדת? לא, חנוכת בית. אותו כובע.',
      'החרוט עליי, העוגה עליכם.',
    ],
  },
];

export type AvatarBgKind = 'flat' | 'sunburst' | 'dots' | 'bars' | 'stars';

export interface AvatarBg {
  id: number;
  /** Hebrew name for the dressing room. */
  name: string;
  kind: AvatarBgKind;
  /** Main colour: the flat fill, and the placeholder colour while the picture is composed. */
  color: string;
  /** Second colour of a pattern. */
  color2?: string;
  /** Colour of the sticker outline around the doll on this plate. */
  outline: string;
}

const INK = '#16120E';
const PAPER = '#FFF8E6';

/** The 12 plates of the design system: 8 flat colours and 4 patterns (drawn in compose.ts). */
export const AVATAR_BGS: readonly AvatarBg[] = [
  { id: 0, name: 'צהוב', kind: 'flat', color: '#FFD21F', outline: INK },
  { id: 1, name: 'אדום', kind: 'flat', color: '#F2361B', outline: INK },
  { id: 2, name: 'כחול', kind: 'flat', color: '#1E3FD8', outline: INK },
  { id: 3, name: 'ורוד', kind: 'flat', color: '#FF7EB6', outline: INK },
  { id: 4, name: 'נייר', kind: 'flat', color: PAPER, outline: INK },
  { id: 5, name: 'כתום', kind: 'flat', color: '#FF9F0A', outline: INK },
  { id: 6, name: 'תכלת', kind: 'flat', color: '#4F6CFF', outline: INK },
  { id: 7, name: 'לילה', kind: 'flat', color: INK, outline: PAPER },
  { id: 8, name: 'קרני שמש', kind: 'sunburst', color: '#FFD21F', color2: '#FF9F0A', outline: INK },
  { id: 9, name: 'נקודות', kind: 'dots', color: '#FF7EB6', color2: '#F2361B', outline: INK },
  { id: 10, name: 'טלוויזיה', kind: 'bars', color: '#19B5C8', outline: INK },
  { id: 11, name: 'כוכבים', kind: 'stars', color: '#10238C', color2: '#FFD21F', outline: PAPER },
];

export function getBg(bg: number): AvatarBg {
  return AVATAR_BGS[bg] ?? (AVATAR_BGS[0] as AvatarBg);
}

/** Flat colour of a plate (CSS placeholder while the picture loads). */
export function plateColor(bg: number): string {
  return getBg(bg).color;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Why an item cannot join the catalog, or null when it is fine. */
export function itemProblem(it: AvatarItem, range?: readonly [number, number]): string | null {
  if (typeof it !== 'object' || it === null) return 'not an object';
  if (!Number.isInteger(it.id)) return 'id is not an integer';
  if (range !== undefined && (it.id < range[0] || it.id > range[1])) return `id ${it.id} is outside ${range[0]}-${range[1]}`;
  const slot = slotOfId(it.id);
  if (slot === null) return `id ${it.id} is in no id range`;
  if (it.slot !== slot) return `id ${it.id} must be slot ${slot}, not ${String(it.slot)}`;
  if (typeof it.name !== 'string' || it.name.trim() === '') return 'no name';
  if (typeof it.file !== 'string' || !/^\/assets\/[\w./-]+\.(png|webp)$/.test(it.file)) return 'file must be a /assets/... .png path';
  const p = it.place as readonly unknown[];
  if (!Array.isArray(p) || p.length !== 4 || !p.every(finite)) return 'place must be 4 numbers';
  const [l, t, w, h] = p as unknown as [number, number, number, number];
  if (w <= 0 || h <= 0 || w > 220 || h > 100 || l < -80 || l > 110 || t < -40 || t > 100) return 'place is off the doll';
  if (it.ar !== undefined && (!finite(it.ar) || it.ar <= 0)) return 'ar must be positive';
  if (it.tw !== undefined) {
    const { crown, bottom, sink, seat } = it.tw;
    if (![crown, bottom, sink, seat].every((v) => finite(v) && v >= 0 && v <= 1)) return 'tw values must be 0..1';
    if (bottom - crown - sink <= 0.05) return 'tw: bottom - crown - sink must be over 0.05 (the tower would not grow)';
  }
  return null;
}

/** The part files and their id ranges. */
export const CATALOG_PARTS: readonly { file: string; range: readonly [number, number]; items: readonly AvatarItem[] }[] = [
  { file: 'catalog.hats.ts', range: [101, 149], items: hatItems },
  { file: 'catalog.face.ts', range: [201, 249], items: faceItems },
  { file: 'catalog.extras.ts', range: [301, 349], items: extraItems },
];

/** Problems found while merging the part files (empty when all is well). The unit test wants it empty. */
export const CATALOG_PROBLEMS: string[] = [];

function buildCatalog(): AvatarItem[] {
  const all: AvatarItem[] = [...BASE_ITEMS];
  const seen = new Set(all.map((i) => i.id));
  for (const part of CATALOG_PARTS) {
    const list: readonly AvatarItem[] = Array.isArray(part.items) ? part.items : [];
    for (const it of list) {
      const problem = itemProblem(it, part.range) ?? (seen.has(it.id) ? `id ${it.id} is used twice` : null);
      if (problem !== null) {
        CATALOG_PROBLEMS.push(`${part.file}: ${problem}`);
        continue;
      }
      seen.add(it.id);
      all.push(it);
    }
  }
  if (CATALOG_PROBLEMS.length > 0 && typeof console !== 'undefined') console.warn('[avatar] skipped catalog items:', CATALOG_PROBLEMS);
  return all;
}

/** Every accessory: the 17 originals, then the extras by id. */
export const ITEMS: readonly AvatarItem[] = buildCatalog().sort((a, b) => a.id - b.id);

const BY_ID: ReadonlyMap<number, AvatarItem> = new Map(ITEMS.map((i) => [i.id, i]));

/** All ids of the catalog (what the server passes to sanitizeLook). */
export const ITEM_IDS: readonly number[] = ITEMS.map((i) => i.id);

export function getItem(id: number): AvatarItem | undefined {
  return BY_ID.get(id);
}

export function itemsOfSlot(slot: AvatarSlot): AvatarItem[] {
  return ITEMS.filter((i) => i.slot === slot);
}

/** Picture height / width of an item. */
export function itemAr(it: AvatarItem): number {
  return it.ar ?? (it.place[3] * DOLL.height) / (it.place[2] * DOLL.width);
}

/** True when another hat may be stacked on this one. */
export function canCarry(id: number): boolean {
  const it = BY_ID.get(id);
  return it !== undefined && it.slot === 'HEAD' && it.tw !== undefined;
}

/**
 * A look the catalog can draw: unknown ids dropped, slot rules enforced, and the tower cut
 * above the first hat that cannot carry another. Use it on everything that comes from outside.
 */
export function normalizeLook(look: unknown): AvatarLook {
  const l = sanitizeLook(look, ITEM_IDS);
  const stop = l.head.findIndex((id) => !canCarry(id));
  if (stop >= 0) l.head = l.head.slice(0, stop + 1);
  return l;
}

/** True when `id` can go on top of the look's tower right now (the dressing room greys out the rest). */
export function canStack(look: AvatarLook, id: number): boolean {
  if (slotOfId(id) !== 'HEAD' || !BY_ID.has(id) || look.head.includes(id)) return false;
  if (look.head.length === 0) return true;
  if (look.head.length >= AVATAR_MAX_TOWER) return false;
  return look.head.every((h) => canCarry(h));
}

if (AVATAR_BGS.length !== AVATAR_BG_COUNT) throw new Error('avatar: AVATAR_BGS and AVATAR_BG_COUNT disagree');

/**
 * Tap on a shelf item with the catalog's rules (what the dressing room should call):
 * worn -> taken off; a hat goes on top of the tower, or replaces the top hat when the tower is
 * full or the top hat cannot carry; other slots replace what they hold.
 */
export function tapItem(look: AvatarLook, id: number): AvatarLook {
  const l = normalizeLook(look);
  const it = BY_ID.get(id);
  if (it === undefined) return l;
  if (it.slot !== 'HEAD') {
    const field = it.slot === 'EYES' ? 'eyes' : it.slot === 'EARS' ? 'ears' : it.slot === 'FACE' ? 'face' : 'neck';
    l[field] = l[field] === id ? null : id;
    return l;
  }
  if (l.head.includes(id)) {
    l.head = l.head.filter((h) => h !== id);
    return normalizeLook(l);
  }
  const top = l.head[l.head.length - 1];
  if (top !== undefined && (l.head.length >= AVATAR_MAX_TOWER || !canCarry(top))) l.head[l.head.length - 1] = id;
  else l.head.push(id);
  return l;
}
