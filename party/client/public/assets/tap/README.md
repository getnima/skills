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
