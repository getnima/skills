# שימי טאפ (tap): art slots

Drop a file here with the name below and it replaces the current picture: no code change.
Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g. `face_happy.webp`).
In dev restart or reload the page; a production build must be re-run. Delete a file and the game draws a
simple placeholder in its place (every slot has one), so nothing ever breaks.

The pictures are photos of the Shimi vinyl doll and toy props as cut-outs (see `../shimi/README.md` for the
look). They were generated one by one with Higgsfield (nano banana 2, the doll head as a reference) and cut out
on a flat background; the untouched originals are kept outside the app in `tests/e2e/out/qa-tap-art/originals/`.

## Head frames (512x512, transparent)

All head frames share ONE framing, so the head never jumps when a frame swaps: square picture, top of the
strawberry hat at about 3 px from the top, the black hair about 308 px wide and centred, the chin at the bottom
edge. The game sits the chin just behind the blue tray at the bottom, so anything under the chin (a hand, a
forearm, a collar) is hidden by the tray. To replace one, edit an existing frame (same size, same place) rather
than starting from a new photo.

| File | What it shows | When the game shows it |
| --- | --- | --- |
| `face_normal.png` | Neutral smile | Calm, the hand is low |
| `face_happy.png` | Big laugh | In the frenzy (last 15 s) while the hand is low |
| `face_surprised.png` | Wide eyes, "O" mouth | The hand is almost at the nose |
| `face_angry.png` | Frown | The hand is half way up ("annoyed as it approaches") |
| `face_tongue.png` | Tongue out | Cheeky, after the finger came out; bored cycle |
| `face_wink.png` | Wink | After the finger came out; bored cycle |
| `face_bored.png` | Half-closed eyes, puffed cheeks | Nobody tapped for 1.5 s ("נו?") |
| `face_proud.png` | Eyes closed, smug grin | After a picking run that produced a BIG booger |
| `face_nosepick.png` | Finger at the nostril (its own hand in the picture) | The moment the finger goes in (0.12 s) |
| `pick_knuckle.png` | Finger in to the first knuckle, nose pushed up, one eye squinting | Picking, between digs |
| `pick_deep.png` | Finger deep, eyes rolled up, blissful | Picking, on every dig (0.1 s flash) |
| `pick_out.png` | Finger just out, green strand nostril to fingertip, guilty side-eye | The finger came out (0.45 s) |
| `pick_big.png` | Finger pulled down to the chin, a very long strand, amazed | The BIG booger is coming out (0.9 s); the game grows the boss booger at the fingertip |

Points the code knows on these frames (shares of the 512 square, `FRAME` in `client/src/games/tap/art.ts`):
nostril (0.52, 0.665), the fingertip of `pick_out` (0.69, 0.70) and of `pick_big` (0.56, 0.93). A new picture
with the finger somewhere else needs those numbers updated.

## The hand (`hand.png`, 138x400, transparent)

The doll's own chubby hand and forearm alone, a fist with the index finger pointing straight up, forearm running
off the bottom. It rises from behind the tray to the nostril as the pick meter fills, jabbing up on every tap. The
fingertip must stay at the top edge, at 74% of the width (`HAND` in `art.ts`).

## Boogers (transparent, longest side <= 360 px)

Each dig throws the next booger of a seeded sequence (the same order on every phone). They fly at the screen,
stick to the "glass", slide down and melt into the pile at the bottom.

| File | Size | What it is |
| --- | --- | --- |
| `booger_round.png` | 256x255 | Small round slime ball with a dopey smile (most common) |
| `booger_stretchy.png` | 64x360 | Long stretchy strand with a surprised blob at the bottom (stretches as it slides, then snaps) |
| `booger_googly.png` | 256x242 | Blob with big googly eyes and one tooth |
| `booger_hairy.png` | 194x256 | Chunky grumpy nugget with one curly hair |
| `booger_golden.png` | 256x249 | Rare golden nugget, smug ("מטמון!", +5 bonus) |
| `booger_boss.png` | 360x347 | Giant flexing booger with a crown: the BIG booger (+25) |

## Not slots

The yellow sunburst stage, the halftone dots, the blue tray, the stickers and the teaching hint's white ghost
finger are drawn by the code (the design system in `../shimi/README.md`). A `background.jpg` (portrait, cover-
scaled, keep the middle calm) dropped here replaces the painted sunburst.

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
