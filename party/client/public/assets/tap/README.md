# שימי טאפ (tap): art slots

Drop a file here with the name below and it replaces the current picture: no code change.
Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g. `face_happy.webp`).
In dev restart or reload the page; a production build must be re-run. Delete a file and the game draws a
simple placeholder in its place (every slot has one), so nothing ever breaks.

The pictures are photos of the Shimi vinyl doll and toy props as cut-outs (see `../shimi/README.md` for the
look). They were generated one by one (the doll head as a reference) and cut out on a flat background; the
untouched originals are kept outside the app in `tests/e2e/out/qa-tap-art/originals/` and
`tests/e2e/out/tap-art2/originals/`.

## The game in one paragraph (what the pictures are for)

A personal 20-second sprint: the round is 50 s, the first 30 s are a start window (the doll waits, idles and
gets impatient), the player's first tap starts their 20 s (or the sprint starts by itself when the window runs
out). Score = counted taps, nothing else: no multiplier, no bonus, no meter. All the comedy is graphics: the hand
climbs into the nose as the tap rate rises, boogers fly at the glass, and set pieces play at 8, 18, 30, 45, 62,
80, 100, 140 and 190 taps. Rules: `client/src/games/tap/pick.ts`; the show: `client/src/games/tap/index.ts`.

## Head frames (512x512, transparent) and the round token

All head frames share ONE framing, so the head never jumps when a frame swaps: square picture, top of the
strawberry hat at the top edge, the black hair about 308 px wide and centred, the chin at the bottom edge.
The game draws every frame inside a round token (a porthole, like `../shimi/faces_round/`): a cream disc with a
hard ink shadow, the frame drawn 0.94 x the disc diameter wide with its top at 0.46 diameters above the centre
(hat just under the ring, chin just inside the bottom), everything of the doll (frames, the hand sprite, the
second hand, the ear fingertip) clipped to the circle, then the ink ring on top. Nothing hides under a tray any
more: whatever is in the bottom of a frame (a collar, a forearm) shows inside the circle. To replace a frame,
edit an existing frame (same size, same place) rather than starting from a new photo.

| File | What it shows | When the game shows it |
| --- | --- | --- |
| `face_normal.png` | Neutral smile | Waiting (breathing), hand low (L0), lower half of the climb (L1) |
| `face_happy.png` | Big laugh | After the sneeze, after the cork landing |
| `face_surprised.png` | Wide eyes, "O" mouth | Fingertip at the nostril (L2), countdown 5-4, rope snap, staring at mini Shimi, sneeze snap |
| `face_angry.png` | Frown | Upper half of the climb (L1), the knock bit, countdown 3-1 |
| `face_tongue.png` | Tongue out | After the rope snap |
| `face_wink.png` | Wink | After the squeegee, the wink filler |
| `face_bored.png` | Half-closed eyes, puffed cheeks | Waiting yawn, the eye-roll filler |
| `face_proud.png` | Eyes closed, smug grin | The shrug after the first tap, Yossi, squeegee, the king, the golden booger |
| `face_nosepick.png` | Finger at the nostril (its own hand) | The sneak bit, the first 120 ms of the auto-start |
| `pick_knuckle.png` | Finger in to the first knuckle | Hand level L3, the auto-start |
| `pick_deep.png` | Finger deep, eyes rolled up | 90 ms flash per tap in L3, held in L4 / L5, wind-ups |
| `pick_out.png` | Finger just out, green strand | Yossi, mini Shimi, every slowdown, the start of the final frame |
| `pick_big.png` | Finger pulled to the chin, long strand | The rope (18 taps), the king's pull (100 taps) |

Points the code knows on these frames (shares of the 512 square, `FRAME` in `client/src/games/tap/art.ts`):
nostril (0.52, 0.665), second nostril (0.455, 0.675), the fingertip of `pick_out` (0.69, 0.70) and of
`pick_big` (0.56, 0.93), the ear (0.185, 0.60). A new picture with the finger somewhere else needs those updated.

## The hand (`hand.png`, 138x400, transparent)

The doll's own chubby hand and forearm alone, a fist with the index finger pointing straight up. It rises from
below the ring to the nostril as the tap rate rises (L0-L2), sneaks up in the waiting bits, climbs a notch per
second in the last 5 s of the wait, and is drawn mirrored into the other nostril at the absurd rate (L5). The
fingertip must stay at the top edge, at 74% of the width (`HAND` in `art.ts`).

