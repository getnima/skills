/**
 * Extra ear and neck accessories (EARS and NECK slots). One artist owns this file.
 *
 * Id range of this file: 301-324 = EARS (earrings, ears, headphones, things behind the ear), 325-349 = NECK (ties, scarves, chains, medals).
 * The id decides the slot (shared/avatar.ts, slotOfId); an item whose id is outside the range,
 * whose slot does not match its id, or whose id is already taken is skipped with a console warning
 * and fails tests/unit/avatar.test.ts.
 *
 * Per item provide (type AvatarItem, documented in ./catalog.ts):
 *   id     a free number in the range above. Never reuse or renumber an id: looks are saved by id.
 *   slot   'EARS' for 301-324, 'NECK' for 325-349. One item per slot is worn at a time. EARS are drawn under hats and glasses; NECK is drawn over everything.
 *   name   short Hebrew name, shown under the picture in the dressing room.
 *   file   '/assets/shimi/props/<name>.png' (the file goes in client/public/assets/shimi/props/).
 *          Transparent PNG, cropped tight to the object, long side 300-600 px, under about 250 KB.
 *   place  [left, top, width, height] in % of the doll box (doll.png, 483 x 1200): where the picture
 *          sits on the bare doll. width / height must keep the picture's own proportions:
 *          height% = width% * (pictureHeight / pictureWidth) * 483 / 1200.
 *   lines  optional: 1-3 funny Hebrew lines the doll says when it gets this item.
 *   colors / burst / fly / snd / contact  optional hints for the dressing room (see AvatarItem).
 *
 * For reference: the ears are near left 13 .. 22 and 80 .. 89, top 24 .. 35; the chin ends at top 48 and the
 * shoulders start there. Originals: green ears [7.3, 23.98, 87.09, 10.63], headphones [-9.73, -3.58, 122.15, 43.33],
 * pink bow [32.63, 43.96, 38.25, 12.14], lei [20.7, 47.67, 60.04, 27].
 * In the small 'icon' picture only the top of a NECK item shows (the icon ends just under the chin).
 *
 * The pictures (props/3xx_*.png) are generated product photos (Higgsfield, nano_banana_2_1), cut out
 * locally (tests/e2e/avatar-extras-cut.py; fuzzy feathers: tests/e2e/avatar-extras-key.py). A thing worn on
 * one side only (a flower behind the ear, a phone at the ear) is padded with transparent space to the
 * width of the head, so its box stays centred on the doll like the originals' pair of green ears.
 * Lines follow design/punchlines.he.md.
 * Check your work at /avatar-lab.html?view=items and ?view=slots (npx vite, then open the page).
 */
import type { AvatarItem } from './catalog';

/** height% of the doll box for a picture of `ar` (height / width) placed `w`% wide. */
const hOf = (w: number, ar: number): number => Math.round(w * ar * (483 / 1200) * 100) / 100;

/** Picture height / width of each file (the PNG's own pixel size). */
const AR = {
  bunny: 640 / 313,
  hoops: 228 / 640,
  hibiscus: 169 / 640,
  phone: 453 / 640,
  chain: 640 / 480,
  boa: 637 / 593,
  scarf: 640 / 369,
  medal: 640 / 558,
  tie: 640 / 139,
  bandana: 634 / 640,
} as const;

export const items: AvatarItem[] = [
  {
    // the picture's lower half is transparent padding: the box reaches the ear zone, the ears stand on the hair
    id: 301, slot: 'EARS', name: 'אוזני ארנב', file: '/assets/shimi/props/301_bunny_ears.png',
    place: [29, -12.5, 44, hOf(44, AR.bunny)], ar: AR.bunny, contact: [51, 3],
  },
  {
    id: 302, slot: 'EARS', name: 'חישוקי זהב', file: '/assets/shimi/props/302_gold_hoops.png',
    place: [11, 33.5, 80, hOf(80, AR.hoops)], ar: AR.hoops, contact: [51, 34],
  },
  {
    // one flower over the doll's left ear; the rest of the picture is transparent so the box stays centred
    id: 303, slot: 'EARS', name: 'פרח מאחורי האוזן', file: '/assets/shimi/props/303_hibiscus.png',
    place: [5, 20, 92, hOf(92, AR.hibiscus)], ar: AR.hibiscus, contact: [85, 24],
  },
  {
    // a handset at the doll's right ear, tilted towards the mouth; padded to the right like the flower
    id: 304, slot: 'EARS', name: 'שפופרת', file: '/assets/shimi/props/304_phone_handset.png',
    place: [3, 22.5, 96, hOf(96, AR.phone)], ar: AR.phone, contact: [17, 30],
  },
  {
    id: 325, slot: 'NECK', name: 'שרשרת זהב', file: '/assets/shimi/props/325_gold_chain.png',
    place: [29.5, 45, 43, hOf(43, AR.chain)], ar: AR.chain, contact: [51, 48],
  },
  {
    id: 326, slot: 'NECK', name: 'בואה', file: '/assets/shimi/props/326_feather_boa.png',
    place: [20, 44, 62, hOf(62, AR.boa)], ar: AR.boa, contact: [51, 48],
  },
  {
    id: 327, slot: 'NECK', name: 'צעיף אוהדים', file: '/assets/shimi/props/327_fan_scarf.png',
    place: [22, 42.5, 58, hOf(58, AR.scarf)], ar: AR.scarf, contact: [51, 48],
  },
  {
    id: 328, slot: 'NECK', name: 'מדליית זהב', file: '/assets/shimi/props/328_medal.png',
    place: [31, 46, 40, hOf(40, AR.medal)], ar: AR.medal, contact: [51, 48],
  },
  {
    id: 329, slot: 'NECK', name: 'עניבה', file: '/assets/shimi/props/329_striped_tie.png',
    place: [45, 45.5, 12, hOf(12, AR.tie)], ar: AR.tie, contact: [51, 48],
  },
  {
    id: 330, slot: 'NECK', name: 'בנדנה', file: '/assets/shimi/props/330_bandana.png',
    place: [25.5, 44, 51, hOf(51, AR.bandana)], ar: AR.bandana, contact: [51, 48],
  },
];
