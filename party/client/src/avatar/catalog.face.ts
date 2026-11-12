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
 *   tw     hats only, optional: { crown, bottom, sink, seat } in fractions of the picture height.
 *          Without it the hat can be worn and can top a tower, but nothing stacks on it.
 *   lines  optional: 1-3 funny Hebrew lines the doll says when it gets this item.
 *   colors / burst / fly / snd / contact  optional hints for the dressing room (see AvatarItem).
 *
 * Example:
 *   { id: 201, slot: 'EYES', name: 'משקפי טייסים', file: '/assets/shimi/props/aviators.png', place: [22, 23.5, 59, 8.6] },
 * For reference: the eyes are near top 27 .. 29.5 (left eye centre x 37, right 65), the nose tip near [51, 33],
 * the mouth near top 37 .. 41. Originals: heart glasses [21.739, 24, 60.248, 8.583], moustache [20.7, 32.75, 62.11, 5.5].
 *
 * Check your work at /avatar-lab.html?view=items and ?view=slots (npx vite, then open the page).
 */
import type { AvatarItem } from './catalog';

export const items: AvatarItem[] = [];
