# שימי טאפ (tap): art slots

Every picture of the tap game is a **slot**: drop a file here with the name below and it replaces the current
picture, no code change. Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g.
`face_proud.webp`). The list of files is read when the dev server starts or the app is built: **restart the dev
server, and re-run the production build, after adding a file** (a new file is otherwise not seen). Delete a file
and the game draws a simple placeholder in its place (every slot has one), so nothing ever breaks.

The pictures are photos of the Shimi vinyl doll (the look: `../shimi/README.md`).

## The game in one paragraph (what the pictures are for)

A personal 20-second sprint. The round is 53 s: a 30 s start window (the doll waits, plays four little bits and
counts down the last 5 s), then 20 s of tapping from the player's own first tap (or by itself when the window
runs out), then a 3 s hold so even the last starter sees the final frame. Score = counted taps, nothing else.
The show is the nose pick itself: the faster you tap, the further his hand rises and the deeper the finger goes,
smoothly (the picking clip below), with short lines at 8, 18, 28, 40, 54, 68, 84, 120 and 150 taps. Rules and
where everything lives: `client/src/games/tap/README.md`.

## The head framing (512x512) and the round token

All head pictures share ONE framing, so the head never jumps when the picture changes: a 512 square, the top of
the strawberry hat at the top edge, the black hair about 347 px wide (ears included) and centred, the neck
running off the bottom edge. **To make a new one, edit an existing picture (same size, same place)**.

The game draws them in a round token (like `../shimi/faces_round/`): a cream disc (`#FFF6E0`) with a hard ink
shadow, the picture 0.96 x the disc's diameter wide with its top 0.46 diameters above the centre, then the ink
ring on top. When the game loads, every head picture is **cut to the token circle once and filled with the disc
colour behind** (`toToken` in `client/src/games/tap/art.ts`: a circle centred at (256, 245) of the 512 square,
radius 250), so it is an opaque perfect circle and two pictures crossfade cleanly. Keep anything important
inside that circle: the bottom corners are cut off.

## The picking clip: `pick_00` .. `pick_39` (512x512)

40 frames of one image-to-video take of the doll, on the disc colour, already cut to the token circle: the hand
rises from below, the index finger slides into the nostril (the one on the right of the picture), pushes in, his
eyes close in bliss and then roll up, the head tilting back a little. The game maps its picking depth to a clip
position and crossfades the two nearest frames (`CLIP_SRC` / `CLIP_KEYS` in `art.ts`: `pick_00` is the hand out
of sight, about `pick_10` the fingertip at the nostril, `pick_14` in to the knuckle, `pick_24` eyes shut,
`pick_39` eyes rolled up). About 17 KB each, 690 KB for the clip.

How it was made (so it can be made again): a start frame (`face_normal` framing, no hand) and an end frame (the
old `pick_deep`, finger deep) on the disc colour, scaled 680/512 into a 768 square at (44, 88); one 4 s
image-to-video take with both as keyframes (Higgsfield, Seedance 2.0 mini, 720p, 1:1, no audio), every frame
extracted with ffmpeg; then `tests/e2e/tap-fluent-frames.py` registers every frame by the two ears (the hat,
hair and ears stay exactly in place, the face tilts back inside the head), colour-corrects the background to the
disc colour, cuts the 512 framing and the circle and keeps 40 frames spaced evenly in how much the picture
changes. **A new clip with other frames needs `CLIP_SRC` (and maybe `CLIP_KEYS`) in `art.ts` updated**: the
script prints the clip frame of every file it writes.

## Still faces (512x512, transparent, the same framing)

Crossfaded over the clip. A face without the hand is shown only while the clip's hand is down.

| File | What it shows | When the game shows it |
| --- | --- | --- |
| `face_surprised.png` | Wide eyes, "O" mouth | Countdown 5-4, woken up from dozing off |
| `face_angry.png` | Frown | Countdown 3, the knock bit |
| `face_bored.png` | Eyes rolled up, sulky | The yawn bit |
| `face_proud.png` | Smug grin | **The final frame under 70 taps** |
| `face_whistle.png` | Whistling innocently, eyes away, no hand | The sneak bit, every slowdown ("לא אני.") |
| `face_caught.png` | Finger at the nostril, deadpan stare into the camera | The paparazzi first tap, the sneak bit |
| `face_glass_press.png` | Face squashed wide, huge grin | The knock bit: he presses his face to the glass to look for you |
| `face_squeeze.png` | Eyes shut, cheeks puffed | Dozing off |
| `pick_double.png` | Both index fingers in both nostrils, eyes crossed | **The final frame at 190+ taps** |

The point the code knows on these pictures (shares of the 512 square, `FRAME` in `art.ts`): the nostril
(0.52, 0.665), where the stars come out and the head turns about.

## Props (transparent)

| File | Size | What it is | How to replace it |
| --- | --- | --- | --- |
| `fist.png` | 256x342 | The doll's chubby fist, knuckles to the viewer, wrist cut flat | Knocks three times on the glass in the waiting bit (with cracks drawn by the code). Keep the wrist at the bottom. |

## Not slots

Drawn by the code (the design system in `../shimi/README.md`): the yellow sunburst stage, the halftone dots, the
blue counter, the star-burst stickers and chips (the countdown digits and the final tap count are red star
stickers), the white "tap here" hand of the waiting screen, the fingerprints on the glass, the music note, the
Z's, the glass cracks, the speed lines of the top speed. A `background.jpg` (portrait, cover-scaled, keep the
middle calm) dropped here replaces the painted sunburst.

## Shipped as WebP

The pictures here ship as `.webp` (same pixels and transparency as PNG, about 7x lighter for 20 phones on party
Wi-Fi). The names in the tables are the slot names: the game finds `face.webp` for the slot `face.png`. To
replace a picture, drop a file with the slot name (`.png`, `.webp` or `.jpg`); a file with the exact slot name
wins over the WebP.
