/**
 * Extra hats (HEAD slot). One artist owns this file.
 *
 * Id range of this file: 101-149, all HEAD.
 * The id decides the slot (shared/avatar.ts, slotOfId); an item whose id is outside the range,
 * whose slot does not match its id, or whose id is already taken is skipped with a console warning
 * and fails tests/unit/avatar.test.ts.
 *
 * Per item provide (type AvatarItem, documented in ./catalog.ts):
 *   id     a free number in the range above. Never reuse or renumber an id: looks are saved by id.
 *   slot   'HEAD'.
 *   name   short Hebrew name, shown under the picture in the dressing room.
 *   file   '/assets/shimi/props/<name>.png' (the file goes in client/public/assets/shimi/props/).
 *          Transparent PNG, cropped tight to the object, long side 300-600 px, under about 250 KB.
 *   place  [left, top, width, height] in % of the doll box (doll.png, 483 x 1200): where the picture
 *          sits on the bare doll. width / height must keep the picture's own proportions:
 *          height% = width% * (pictureHeight / pictureWidth) * 483 / 1200.
 *   tw     hats only, optional: { crown, bottom, sink, seat } in fractions of the picture height.
 *          Without it the hat can be worn and can top a tower, but nothing stacks on it.
 *   lines  optional: 1-3 funny Hebrew lines the doll says when it gets this item.
 *   colors / burst / fly / snd / contact  optional hints for the dressing room (see AvatarItem).
 *
 * For reference the bare head spans about left 13 .. 89, top 0 .. 48; the hairline is near top 8 and
 * the originals sit like this: top hat [9.52, -10.67, 84.47, 29.83], backwards cap [24.02, -3.81, 55.11, 19.34].
 * tw: crown = empty space above the hat's top, bottom = where its brim / lower edge is,
 * sink = how deep the next hat sinks into it, seat = where the head enters it.
 *
 * Check your work at /avatar-lab.html?view=items and ?view=slots (npx vite, then open the page).
 *
 * The pictures (props/1xx_*.png) are generated product photos (Higgsfield, nano_banana_2_1), cut out
 * locally (tests/e2e/avatar-hats-cut.py) or with Higgsfield's background remover where the object
 * was too pale for a flood fill. Lines follow design/punchlines.he.md.
 */
import type { AvatarItem } from './catalog';

/** height% of the doll box for a picture of `ar` (height / width) placed `w`% wide. */
const hOf = (w: number, ar: number): number => Math.round(w * ar * (483 / 1200) * 100) / 100;

/** Picture height / width of each file (the PNG's own pixel size). */
const AR = {
  halo: 311 / 480,
  horns: 315 / 480,
  chef: 450 / 480,
  cowboy: 289 / 480,
  grad: 395 / 480,
  wizard: 476 / 480,
  beanie: 480 / 345,
  fez: 455 / 480,
  flowers: 303 / 480,
  melon: 348 / 480,
  propeller: 371 / 480,
  cone: 480 / 281,
} as const;

