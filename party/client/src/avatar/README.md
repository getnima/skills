# Avatars: every guest dresses their own Shimi

A guest dresses the doll on the phone's waiting screen; the dressed head is their icon in the lobby,
on the TV scoreboard, in results and on the podium. A look is a tiny string, so it costs nothing to send.

Try it: `npx vite`, then `/avatar-lab.html` (`?view=items | slots | wall | proof | room`, `&seed=7`, `&n=60`).

## The pieces

| File | What | Who may import it |
| --- | --- | --- |
| `shared/avatar.ts` | `AvatarLook`, encode / decode, sanitize, random looks, id -> slot. No DOM. | server, phone, TV |
| `catalog.ts` | Every accessory (1-17 from the owner's page + the part files), doll geometry, the 12 plates, the doll's lines (`COMBOS`, `GENERIC_LINES`, `linesFor`). Plain data. | anyone (tests too) |
| `catalog.hats.ts` `catalog.face.ts` `catalog.extras.ts` | Extra accessories, one file per artist. | only `catalog.ts` |
| `layout.ts` | Where each worn item sits (doll pixels), the hat tower, the square frame of a crop. No DOM. | compositor, dressing room |
| `compose.ts` | Loads pictures once, draws a look, caches pictures and URLs. | TV, phone, games |
| `Avatar.tsx` + `avatar.css` | `<Avatar />` and `useAvatarUrl`. | TV, phone |
| `room-contract.ts` | Props of the dressing room component. | dressing room, its hosts |
| `dressing.tsx` + `dressing.css`, `dressing-stage / -thumbs / -fx / -voice / -mount.ts` | The dressing room. Lazy: `import('../avatar/dressing')`, never from `index.ts`. | the phone waiting screen |
| `art-src/*.png` | PNG sources of the 34 new accessories (not shipped). `tests/e2e/avatar-review-webp.py` builds the shipped WebP files from them and from the owner's 17 PNGs. | nobody |
| `index.ts` | Everything above from one import. | client code |
| `lab.tsx`, `lab.css`, `../../avatar-lab.html` | The lab page. | nobody |

## API

### Server (`shared/avatar.ts`)

```ts
interface AvatarLook { head: number[]; eyes: number | null; ears: number | null; face: number | null; neck: number | null; bg: number }
encodeLook(look: AvatarLook): string                      // "1.8.8-17.9.0.11.7", at most 32 chars, only [0-9.-]
decodeLook(text: unknown, knownIds?: Iterable<number>): AvatarLook   // never throws; garbage -> the default look
sanitizeLook(input: unknown, knownIds?: Iterable<number>): AvatarLook // never throws; always a valid look
randomLook(seed: number, ids?: Iterable<number>): AvatarLook         // deterministic; default ids = the 17 originals; always 2+ accessories
randomLookAvoiding(seed, taken: Iterable<AvatarLook | string>, ids?): AvatarLook  // same, but a doll nobody in `taken` wears
lookSignature(look): string                               // the look without its plate (same signature = same doll)
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
opens the dressing room gets `encodeLook(randomLookAvoiding(seedFromText(playerId), looksOfTheOthers, ITEM_IDS))`.

How alike are random guests (measured, 200 rooms of 60, the 51-item catalog, `npx tsx tests/e2e/avatar-review-distinct.ts`):
`randomLook` alone gives 6 to 14 pairs of identical icons in all 200 rooms together (it was 92 before every look
was topped up to two accessories) and no bare doll; `randomLookAvoiding` gives 0 guests sharing a doll, plate ignored.

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
preloadAvatarAssets(): Promise<void>                      // all 52 pictures (2.05 MB: 51 WebP accessories 1.61 MB + doll.png); call it on the TV at start
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

### Dressing room (`dressing.tsx`)

```tsx
const { DressingRoom } = await import('../avatar/dressing');     // lazy: 14 KB gzip of code + 4.5 KB of CSS
<DressingRoom look={look} name={player.name} compact onChange={(l) => send(encodeLook(l))} onDone={(l) => close()} />
```

Props (`DressingRoomFullProps` = `room-contract.ts` + `compact`):

- `look`: the room keeps its own copy. A look from outside that differs replaces it; an echo of a look the room
  itself reported in its last 5 reports is ignored, so a late server echo never undoes a tap.
- `onChange(look)`: 400 ms after the last change, and at once on done, on unmount and when the tab is hidden.
- `onDone(look)`: the "מוכן!" button, after `onChange` was flushed.
- `name`: on the stage sticker and the speech box tab.
- `compact`: no top bar (the live icon chip floats on the stage). Also switches on by itself under 540 px of height.

The room fills 100% of its parent and never scrolls: give it a parent with a definite height. Smallest heights:
400 px compact, 500 px normal (`DRESSING_MIN_HEIGHT`); comfortable from 480 compact / 560 normal. Tall stages
(about 600 px and up) show the whole doll on the cobalt disc, shorter ones head and shoulders. It plays the kit's
sfx and haptics itself, locks its own gestures, and honours `prefers-reduced-motion`.
`mountDressingRoom(el, props)` (`dressing-mount.ts`) mounts it from plain JS and returns `{ update, unmount }`.
`window.__dressingRoom` exposes its state for tests.

What the doll says (all text is in `catalog*.ts` and `dressing-voice.ts`; the owner's guide is
`design/punchlines.he.md`; the full list for veto is written by `npx tsx tests/e2e/avatar-review-lines.ts`):

- `linesFor(look, id)`: the lines for the item that just landed. A combination that this item completes wins
  (`COMBOS`: 12 pairs of items, plus three states: three hats, a bare doll after a shake, something in every slot);
  else the item's own 2-3 lines, taking turns; else `GENERIC_LINES`.
- `comboFor(look, added?)`: the combination itself, or null. To add one, append `{ ids: [a, b], lines: [...] }` to `COMBOS`.

Helpers the room uses, free for anyone: `tapItem(look, id)` (toggle; hats stack, the top one is replaced when the
tower is full), `shakeOff(look)`, `canStack(look, id)`, `normalizeLook(anything)`, `layoutLook(look)` (every worn
item's box in doll pixels, in paint order), `DOLL` (clip polygons, the bobblehead pivot).

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
     doll, or 55% when something is on the neck so a bow tie or a chain shows; `bust`: down to 63%; `full`: all)
     and every worn item with the whole tower (neck items do not stretch `icon` / `bust`: they are cut
     by the bottom edge).
   - It is centred on the doll's centre line (x = 51%), so the face is always in the middle even when
     a hat sticks out to one side; vertically it is centred on the content.
   - Its side is the larger of the content's width (twice the wider half) and height, plus a 5% margin
     on each side: the smallest square that fits, so the face is as big as the look allows.
     Bare head: the head is 57% of the icon's width (it is taller than wide and fills the height).
   - In `icon` the face is the main thing: the head is never narrower than 36% of the picture
     (`ICON_MIN_HEAD`). Every single hat fits whole (the tallest, the traffic cone, leaves 37.5%); a tower of
     two or three keeps the chin where it is and grows out of the top edge. `bust` and `full` always show
     the whole tower.
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

1. Make a transparent PNG cropped tight to the object, long side 300-640 px, put it in
   `client/src/avatar/art-src/` as `<id>_<name>.png` and run `python3 -I tests/e2e/avatar-review-webp.py`:
   it writes `client/public/assets/shimi/props/<id>_<name>.webp` (quality 86, lossless alpha, never more
   pixels than 1.5x the picture's width on the doll). Only WebP files ship; a unit test fails on anything
   else in `props/` and on a file over 130 KB.
2. Pick the part file and a free id: hats `catalog.hats.ts` 101-149; `catalog.face.ts` 201-224 EYES,
   225-249 FACE; `catalog.extras.ts` 301-324 EARS, 325-349 NECK. The id decides the slot. Never reuse
   or renumber an id (saved looks hold ids).
3. Add `{ id, slot, name, file: '/assets/shimi/props/<id>_<name>.webp', place }` to the file's `items`. `place = [left, top, width, height]`
   in % of the doll box. Choose `left, top, width`, then `height = width * (pictureHeight / pictureWidth) * 483 / 1200`
   so the picture is not squashed. Reference points on the bare doll: head 13..89.5 wide, top 0.3,
   chin 48; hairline about 8; eyes about 28 (centres x 38 and 66); nose tip [51, 33]; mouth 37..41;
   ears 13..22 and 80..89 at 24..35; the originals' numbers are in `catalog.ts`.
4. A hat that may carry another hat gets `tw: { crown, bottom, sink, seat }` (fractions of the
   picture height: empty space above the hat, where its brim is, how deep the next hat sinks in,
   where the head enters). No `tw` = it can only be the top of a tower.
5. `lines`: two or three Hebrew lines in the voice of `design/punchlines.he.md` (a unit test wants 2-3, at most
   12 words each). Optional: `colors`, `burst`, `fly`, `snd`, `contact`.
6. Look at it: `/avatar-lab.html?view=items` and `?view=slots`; then `npx vitest run tests/unit/avatar.test.ts`
   (file exists, proportions match, slot matches id, the item sits where its slot means, towers stack).
   A bad item is skipped with a console warning and listed at the top of the lab.

Credits for the original accessory photos are in `client/public/assets/shimi/README.md`; keep them in the app's credits.

## The catalog (51 accessories, 12 plates)

| Slot | Originals (owner's page) | Added |
| --- | --- | --- |
| HEAD (28) | 1 beer helmet, 2 straw hat, 3 pirate hat, 4 backwards cap, 8 crown, 10 top hat, 12 sombrero, 14 viking helmet, 16 bucket hat, 17 party hat | 101 halo, 102 devil horns, 103 chef hat, 104 cowboy hat, 105 graduation cap, 106 wizard hat, 107 pompom beanie, 108 fez, 109 flower crown, 110 watermelon helmet, 111 propeller cap, 112 traffic cone |
| EYES (8) | 5 shutter glasses, 9 heart glasses | 201 aviators, 202 nerd glasses, 203 3D glasses, 204 monocle, 205 eye patch, 206 star glasses |
| EARS (7) | 6 green ears, 13 headphones | 301 bunny ears, 302 gold hoops, 303 hibiscus, 304 phone handset, 305 earmuffs |
| FACE (6) | 11 moustache | 225 clown nose, 226 party blower, 227 rose, 228 pacifier, 229 beard |
| NECK (8) | 7 pink bow, 15 lei | 325 gold chain, 326 feather boa, 327 fan scarf, 328 medal, 329 striped tie, 330 bandana |

The added pictures are generated product photos (Higgsfield, nano_banana_2_1) cut out by the makers; three were
touched up in review (`tests/e2e/avatar-review-fix.py`: a dark edge on the monocle and the star glasses, dark
lenses in the star glasses, a band drawn over the head for the earmuffs). Hats 101, 102, 106, 111 and 112 cannot
carry another hat. No pair of items is exclusive: every EYES x hat, EARS x hat, FACE x EYES / EARS and beard x NECK
pair was looked at (`tests/e2e/out/avatar-review/combos1-*.png`).

## Numbers (measured in review, Chromium, a busy shared machine)

- Pictures: 51 WebP accessories 1.61 MB + `doll.png` 0.44 MB = 2.05 MB, loaded once (the same pictures were 6.1 MB as PNG).
- Code, production build: the core + catalog + lab chunk is 55.6 KB (20.8 KB gzip); the dressing room is its own
  chunk, 36.0 KB (14.3 KB gzip) + 15.4 KB CSS (4.5 KB gzip). No other page loads either: nothing is wired yet,
  and `index.ts` does not import the dressing room.
- 60 looks at 40 and 96 px (120 pictures): 250-300 ms unthrottled. On a 4x throttled CPU: 0.65 s when the machine was quiet, 2.2-3.9 s while
  six other jobs loaded it (load 9 on 4 cores; composing itself is 60-180 ms of that, the rest is waiting for the
  CPU). 120 looks (240 pictures) throttled: 2.7-4.6 s under the same load (the core's own run measured 1.6-1.9 s).
  Either way the pictures arrive in 8 ms slices, so the page never freezes.
- Cache after 60 looks at two sizes: 118 pictures, 2.6 MB of canvases + 2.6 MB of BMP object URLs; 120 looks: 5.3 + 5.3 MB.
  Limits: 600 pictures or 48 MB, 300 URLs.

## Wiring checklist

Nothing below is done yet. Every step names the file it touches.

**Server (`shared/protocol.ts`, `server/room.ts`, `server/sockets.ts`)**

1. `PlayerPublic` gets `readonly look: string` (the encoded look). Keep `avatar: number` until every screen is moved.
2. On join: `look = encodeLook(randomLookAvoiding(seedFromText(player.id), looksOfTheOtherPlayers, ITEM_IDS))`
   (`ITEM_IDS` from `client/src/avatar/catalog`: plain data, safe in node; or leave the id list out and accept
   every id of the ranges). A reconnecting player keeps the stored look. The join request may carry the look the
   phone saved in localStorage; treat it like `player:look`.
3. New client event `'player:look': (req: { look: string }, ack) => void`. Handler: refuse non-strings and anything
   longer than `AVATAR_ENCODED_MAX` (48); `const clean = encodeLook(decodeLook(req.look, ITEM_IDS))`; if it differs
   from the stored one, store it and broadcast the room state. That one line is the whole sanitizing: the result is
   always a valid look of at most 32 characters, `[0-9.-]` only.
4. Rate-limit it (the room already debounces to one message per 400 ms; drop more than about 5 per second), allow it in
   the lobby and between rounds, and ignore it while a round is running if broadcasting then is a problem.
5. `host:reset` keeps looks. Bots in `tests/load/bots.ts` can send `encodeLook(randomLook(i, ITEM_IDS))`.

**Phone waiting screen (`client/src/player/screens.tsx`, `controller.ts`)**

1. In the lobby / waiting screen mount the room lazily:
   `const Room = lazy(() => import('../avatar/dressing'))` or a dynamic import in an effect, inside a parent with a
   definite height (flex child with `min-height: 0`, or `position: absolute; inset: ...`). At least 400 px with
   `compact` (under the lobby header), 500 px without; below that, show a button that opens the room full screen.
2. `look={decodeLook(me.look)}`, `name={me.name}`, `onChange={(l) => socket.emit('player:look', { look: encodeLook(l) })}`
   and save the string in localStorage (send it again on reconnect), `onDone` closes the room / scrolls back to the lobby.
3. While it loads show `<Avatar look={me.look} size={112} />` (it is in the core chunk, not the room's).
4. Call `preloadAvatarAssets()` when the lobby mounts, so the room opens with its pictures ready.
5. The room unlocks audio on the first tap through the kit; nothing to do. It must not be mounted during a game.

**Phone lists (`client/src/player/ui.tsx`, `me-bar.tsx`, `screens.tsx`)**

Replace `<Avatar index={p.avatar} size={n} />` (the placeholder cartoon in `player/ui.tsx`) with
`<Avatar look={p.look} size={n} />` from `../avatar`: `me-bar.tsx` (34, the slot is marked `data-slot="me-avatar"`),
`screens.tsx` lobby list (30 / 26), my card (76 / 112, use `ring`), winner (128, `crop="bust"` reads well), result
rows (30), podium (52 / 42). The props differ (`look` instead of `index`), so rename the old component or import the
new one as `ShimiAvatar`.

**TV (`client/src/host/lobby.tsx`, `client/src/host/show/common.tsx`, `playing.tsx`, `results.tsx`, `standings.tsx`, `final.tsx`)**

1. `host/main.tsx`: `void preloadAvatarAssets()` at start (2.05 MB once, then every icon is a cache hit).
2. Lobby chips (`lobby.tsx`, today a coloured initial from `avatarColor(p.avatar)`): `<Avatar look={p.look} size={64} ring />`
   next to the name; at 60 guests drop to 40 px. The plate colour is the chip colour now, so `--chip` can go.
3. `show/common.tsx` `sh-avatar` (the shared avatar of the show screens): swap its body for `<Avatar look size ring />`.
   That covers the live race rows (`playing.tsx`, 40-48 px), results (`results.tsx`) and standings (`standings.tsx`).
4. Podium (`final.tsx`): `<Avatar look size={220} crop="bust" ring />` for the top three; `crop="full"` shows the whole
   dressed doll on the winner's step and always holds the whole hat tower.
5. On dark panels use `ring` (plates 7 and 11 are dark). In race rows that reorder, key by player id: the picture is
   cached per look, so a moving row never recomposes.
6. A look changes live in the lobby: `<Avatar>` keeps the old picture until the new one is ready, no flicker.

**Games (optional; `client/src/games/flappy`, `client/src/games/icy`)**

`const sprite = await avatarCanvas(me.look, 96, { crop: 'icon', plate: false })` in the game's setup (never in
`update`) gives the player's own dressed head as a transparent cut-out with the sticker outline: the flappy bird, the
icy climber (`icy/art.ts` loads `shimi/head.png` today: same square, same centre line). With a tall tower the icon
cuts the top; `crop: 'bust'` holds it all but the head is smaller. The game context needs the player's look
(`types.ts`), which the server already has once step 1 is done.

**Credits**: the original accessory photo credits in `client/public/assets/shimi/README.md` still apply to the WebP copies.
