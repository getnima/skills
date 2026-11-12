# אייסי שימי — art slots

Drop a file here with the name below (the same base name with .png / .webp / .jpg / .jpeg / .svg also works; an exact name wins) and it replaces the picture with no code change. A missing file always falls back, with no error, to the drawn look of the game. After adding files, re-run the production build.

Look: a stone tower climbed by the Shimi doll, every picture a glossy hand-painted vinyl toy (the style of `../shimi/doll.png` and `../ninja/food/`), finished by the game with the party style of `../shimi/README.md`: an ink outline and a hard shadow cut from each picture's own silhouette. The ledges change material every 25 floors: snow-capped stone with icicles (floors 0-24), solid ice (25-49), timber planks (50-74), red steel girders under a gold summit light (75 and up); every 10th floor is a gold ledge with rubies, under the game's "קומה N" sign.

Total weight of this folder: 416 KB. A round downloads 146 KB of it (the hero frames, the ledges, the walls); the three `face*.png` (262 KB) are fetched only when the hero frames are missing.

## The hero (full-body sprite frames)

All frames 256 x 256 px, transparent WebP, the same scale and one shared anchor: **x = 128 (the middle), y = 236 (the ground line)**. The standing figure is 200 px tall, hat to boots (the head is about 45% of it), facing right; the game mirrors it for running left. Drawn about 74 px tall on a 390 px phone (61 px on 320 px), so every frame is pre-rendered once at that size with an ink outline. Made by `tests/e2e/icy-art-hero.py` (see "How these were made").

| File | Pixels | What it shows | When the game shows it |
| --- | --- | --- | --- |
| `hero/stand.webp` | 256 x 256 | Standing relaxed, three-quarter view, smiling. Red puffer jacket, yellow knitted scarf, cobalt trousers, white winter boots, yellow mittens, the strawberry hat. | On a floor and (almost) still; also over the top of a jump, coming down to land. **This one decides**: when it is missing the game uses the small drawn runner below for everything. |
| `hero/run1.webp` | 256 x 256 | Running right, mid-stride, scarf flying back. | On a floor and moving: run1 / run2 swap every 70 world units run (so faster = faster legs). |
| `hero/run2.webp` | 256 x 256 | The other stride (legs and arms swapped). Wears run1's head (pasted in by the script, chin on chin), so the head does not flick between frames. | As run1. Missing → run1. |
| `hero/jump.webp` | 256 x 256 | In the air, both fists up, knees tucked, smiling. | Flying upwards. Missing → stand. |
| `hero/fall.webp` | 256 x 256 | In the air, arms flailing, shocked face, scarf flying up. | Dropping fast, or close to the bottom edge; also the "fell off" tumble. Missing → jump. |
| `hero/ball.webp` | 256 x 256 | Tucked into a somersault ball. Its centre is 87 px above the ground line (the spin pivot). | A super jump (big combo jump): it spins. Missing → jump. |

Squash and stretch on take-off and landing, the lean with speed and the spin are applied by the game to the frame. The collision body (`physics.ts`) is not the picture and does not change with it.

Replacing a frame: keep the 256 x 256 box, the figure facing right, the feet on y = 236 and the body centred on x = 128 (for `ball`: its middle 87 px above y = 236), the standing figure about 200 px tall.

## The tower

| File | Pixels | Transparent | What it shows | Where it appears | Missing → |
| --- | --- | --- | --- | --- | --- |
| `wall.webp` | 40 x 320 | no | A column of big blue-grey stone blocks (front view). Must tile top to bottom. | Both side walls (mirrored on the right), the colour multiplied per zone (stone / icy cyan / warm timber / gold). | The drawn block walls. |
| `bg.webp` | 720 x 720 | no | A wall of slate-blue stone bricks, running bond, flat light. Must tile top to bottom. | The inner back wall behind the ledges, at half the floor speed, coloured darker per zone; the game hangs the zone's windows / torches / sun windows on it. | The drawn back wall. |
| `floors/zone1.webp` | 493 x 64 | yes | Ledge of floors 0-24: stone blocks capped with a thick layer of snow. | Every normal floor of the zone, and the ground. | `platform.png` if dropped in, else the drawn paper ledge. |
| `floors/zone2.webp` | 345 x 64 | yes | Ledge of floors 25-49: a row of glossy ice cubes with frosted tops. | As above, floors 25-49. | As above. |
| `floors/zone3.webp` | 391 x 64 | yes | Ledge of floors 50-74: timber planks on a beam with iron nails. | Floors 50-74. | As above. |
| `floors/zone4.webp` | 410 x 64 | yes | Ledge of floors 75 and up: a red riveted steel girder. | Floors 75 and up. | As above. |
| `floors/milestone.webp` | 381 x 64 | yes | The special ledge: gold bricks with a row of rubies. | Every 10th floor (full width), under the "קומה N" sign. | `milestone.png` if dropped in, else the drawn red and yellow ledge. |
| `floors/icicles.webp` | 384 x 64 | yes | 12 icicles side by side, one per 32 x 64 cell, each hanging from the top edge. | Sprinkled (seeded per floor) under the stone ledges, fewer and shorter under the ice ledges. | No icicles. |

