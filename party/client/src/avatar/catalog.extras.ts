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
 *   tw     hats only, optional: { crown, bottom, sink, seat } in fractions of the picture height.
 *          Without it the hat can be worn and can top a tower, but nothing stacks on it.
 *   lines  optional: 1-3 funny Hebrew lines the doll says when it gets this item.
 *   colors / burst / fly / snd / contact  optional hints for the dressing room (see AvatarItem).
 *
 * Example:
 *   { id: 325, slot: 'NECK', name: 'שרשרת זהב', file: '/assets/shimi/props/gold_chain.png', place: [27, 45.5, 48, 13] },
 * For reference: the ears are near left 13 .. 22 and 80 .. 89, top 24 .. 35; the chin ends at top 48 and the
 * shoulders start there. Originals: green ears [7.3, 23.98, 87.09, 10.63], headphones [-9.73, -3.58, 122.15, 43.33],
 * pink bow [32.63, 43.96, 38.25, 12.14], lei [20.7, 47.67, 60.04, 27].
 * In the small 'icon' picture only the top of a NECK item shows (the icon ends just under the chin).
 *
 * Check your work at /avatar-lab.html?view=items and ?view=slots (npx vite, then open the page).
 */
import type { AvatarItem } from './catalog';

export const items: AvatarItem[] = [];