export const items: AvatarItem[] = [
  {
    id: 101, slot: 'HEAD', name: 'הילה', file: '/assets/shimi/props/101_halo.png',
    place: [16, -10, 70, hOf(70, AR.halo)], ar: AR.halo, contact: [51, 2],
    fly: 'feather', snd: 'ping', weight: 0.15, power: 0.8,
    colors: ['#E3B53A', '#FFE45A', '#9C7A1E'], burst: '#FFE45A',
    lines: [
      'סוני אנג׳ל. גרסת אספנים, בלי קופסה.',
      'קדוש מקומי. עולים אליי לרגל מקריית אונו.',
      'מלאך שומר. משמרת לילה בחניון עזריאלי.',
    ],
  },
  {
    id: 102, slot: 'HEAD', name: 'קרני שטן', file: '/assets/shimi/props/102_devil_horns.png',
    place: [13, -6, 76, hOf(76, AR.horns)], ar: AR.horns, contact: [51, 6],
    fly: 'boomerang', snd: 'snap', weight: 0.3, power: 1,
    colors: ['#E0141B', '#FF5A4F', '#9E0B10'], burst: '#F2361B',
    lines: [
      'שטן קטן. אמא קוראת לזה אופי.',
      'סוכן ביטוח. אני כתבתי את האותיות הקטנות.',
      'פקח חניה ברמת גן. כל דוח בשבילי שיר.',
    ],
  },
  {
    id: 103, slot: 'HEAD', name: 'כובע שף', file: '/assets/shimi/props/103_chef_hat.png',
    place: [0, -18, 102, hOf(102, AR.chef)], ar: AR.chef, contact: [51, 14],
    tw: { crown: 0.02, bottom: 0.98, sink: 0.12, seat: 0.62 },
    fly: 'lob', snd: 'fwump', weight: 0.3, power: 1,
    colors: ['#FFFFFF', '#E4E4E4', '#BDBDBD'], burst: '#FF9F0A',
    lines: [
      'מאסטר שף. השופטים בכו. מהבצל.',
      'שף. הכוכב מישלן שלי מגנט על המקרר.',
      'שף. פתחתי ביסטרו בפלורנטין. שולחן אחד, תור עד יפו.',
    ],
  },
  {
    id: 104, slot: 'HEAD', name: 'כובע בוקרים', file: '/assets/shimi/props/104_cowboy_hat.png',
    place: [-11.5, -9, 125, hOf(125, AR.cowboy)], ar: AR.cowboy, contact: [51, 14],
    tw: { crown: 0.02, bottom: 0.98, sink: 0.12, seat: 0.66 },
    fly: 'frisbee', snd: 'fwump', weight: 0.5, power: 1.2,
    colors: ['#5A3420', '#7A4A30', '#2B1A10'], burst: '#FF9F0A',
    lines: [
      'שריף של גדרה. העיר הזאת קטנה על שנינו.',
      'בוקר. העדר שלי: שלושה חתולים מהחצר.',
      'רוכב מקצועי. רכבתי על הסוס בלונה פארק.',
    ],
  },
  {
    id: 105, slot: 'HEAD', name: 'כובע סיום', file: '/assets/shimi/props/105_graduation_cap.png',
    place: [-10, -14.7, 122, hOf(122, AR.grad)], ar: AR.grad, contact: [51, 12],
    tw: { crown: 0.12, bottom: 0.8, sink: 0.1, seat: 0.55 },
    fly: 'frisbee', snd: 'snap', weight: 0.35, power: 1,
    colors: ['#16120E', '#3A3A3A', '#E8A92A'], burst: '#FFD21F',
    lines: [
      'דוקטור לפילוסופיה. מהאוניברסיטה הפתוחה.',
      'בוגר מצטיין. של קורס בזום מאילת.',
      'פרופסור. מרצה בכל ארוחת שישי. אף אחד לא שאל.',
    ],
  },
  {
    id: 106, slot: 'HEAD', name: 'כובע קוסם', file: '/assets/shimi/props/106_wizard_hat.png',
    place: [-5, -23.4, 112, hOf(112, AR.wizard)], ar: AR.wizard, contact: [51, 15],
    fly: 'feather', snd: 'ping', weight: 0.3, power: 1,
    colors: ['#1E2F9E', '#2B44C8', '#E2C27A'], burst: '#4F6CFF',
    lines: [
      'קוסם. הופ, מצאתי חניה בדיזנגוף.',
      'מכשף. הפכתי מים לסודה. עם סודהסטרים.',
      'גנדלף. בחוג לגיל הרך במתנ״ס.',
    ],
  },
  {
    id: 107, slot: 'HEAD', name: 'כובע גרב', file: '/assets/shimi/props/107_pompom_beanie.png',
    place: [12, -21.7, 78, hOf(78, AR.beanie)], ar: AR.beanie, contact: [51, 12],
    tw: { crown: 0.0, bottom: 0.98, sink: 0.22, seat: 0.55 },
    fly: 'lob', snd: 'soft', weight: 0.25, power: 1,
    colors: ['#C8191E', '#E23A2E', '#F4EEDF'], burst: '#F2361B',
    lines: [
      'נחתתי מסקי בבנסקו. השלג עוד לא נחת.',
      'מעיל, צעיף, כובע. בחוץ עשרים ושש מעלות.',
      'מדריך סקי. בחרמון, ביום שפתוח.',
    ],
  },
  {
    id: 108, slot: 'HEAD', name: 'תרבוש', file: '/assets/shimi/props/108_fez.png',
    place: [21, -6.9, 60, hOf(60, AR.fez)], ar: AR.fez, contact: [51, 10],
    tw: { crown: 0.03, bottom: 0.97, sink: 0.07, seat: 0.5 },
    fly: 'snapback', snd: 'boing', weight: 0.35, power: 1,
    colors: ['#C21F26', '#9E161C', '#16120E'], burst: '#FF9F0A',
    lines: [
      'פקיד בכיר. מהמנדט, עם קביעות.',
      'מלצר בבית קפה ביפו. ההזמנה שלכם אצלי בראש.',
      'מארח בשוק הפשפשים. הכול עתיק, חוץ ממני.',
    ],
  },
  {
    id: 109, slot: 'HEAD', name: 'זר פרחים', file: '/assets/shimi/props/109_flower_crown.png',
    place: [8, 1.9, 86, hOf(86, AR.flowers)], ar: AR.flowers, contact: [51, 10],
    tw: { crown: 0.0, bottom: 0.95, sink: 0.42, seat: 0.5 },
    fly: 'feather', snd: 'soft', weight: 0.2, power: 0.9,
    colors: ['#E8508A', '#F7D21E', '#F26A1B', '#3E7A2A'], burst: '#FF7EB6',
    lines: [
      'מלכת שבועות. של גן ילדים פרחי הגליל.',
      'כלה בכנרת. החתן: גם אני.',
      'פסטיבל באינדינגב. שלושה ימים, אפס מקלחות.',
    ],
  },
  {
    id: 110, slot: 'HEAD', name: 'קסדת אבטיח', file: '/assets/shimi/props/110_watermelon_helmet.png',
    place: [6, -6.3, 90, hOf(90, AR.melon)], ar: AR.melon, contact: [51, 12],
    tw: { crown: 0.0, bottom: 0.97, sink: 0.1, seat: 0.6 },
    fly: 'lob', snd: 'thud', weight: 0.8, power: 1.3,
    colors: ['#2E6B2A', '#9BC46A', '#E0424B'], burst: '#3CC85A',
    lines: [
      'מלך הקיץ. ממלכה: בסטה ליד חוף גורדון.',
      'אבטיח עם בולגרית. אני הבולגרית.',
      'קסדה אורגנית. התו תקן: מהשוק בכרמל.',
    ],
  },
  {
    id: 111, slot: 'HEAD', name: 'כובע פרופלור', file: '/assets/shimi/props/111_propeller_cap.png',
    place: [11, -6.5, 80, hOf(80, AR.propeller)], ar: AR.propeller, contact: [51, 10],
    fly: 'boomerang', snd: 'boing', weight: 0.25, power: 1,
    colors: ['#E8232A', '#F7D21E', '#1F44B8', '#1E8A4C'], burst: '#25C3DF',
    lines: [
      'טייס קרבי. בטיסנים של פארק הירקון.',
      'מהנדס בנאס״א. שלוחת חולון.',
      'גאון. בגיל שש פירקתי את הטוסטר של סבתא.',
    ],
  },
  {
    id: 112, slot: 'HEAD', name: 'קונוס', file: '/assets/shimi/props/112_traffic_cone.png',
    place: [23, -25.3, 56, hOf(56, AR.cone)], ar: AR.cone, contact: [51, 12],
    fly: 'cannon', snd: 'thud', weight: 0.6, power: 1.3,
    colors: ['#FF6A13', '#FF8A3D', '#ECECEC'], burst: '#FF9F0A',
    lines: [
      'נתיבי איילון. סוגר נתיב מתי שבא לי.',
      'הרכבת הקלה. אני בדרך, מאז 2011.',
      'קונוס. בשיפוצים אני הכוכב.',
    ],
  },
];
