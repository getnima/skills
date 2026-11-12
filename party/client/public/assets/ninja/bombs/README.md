# Ninja: host bombs ("we are the bomb")

The two things you must NOT slice: one bomb per party host, each its own generated picture.
Glossy hand-painted vinyl toy, a round black bomb sphere with the host doll's sculpted face set into its front,
and a short ribbed silver fuse cap on top. No fuse rope, sparks, smoke or text: the game draws the lit fuse and the spark on the cap.

Both files: 384x384 transparent PNG, trimmed and centred with about 3% margin (the game scales to 256).
Untouched originals: `tests/e2e/out/ninja-bombs/originals/`. Contact sheets (dark blue): `tests/e2e/out/ninja-bombs/contact_384.png`,
`contact_96.png` (the 96 px one sits the bombs between the food).

| File | Who | Look |
| --- | --- | --- |
| `bomb_host_a.png` | Host A (`../../hosts/host_a.png`) | Curly hair, round tortoiseshell glasses, nose ring, the yellow lemon hat tilted on the top-left of the sphere |
| `bomb_host_b.png` | Host B (`../../hosts/host_b.png`) | Dark hair with straight bangs, winged eyeliner, septum ring, hair bun tilted on the top-right of the sphere |

## Fuse cap (where the game attaches its fuse)

Same in both files, as a fraction of the picture (0,0 = top-left):

- Top of the metal cap (the game attaches the fuse here): x = 0.505, y = 0.03
- Metal cap spans y 0.03 - 0.16, about 0.065 wide; a black collar sits under it down to about y 0.19, where the sphere begins.

The cap points straight UP: the game's fuse starts at the point above and curls up and to the right, with the spark on its tip.

## Body framing

The black sphere is about 73% of the picture wide, centred below the middle (the cap, hat and bun take the top).
Measured on both files (a circle fitted to the sphere's outline): radius 0.365 of the picture around (0.50, 0.603); its bottom is at y 0.97.
The game scales the picture so that this sphere is exactly the bomb's hit circle; the cap, the lemon hat and the hair bun stand out of it
and are not part of the hit area.

These numbers are `BOMB_FRAME` in `client/src/games/ninja/art.ts`, one frame for both files. A replacement picture must keep the frame
(same sphere, same cap top), or `BOMB_FRAME` must be changed with it.

## How the game uses them

The bombs take turns: A, B, A, B ... through the round (which host opens depends on the round), so both hosts show up in every round,
and two bombs thrown together are one of each. Looks only: `client/src/games/ninja/skins.ts`.
The game draws on top: the lit fuse and its spark, a throbbing warning burst behind the bomb and, on the first bomb, the "לא לחתוך!" tag.
If a file is missing the game draws a dark bomb with a cap and a generic face instead (red ring for A, pink for B).
The old shared `../bomb.png` (both hosts on one bomb) is retired and no longer in the folder.

## Shipped as WebP

The pictures here ship as `.webp` (made from the PNG sources by `tools/assets/to_webp.py`: same pixels and the exact same transparency, about 7x lighter for 20 phones on party Wi-Fi). The names in the tables are the slot names: the game finds `face.webp` for the slot `face.png`. To replace a picture, drop a file with the slot name (`.png`, `.webp` or `.jpg`); a file with the exact slot name wins over the WebP.
