# שימי טאפ (tap): art slots

Every picture of the tap game is a **slot**: drop a file here with the name below and it replaces the current
picture, no code change. Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g.
`face_happy.webp`). The list of files is read when the dev server starts or the app is built: **restart the dev
server, and re-run the production build, after adding a file** (a new file is otherwise not seen). Delete a file
and the game draws a simple placeholder in its place (every slot has one), so nothing ever breaks.

The pictures are photos of the Shimi vinyl doll and toy props as cut-outs on transparency (the look:
`../shimi/README.md`). They were generated one at a time with the doll head as the reference and cut out on a
flat background.

## The game in one paragraph (what the pictures are for)

A personal 20-second sprint. The round is 53 s: a 30 s start window (the doll waits, plays five little bits and
counts down the last 5 s), then 20 s of tapping from the player's own first tap (or by itself when the window
runs out), then a 3 s hold so even the last starter sees the final frame. Score = counted taps, nothing else.
All the comedy is graphics: the finger goes deeper into the nose as the tap rate rises, boogers fly at the glass
and pile up under the doll, and set pieces play at 8, 18, 28, 40, 54, 68, 84, 120 and 150 taps. The last 5 s
grow one last booger on his fingertip; it lands on his head for the final frame. Rules and where everything
lives: `client/src/games/tap/README.md`.

## Head frames (512x512, transparent) and the round token

All head frames share ONE framing, so the head never jumps when a frame swaps: a 512 square, the top of the
strawberry hat at the top edge, the black hair about 347 px wide (ears included) and centred, the neck running
off the bottom edge. **To make a new frame, edit an existing frame (same size, same place)**, or align your
picture to `face_normal.png` by the width and top of the hat and hair.

The game draws each frame in a round token (like `../shimi/faces_round/`): a cream disc with a hard ink shadow,
the frame 0.96 x the disc's diameter wide with its top 0.46 diameters above the centre, then the ink ring on
top. When the game loads, every head frame is **masked to the token circle once** (`maskToToken` in
`client/src/games/tap/art.ts`: a circle centred at (256, 245) of the 512 square, radius 250). So the head is
always a perfect circle and the neck cut at the bottom edge never shows. Keep anything important inside that
circle: the bottom corners of the square are cut off.

| File | What it shows | When the game shows it |
| --- | --- | --- |
| `face_normal.png` | Neutral smile | Waiting (breathing), hand low (L0), the start of the climb (L1) |
| `face_happy.png` | Big laugh | After the sneeze, after the cork landing |
| `face_surprised.png` | Wide eyes, "O" mouth | Top of the climb (L1), countdown 5-4, rope snap, staring at mini Shimi, the shy-booger and woken-up bits |
| `face_angry.png` | Frown | Countdown 3, the knock bit |
| `face_tongue.png` | Tongue out | After the rope snap |
| `face_wink.png` | Wink | After the squeegee, the wink filler |
| `face_bored.png` | Eyes rolled up, sulky | The yawn bit, the eye-roll filler, **the final frame under 70 taps** |
| `face_proud.png` | Smug grin | The shrug after the first tap, Yossi, squeegee, the king, the golden booger |
| `face_nosepick.png` | Its own finger at the nostril | Hand level L2, countdown 2-1, the sneak bit, the auto-start |
| `pick_knuckle.png` | Finger in to the first knuckle | Hand level L3 (a slow tapper lives here), the auto-start, **the final frame at 70-129** |
| `pick_deep.png` | Finger deep, eyes rolled up | A 90 ms flash per tap in L3, held in L4 (head tilted back), wind-ups |
| `pick_out.png` | Finger just out, green strand | Yossi, mini Shimi, every slowdown ("לא אני.") |
| `pick_big.png` | Finger pulled to the chin, long strand | The rope (18), the king's pull (84), **the whole last 5 seconds**, **the final frame at 130-189** |
| `pick_double.png` | Both index fingers in both nostrils, eyes crossed | Hand level L5 (absurd rate), **the final frame at 190+** |
| `face_whistle.png` | Whistling innocently, eyes away, no hand | The fake-innocence gag, the sneak bit, the shy booger hiding |
| `face_caught.png` | Finger in, deadpan stare into the camera | The paparazzi first tap, caught after a slowdown, the sneak bit, the ear |
| `face_glass_press.png` | Face squashed wide, huge grin | The knock bit: he presses his face to the glass to look for you |
| `face_dizzy.png` | Spiral eyes, tongue out | The bobble spin and the cork landing |
| `face_squeeze.png` | Eyes shut, cheeks puffed | Wind-up of the sneeze and the cork, dozing off (the sleep bit) |

