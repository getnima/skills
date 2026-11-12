# Avatars: every guest dresses their own Shimi

A guest dresses the doll on the phone's waiting screen; the dressed head is their icon in the lobby,
on the TV scoreboard, in results and on the podium. A look is a tiny string, so it costs nothing to send.

Try it: `npx vite`, then `/avatar-lab.html` (`?view=items | slots | wall | proof | room`, `&seed=7`, `&n=60`).

## The pieces

| File | What | Who may import it |
| --- | --- | --- |
| `shared/avatar.ts` | `AvatarLook`, encode / decode, sanitize, random looks, id -> slot. No DOM. | server, phone, TV |
| `catalog.ts` | Every accessory (1-17 from the owner's page + the part files), doll geometry, the 12 plates. Plain data. | anyone (tests too) |
| `catalog.hats.ts` `catalog.face.ts` `catalog.extras.ts` | Extra accessories, one file per artist. | only `catalog.ts` |
| `layout.ts` | Where each worn item sits (doll pixels), the hat tower, the square frame of a crop. No DOM. | compositor, dressing room |
| `compose.ts` | Loads pictures once, draws a look, caches pictures and URLs. | TV, phone, games |
| `Avatar.tsx` + `avatar.css` | `<Avatar />` and `useAvatarUrl`. | TV, phone |
| `room-contract.ts` | Props of the dressing room component. | dressing room, its hosts |
| `index.ts` | Everything above from one import. | client code |
| `lab.tsx`, `lab.css`, `../../avatar-lab.html` | The lab page. | nobody |

## API

### Server (`shared/avatar.ts`)

```ts
interface AvatarLook { head: number[]; eyes: number | null; ears: number | null; face: number | null; neck: number | null; bg: number }
encodeLook(look: AvatarLook): string                      // "1.8.8-17.9.0.11.7", at most 32 chars, only [0-9.-]
decodeLook(text: unknown, knownIds?: Iterable<number>): AvatarLook   // never throws; garbage -> the default look
sanitizeLook(input: unknown, knownIds?: Iterable<number>): AvatarLook // never throws; always a valid look
randomLook(seed: number, ids?: Iterable<number>): AvatarLook         // deterministic; default ids = the 17 originals
seedFromText(text: string): number                        // e.g. randomLook(seedFromText(playerId))
lookKey(look: AvatarLook | string): string                // cache key (= the encoded string)
slotOfId(id: number): AvatarSlot | null
DEFAULT_LOOK, defaultLook(), AVATAR_SLOTS, AVATAR_BG_COUNT (12), AVATAR_MAX_TOWER (3), AVATAR_BASE_IDS, AVATAR_ID_RANGES
wearItem / removeItem / toggleItem / shakeOff / isWearing / wornIds / looksEqual / toLook
```

Suggested wiring: the phone sends the encoded string; the server stores `encodeLook(decodeLook(text))`
(that is all the validation needed: the result is always valid, at most 32 characters, and ids that
cannot exist are gone) and puts the string on the player's public record. Without `knownIds` every id
of the base table and of the extra ranges (101-149, 201-249, 301-349) is accepted; a client that has
no picture for an id simply does not draw it. To be strict, pass the catalog's list
(`import { ITEM_IDS } from 'client/src/avatar/catalog'`: plain data, safe in node). A guest who never
opens the dressing room can get `encodeLook(randomLook(seedFromText(playerId)))`.

Encoding, version 1: `"<1>.<bg>.<hats, bottom first, joined by '-', or 0>.<eyes>.<ears>.<face>.<neck>"`, 0 = nothing.

- bare doll on the yellow plate: `1.0.0.0.0.0.0`
- crown with a party hat on it, heart glasses, moustache, pink bow, sunburst plate: `1.8.8-17.9.0.11.7`

### TV and phone

```tsx
import { Avatar } from '../avatar';      // or '../avatar/Avatar'
<Avatar look={player.look} size={40} />                 // look: AvatarLook | encoded string | null
<Avatar look={look} size={96} ring label={player.name} />   // ink ring + hard shadow; label = accessible name
<Avatar look={look} size={220} crop="bust" />           // 'icon' (default) | 'bust' | 'full'
```

`<Avatar>` is a fixed square `<span class="av">` in the plate's colour (so nothing shifts) with an
`<img>` inside once the picture exists; a changed look keeps the old picture until the new one is
ready. `size` is CSS px. Props: `look, size, crop?, ring?, round?, class?, label?`. The corners are
rounded 24%; `round` makes a circle (hat tips in the corners get cut). The dark plates (7 night,
11 stars) vanish on a dark panel: use `ring` there.

```ts
useAvatarUrl(look, size, crop = 'icon'): string | null   // for your own <img> / CSS background; held while mounted
avatarUrl(look, size, crop = 'icon'): Promise<string>     // never rejects; do not store the URL, ask again
peekAvatarUrl(look, size, crop): string | null
holdAvatarUrl(look, size, crop): () => void               // keep a URL alive outside Preact
preloadAvatarAssets(): Promise<void>                      // all pictures (about 4 MB); call it on the TV at start
avatarCacheStats(), clearAvatarCache()
```

### Games

```ts
avatarCanvas(look, size, { crop?: 'icon' | 'bust' | 'full', plate?: boolean, outline?: boolean }): Promise<HTMLCanvasElement>
// exactly size x size device px; plate: false = cut-out doll on transparent (a sprite). Never rejects.
avatarBitmap(look, cssSize, crop?): Promise<HTMLCanvasElement>   // the shared cached canvas (bucket size). Do not draw on it.
composeAvatar(look, { size, crop?, plate?, outline? }): HTMLCanvasElement  // sync, with the pictures loaded so far
```

Load sprites before the round starts (`await avatarCanvas(...)` in the game's setup), never inside `update`.

### Dressing room (`dressing.tsx`, a teammate's file)

`export function DressingRoom(props: DressingRoomProps)` (see `room-contract.ts`): controlled,
`look` in, `onChange(look)` out, optional `onDone`, `name`. Helpers made for it:

- `tapItem(look, id)` (catalog rules: toggle; hats stack, the top one is replaced when the tower is full), `shakeOff(look)`, `canStack(look, id)`, `normalizeLook(anything)`.
- `ITEMS`, `itemsOfSlot(slot)`, `getItem(id)` with `name`, `lines`, `colors`, `burst`, `fly`, `snd`, `contact`, `weight`, `power` (the source page's flight / sound / squash hints), `AVATAR_BGS`, `plateColor(bg)`, `drawPlate(ctx, bg, size)`.
- `layoutLook(look)` gives every worn item's box in doll pixels in paint order (tower included), for a live DOM doll: `left = x / 483 * 100 %`, `top = y / 1200 * 100 %` of a box with the doll's proportions. `DOLL` has the source page's head / body clip polygons and the bobblehead pivot.
- The lab mounts the room at `/avatar-lab.html?view=room` (`&look=1.8.8-17.9.0.11.7`).

## How a picture is made

1. `normalizeLook`: unknown ids out, slot rules, tower cut above a hat that cannot carry.
2. `layoutLook`: paint order is the source page's DOM order: doll, EARS, FACE, EYES, the worn hat,
   the tower hats bottom to top, NECK. A worn item sits at its `place` (% of the 483 x 1200 doll box).
   Tower hat number `level` (0 = first above the worn hat) is `place.width * 0.93^(level+1)` wide; its
   `tw.bottom` line sits on the anchor; the anchor starts at the worn hat's top + `(crown + sink)` of
   its height, on its centre line, and moves up by `(bottom - crown - sink)` of each stacked hat.
   That is the source page's tower at rest.
3. `frameLook(look, crop)`: the square that is shown.
   - It must contain the doll part of the crop (`icon`: the head box, down to the chin at 48.6% of the
     doll, or 53% when something is on the neck so a bow tie shows; `bust`: down to 63%; `full`: all)
     and every worn item with the whole tower (neck items do not stretch `icon` / `bust`: they are cut
     by the bottom edge).
   - It is centred on the doll's centre line (x = 51%), so the face is always in the middle even when
     a hat sticks out to one side; vertically it is centred on the content.
   - Its side is the larger of the content's width (twice the wider half) and height, plus a 5% margin
     on each side: the smallest square that fits, so the face is as big as the look allows.
     Bare head: the head is 57% of the icon's width (it is taller than wide and fills the height).
     Worst cases: one hat 42% (viking helmet), two hats 30%, three hats 24%: the price of showing the whole pile.
4. `compose`: plate, then the doll and the items on a layer of their own, a sticker outline (the
   layer's silhouette stamped around itself in ink, or paper on the dark plates), then the layer.
   Small sizes draw from half-size copies of the pictures (made once, at load), so a 28 px icon is smooth.
5. Cache: pictures are made at 48 / 96 / 192 / 384 device px (the first that covers `size x devicePixelRatio`),
   keyed by `lookKey | bucket | crop`, least recently used out (600 pictures or 48 MB). A URL is an
   object URL of an uncompressed BMP of that picture (no PNG encode / decode), at most 300 kept,
   revoked when evicted unless an `<Avatar>` / `useAvatarUrl` / `holdAvatarUrl` holds it. Composing is
   spread over 8 ms slices and results are handed out in batches, so a lobby of 60 never freezes the TV.
6. Failure: a missing accessory picture is skipped (the look is drawn without it, not cached, and
   tried again after 8 s); without `doll.png` a plain paper head stands in. Nothing throws.

## Adding an accessory picture by hand

1. Make a transparent PNG cropped tight to the object, long side 300-600 px, and put it in
   `client/public/assets/shimi/props/`.
2. Pick the part file and a free id: hats `catalog.hats.ts` 101-149; `catalog.face.ts` 201-224 EYES,
   225-249 FACE; `catalog.extras.ts` 301-324 EARS, 325-349 NECK. The id decides the slot. Never reuse
   or renumber an id (saved looks hold ids).
3. Add `{ id, slot, name, file, place }` to the file's `items`. `place = [left, top, width, height]`
   in % of the doll box. Choose `left, top, width`, then `height = width * (pictureHeight / pictureWidth) * 483 / 1200`
   so the picture is not squashed. Reference points on the bare doll: head 13..89.5 wide, top 0.3,
   chin 48; hairline about 8; eyes about 28 (centres x 38 and 66); nose tip [51, 33]; mouth 37..41;
   ears 13..22 and 80..89 at 24..35; the originals' numbers are in `catalog.ts`.
4. A hat that may carry another hat gets `tw: { crown, bottom, sink, seat }` (fractions of the
   picture height: empty space above the hat, where its brim is, how deep the next hat sinks in,
   where the head enters). No `tw` = it can only be the top of a tower.
5. Optional: `lines` (1-3 Hebrew lines), `colors`, `burst`, `fly`, `snd`, `contact`.
6. Look at it: `/avatar-lab.html?view=items` and `?view=slots`; then `npx vitest run tests/unit/avatar.test.ts`
   (file exists, proportions match, slot matches id, the item sits where its slot means, towers stack).
   A bad item is skipped with a console warning and listed at the top of the lab.

Credits for the original accessory photos are in `client/public/assets/shimi/README.md`; keep them in the app's credits.
