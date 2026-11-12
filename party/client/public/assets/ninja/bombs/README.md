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

- Top of the metal cap (attach the fuse here): x = 0.505, y = 0.03
- Metal cap spans y 0.03 - 0.16, about 0.065 wide; a black collar sits under it down to about y 0.19, where the sphere begins.

Note: the cap points straight UP (not up-right like the drawn fallback in `../README.md`), so the fuse should start at the point above.

## Body framing

The black sphere is about 72-73% of the picture wide, centred below the middle (the cap, hat and bun take the top);
it is not the 84% body circle `../README.md` describes for `bomb.png`. If the cut radius matters, use a radius of about 0.36 of the picture
around (0.50, 0.62).

## Intended use

Alternate the two bombs (A, B, A, B ...), or pick at random without repeating twice in a row, so both hosts show up in every round.
They replace the shared `../bomb.png` (both hosts on one bomb) only if the game code is changed to load these; `../bomb.png` is untouched.