## Boogers (transparent, longest side <= 360 px)

One booger drips per 6 counted taps (per 3 in the last 5 s), seeded (the same order on every phone, never the
same kind twice in a row). Each flies at the glass, splats on a `splat.png` decal, does its character move and
slides down around the face into the pile under the token. Pure spectacle: none is worth points.

| File | Size | What it is |
| --- | --- | --- |
| `booger_round.png` | 256x255 | Round slime ball with a dopey smile: 40% of the drip, and Yossi (8 taps) |
| `booger_stretchy.png` | 64x360 | Stretchy strand: 15% of the drip (hangs and snaps), and the one the rope flings into the top-right corner |
| `booger_googly.png` | 256x242 | Googly eyes: 25% of the drip (stares at the last touch before it slides) |
| `booger_hairy.png` | 194x256 | Grumpy hairy nugget: 20% of the drip (crawls up grumbling, then slides) |
| `booger_golden.png` | 256x249 | Golden nugget: once per player between taps 42 and 108 ("מטמון!"), sticks top-left and glints |
| `booger_boss.png` | 360x347 | The king (100 taps): pulled out on the strand, then flexes on top of the pile under "מלך הנזלת" |

The round token of mini Shimi (45 taps) is `../shimi/faces_round/normal.png`.

## Not slots

The yellow sunburst stage, the halftone dots, the blue counter, the star-burst stickers and chips, the breath
fog and its finger-written digits, the fingerprints, the music note, the orbiting stars and the waiting screen's
white ghost finger are drawn by the code (the design system in `../shimi/README.md`). A `background.jpg`
(portrait, cover-scaled, keep the middle calm) dropped here replaces the painted sunburst.

## New pictures (comedy pass)

Generated one at a time (nano_banana_2_1, 1k), cut out locally, untouched originals in
`tests/e2e/out/tap-art2/originals/`, contact sheet `tests/e2e/out/tap-art2/sheet.png`. Head frames are 512x512 and
aligned to `face_normal.png` by the width and top of the hat/hair (hat top at y 0, same x centre), so they swap
with the existing frames without the hat jumping.

| File | Size | What it is for |
| --- | --- | --- |
| `face_whistle.png` | 512x512 | Whistling innocently, lips pursed, eyes sliding sideways away from the player, no hand. The fake-innocence gag (waiting sneak bit, every slowdown); the music note is drawn by the code. |
| `face_caught.png` | 512x512 | Same hand and finger-to-the-knuckle as `pick_knuckle.png` (matches it pixel-close), eyes wide straight into the camera, flat deadpan mouth. Paparazzi first tap, caught again after a slowdown, the sneak bit, the ear beat. |
| `face_glass_press.png` | 512x512 | Final frame: face squashed wide, snout nose with both nostrils showing, huge goofy grin, bulging eyes. Reads as "squashed and delighted" rather than literally flattened on glass; the code's 1.08 picture scale + squeak sells the press. Its face is a little wider than the others (ear edge at x 0.15 instead of 0.166). |
| `face_dizzy.png` | 512x512 | Copy of `../shimi/faces/dizzy.png` (spiral eyes, tongue out, hat tilted) rescaled x1.061 and shifted (-16, -13) to the face_normal framing. Bobble spin and cork landing. |
| `face_squeeze.png` | 512x512 | Copy of `../shimi/faces/flap.png` (eyes shut, cheeks puffed) with the same x1.061 / (-16, -13) alignment. Wind-up of the sneeze and the cork. |
| `fingertip_ear.png` | 256x256 | One toy fingertip (two joints, nail at the top, flat cut base at the bottom) pointing up, centred. Rotate it to point left for the ear beat; hide the base inside the ear. The left ear's outer edge is at about frame x 0.166, y 0.60. |
| `squeegee.png` | 384x384 | Toy window squeegee, black rubber blade on top, yellow handle down (the hang hole is transparent). Sweeps the glass at 80 taps. No ink outline, and the yellow handle is close to the sunburst yellow: give it the hard ink shadow. |
| `splat.png` | 256x256 | Flat lime-green slime splat seen from above, eight rounded arms and drips at the bottom. Decal under every booger hit, the sneeze splats and the squeegee smear end (stretched 3:1). |