Points the code knows on these frames (shares of the 512 square, `FRAME` in `art.ts`): the nostril
(0.52, 0.665), the fingertip of `pick_out` (0.69, 0.70) and of `pick_big` (0.56, 0.93), the left ear
(0.185, 0.60). A new picture with the finger somewhere else needs those numbers updated.

## Hands and props (transparent)

| File | Size | What it is | How to replace it |
| --- | --- | --- | --- |
| `hand.png` | 138x400 | The doll's hand and forearm alone, index finger straight up | Fingertip at the top edge, 74% of the width (`HAND` in `art.ts`). Used for the first climb (L1), the sneak bit and, rotated, the waiting screen's "tap here" finger poking his nose. |
| `fist.png` | 256x342 | The doll's chubby fist, knuckles to the viewer, wrist cut flat | Knocks three times on the glass in the waiting bit (with cracks drawn by the code). Keep the wrist at the bottom. |
| `fingertip_ear.png` | 256x256 | One toy fingertip pointing up, base cut flat | Pokes out of his ear at 28 taps (the code rotates it to point left and hides the base in the ear). |
| `squeegee.png` | 384x384 | Toy window squeegee, black blade on top, yellow handle down | Sweeps diagonally across the token at 68 taps, 0.9 x the token wide. |
| `splat.png` | 256x256 | Flat lime-green slime splat from above | The decal under each booger that hits the glass. The code adds the ink outline; at most 6 are on the glass at once. |

## Boogers (transparent, longest side <= 360 px)

One booger drips per 6 counted taps (per 3 in the last 5 s), seeded (the same order on every phone, never the
same kind twice in a row). It flies at the glass, splats, does its character move and slides down around the
doll's head into the pile under the token; the first one of each kind arrives twice as big (a close-up). At most
6 are flying or sliding at once. Pure spectacle: none is worth points.

| File | Size | What it is |
| --- | --- | --- |
| `booger_round.png` | 256x255 | Round slime ball with a dopey smile: 40% of the drip, Yossi (8 taps), the shy booger that peeks out while waiting, the last-5-seconds booger |
| `booger_stretchy.png` | 64x360 | Stretchy strand: 15% of the drip (hangs and snaps), and the one the rope flings into the top-right corner |
| `booger_googly.png` | 256x242 | Googly eyes: 25% of the drip (stares at your finger before it slides; blinks on the final frame) |
| `booger_hairy.png` | 194x256 | Grumpy hairy nugget: 20% of the drip (crawls up grumbling, then slides) |
| `booger_golden.png` | 256x249 | Golden nugget: once per player between taps 42 and 108 ("מטמון!"), sticks top-left on a yellow star |
| `booger_boss.png` | 360x347 | The king (84 taps), then on the pile under "מלך הנזלת"; on the final frame at 190+ he sits crowned on Shimi's head |

The round token of mini Shimi (40 taps) is `../shimi/faces_round/normal.png`.

## Not slots

Drawn by the code (the design system in `../shimi/README.md`): the yellow sunburst stage, the halftone dots, the
blue counter, the star-burst stickers and chips (the countdown digits and the final tap count are red star
stickers), the outline of the splats, the fingerprints, the music note, the Z's, the glass cracks, the speed
lines and steam clouds of the absurd rate, the orbiting stars. A `background.jpg` (portrait, cover-scaled, keep
the middle calm) dropped here replaces the painted sunburst.

## Generated in the last pass

`pick_double.png` and `fist.png` (nano_banana_2_1, 1k, one at a time, the existing nose-pick frame as the
reference), cut out locally (flood fill from the corners), `pick_double` aligned to `face_normal.png` by the
width and top of the head.

## Shipped as WebP

The pictures here ship as `.webp` (made from the PNG sources by `tools/assets/to_webp.py`: same pixels and the exact same transparency, about 7x lighter for 20 phones on party Wi-Fi). The names in the tables are the slot names: the game finds `face.webp` for the slot `face.png`. To replace a picture, drop a file with the slot name (`.png`, `.webp` or `.jpg`); a file with the exact slot name wins over the WebP.