How a ledge is laid out (3-slice): left cap, a middle that repeats, right cap. The game strings whole pieces of the middle (cut only at the joints between blocks) until the ledge is as wide as the floor, then stretches them a little to fit exactly, so the collision width never changes and no block is cut in half. The whole picture height is the ledge (drawn 26 world units thick); its top row is the line the hero stands on. The inner edge of each cap fades out over 8 px (4 for the girder) and the middle runs under it. The numbers per picture are `ZONE_FLOOR_SLICES` / `MILESTONE_FLOOR_SLICE` in `client/src/games/icy/art.ts`:

| File | Left cap | Right cap | Cuts in the middle (x px) |
| --- | --- | --- | --- |
| `floors/zone1.webp` | 0-44 | 420-493 | 94, 151, 218, 274, 310, 361 |
| `floors/zone2.webp` | 0-55 | 289-345 | 108, 169, 234 |
| `floors/zone3.webp` | 0-51 | 354-391 | 95, 184, 227, 311 |
| `floors/zone4.webp` | 0-22 | 398-410 | 98, 174, 250, 325 |
| `floors/milestone.webp` | 0-43 | 331-381 | 85, 127, 177, 220, 249, 288 |

Replacing a ledge: the same height (64 px) and the same cap / cut positions works with no code change; anything else needs the row in `art.ts` changed too (`tests/e2e/icy-art-floor.py` prints it).

## Older slots (still work)

| File | Recommended pixels | Transparent | What it shows |
| --- | --- | --- | --- |
| `face.png` | 256 x 256 | yes | The head of the small drawn runner, normal / running / standing. Used only when `hero/stand` is missing. **Now: the owner's Shimi doll head as a round token, smiling.** A round token sits on a short drawn neck; a head picture that is not round (like `../shimi/head.png`) is drawn bigger, chin on the scarf. Missing → `../shimi/head.png` → a generic cartoon face in a beanie. |
| `face_jump.png` | 256 x 256 | yes | Same head flying upwards (the token, laughing). Missing → `face.png`. |
| `face_fall.png` | 256 x 256 | yes | Same head falling (the token, surprised). Missing → `face.png`. |
| `shirt.png` | 128 x 128 | yes | The small runner's jacket (torso only, centred). Used only with the small runner. Missing → the drawn red jacket. |
| `platform.png` | 128 x 32 | no | One tile of a normal floor, repeated along it. Used for a zone whose `floors/zone*.webp` is missing. |
| `milestone.png` | 128 x 32 | no | Same for every 10th floor, when `floors/milestone.webp` is missing. |

The face files are not even downloaded while the hero frames are there.

Not slots: the ghost finger of the "hold a side" hint, the floor signs, stickers, stars, combo words, the combo meter and the hazard tape are game UI and always drawn by the game. Looks only: no picture changes the level, the physics, the scroll or the score.

Test flag (dev harness only, looks only): `/dev.html?game=icy&icyLookFloor=50` paints the tower as if the camera were 50 floors higher, to look at a zone without climbing.

## How these were made

Generated one picture per request with Higgsfield `nano_banana_2_1` (1k), each a single object as a glossy vinyl toy on a plain backdrop. The hero: the standing pose first with `../shimi/doll.png` as the reference, then every other pose with that standing picture as the reference (run2 is the run asked for with the other leg and arm forward; it came out in profile, so the script gives it run1's head). The ledges: the snow-capped stone ledge first, then the ice / timber / girder / gold ledges with it as the reference; the wall pillar and the back bricks from those too. Untouched originals: `tests/e2e/out/icy-art/originals/` (git-ignored). Cut-outs: the ledges, pillar and bricks locally (`tests/e2e/icy-art-cut.py`, a smooth backdrop model + flood fill), the hero frames with the paid background remover (the `*_rmbg.png` originals). Then:

- `tests/e2e/icy-art-hero.py <originals> <out>`: hero frames to the 256 x 256 box (scale, anchor, head swap of run2).
- `tests/e2e/icy-art-floor.py <cut> <out> --body --lcap --rcap --cuts`: a ledge picture + its slice numbers; `--icicles` cuts the icicle strip from the stone ledge.
- Contact sheet: `tests/e2e/out/icy-art/sheet.png`; hero frames at drawn size: `tests/e2e/out/icy-art/hero-strip.png`.
