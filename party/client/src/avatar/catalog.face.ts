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
  aviators: 237 / 640,
  nerd: 241 / 640,
  anaglyph: 190 / 640,
  monocle: 640 / 593,
  patch: 293 / 640,
  stars: 298 / 640,
  nose: 400 / 400,
  blower: 256 / 640,
} as const;

export const items: AvatarItem[] = [
  {
    id: 201, slot: 'EYES', name: 'משקפי טייסים', file: '/assets/shimi/props/201_aviators.png',
    place: [23, 24.1, 58, hOf(58, AR.aviators)], ar: AR.aviators, contact: [51.5, 28],
    fly: 'ninja', snd: 'ping', weight: 0.3, power: 1,
    colors: ['#C9A23A', '#3E4A3C', '#E8D08A'], burst: '#FFD21F',
    lines: [],
  },
  {
    id: 202, slot: 'EYES', name: 'משקפי חנון', file: '/assets/shimi/props/202_nerd_glasses.png',
    place: [21, 23.3, 62, hOf(62, AR.nerd)], ar: AR.nerd, contact: [51.5, 28],
    fly: 'ninja', snd: 'snap', weight: 0.35, power: 1,
    colors: ['#16120E', '#FFFFFF', '#55585F'], burst: '#1E3FD8',
    lines: [],
  },
  {
    id: 203, slot: 'EYES', name: 'משקפי תלת־ממד', file: '/assets/shimi/props/203_3d_glasses.png',
    place: [20.5, 23.55, 62, hOf(62, AR.anaglyph)], ar: AR.anaglyph, contact: [51.5, 28],
    fly: 'frisbee', snd: 'snap', weight: 0.2, power: 1,
    colors: ['#F4F2EE', '#D8262E', '#18A9C9'], burst: '#25C3DF',
    lines: [],
  },
  {
    id: 204, slot: 'EYES', name: 'מונוקל', file: '/assets/shimi/props/204_monocle.png',
    place: [26.8, 23.6, 28, hOf(28, AR.monocle)], ar: AR.monocle, contact: [38, 28],
    fly: 'feather', snd: 'ping', weight: 0.2, power: 0.8,
    colors: ['#C9962E', '#F2D27A', '#FFFFFF'], burst: '#FFD21F',
    lines: [],
  },
  {
    id: 205, slot: 'EYES', name: 'רטייה', file: '/assets/shimi/props/205_eye_patch.png',
    place: [16.2, 19.4, 70.6, hOf(70.6, AR.patch)], ar: AR.patch, contact: [38, 28],
    fly: 'snapback', snd: 'snap', weight: 0.25, power: 1,
    colors: ['#16120E', '#3A3632', '#6B6560'], burst: '#F2361B',
    lines: [],
  },
  {
    id: 206, slot: 'EYES', name: 'משקפי כוכב', file: '/assets/shimi/props/206_star_glasses.png',
    place: [21.5, 22.2, 60, hOf(60, AR.stars)], ar: AR.stars, contact: [51.5, 28],
    fly: 'boomerang', snd: 'boing', weight: 0.3, power: 1,
    colors: ['#D4A93A', '#F5D77A', '#9C7A1E'], burst: '#FFD21F',
    lines: [],
  },
  {
    id: 225, slot: 'FACE', name: 'אף ליצן', file: '/assets/shimi/props/225_clown_nose.png',
    place: [42.5, 28.9, 17, hOf(17, AR.nose)], ar: AR.nose, contact: [51, 32.4],
    fly: 'lob', snd: 'boing', weight: 0.2, power: 1,
    colors: ['#E32B2B', '#B5200A', '#FF8A80'], burst: '#F2361B',
    lines: [],
  },
  {
    id: 226, slot: 'FACE', name: 'משרוקית מסיבה', file: '/assets/shimi/props/226_party_blower.png',
    place: [42, 30.7, 54, hOf(54, AR.blower)], ar: AR.blower, contact: [44, 38.6],
    fly: 'boomerang', snd: 'boing', weight: 0.15, power: 1,
    colors: ['#E8213C', '#F5A623', '#1F6FD0', '#7AA62A'], burst: '#D63DC9',
    lines: [],
  },
];
