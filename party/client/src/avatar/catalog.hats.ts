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
 * Example:
 *   { id: 101, slot: 'HEAD', name: 'כובע שף', file: '/assets/shimi/props/chef_hat.png',
 *     place: [14, -16, 74, 30], tw: { crown: 0.05, bottom: 0.97, sink: 0.12, seat: 0.35 },
 *     lines: ['שף! מה מבשלים? צרות.'] },
 * For reference the bare head spans about left 13 .. 89, top 0 .. 48; the hairline is near top 8 and
 * the originals sit like this: top hat [9.52, -10.67, 84.47, 29.83], backwards cap [24.02, -3.81, 55.11, 19.34].
 * tw: crown = empty space above the hat's top, bottom = where its brim / lower edge is,
 * sink = how deep the next hat sinks into it, seat = where the head enters it.
 *
 * Check your work at /avatar-lab.html?view=items and ?view=slots (npx vite, then open the page).
 */
import type { AvatarItem } from './catalog';

export const items: AvatarItem[] = [];
