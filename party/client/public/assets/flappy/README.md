# פלאפי תבורי: art slots

Drop a file here with the name below and it replaces the placeholder with no code change
(`.png`, `.webp`, `.jpg`, `.jpeg` or `.svg` with the same base name also works; a production
build must be re-run after adding files). Sizes are the recommended pixel sizes (2x the
logical size the game draws at).

The look is the party design system (`../shimi/README.md`): a cobalt sunburst stage with halftone dots, flat colours,
ink outlines, hard shadows, Motaleh for numbers and callouts. Placeholders are painted in that look, so a slot with no
file still fits.

**The bird is the flying angel** (2026-11-12, the owner: "the angel asset is ugly"): the prize figurine itself, a
chubby vinyl cherub with Shimi's head and the strawberry cap, flying to the right, generated from `../host/prize.png`
and cut out. Four frames of one wing beat play as a sprite (wings high, up, level, down, level, up) at 7 fps while
gliding and up to 12 fps right after a tap (a tap restarts the down-stroke); a crash shows the dizzy frame, spinning,
and it lands head-first. It leans at most about 20 degrees (never spins like a coin), the halo floats level above the
head, and a guest's dressed head (the avatar doll is the same figurine) sits over the figurine's own. All five frames
share one canvas: the head (cap top to chin) spans 1.7%..64.1% of the height, its middle at 79.5% / 36.8% (that point is
the hit circle), leaning 0.36 rad clockwise (`ANGEL` in `../../src/games/flappy/index.ts`). With any frame missing, the
round token with two wings below is drawn instead.

| File | Pixels | Transparent | What it shows |
| --- | --- | --- | --- |
| `angel_0.png` .. `angel_3.png` | 480x392 | yes | The flying angel's wing beat: wings straight up, raised, level (swept back), pushed down. Same body and head in every frame, pixel for pixel. |
| `angel_dead.png` | 480x392 | yes | Same pose after a crash: crossed eyes, tongue out, a bump, wings limp. |

**The obstacles take turns between five themes** (obstacle i wears theme i % 5, so two in a row never match), the
party's stage gear in the same comic vinyl look: the classic ball microphone, a gold vintage microphone, a darbuka
(the drum skin at the gap), a disco ball (it glints, 8 fps) and a DJ air horn. Each head is drawn as wide as the head
box with its widest part at the gap, so the art always covers what can hit you; every theme hits exactly like the
microphone. A passed obstacle goes "boing" and puffs music notes. Each theme has its own painted pole (a
`pole_<theme>.png` file replaces one, same rules as `obstacle_pole.png`).

| File | Pixels | Transparent | What it shows |
| --- | --- | --- | --- |
| `obstacle_goldmic.png` | 280x327 | yes | Gold 1950s capsule microphone, pointing UP, neck at the bottom centre (pole: gold, ink ring). |
| `obstacle_darbuka.png` | 280x250 | yes | Darbuka with a mother-of-pearl mosaic, the skin on TOP (pole: turquoise, gold ring). |
| `obstacle_disco.png` | 280x320 | yes | Mirror disco ball in a red cup (pole: chrome, pink and cyan ring). |
| `obstacle_horn.png` | 280x307 | yes | DJ air horn, the yellow bell on TOP, a red canister (pole: red, yellow ring). |

**The round token** (the bird before the angel, still drawn when an angel frame is missing; final art, do not regenerate): Shimi's head inside a paper-coloured disc with an
ink ring, 256x256, transparent outside the ring. The game draws it as it is, about 60-75 px wide on a phone: no extra
outline, shadow or clipping (that would double the ring). The wings' roots sit on the circle's left and right sides and
the halo floats over its top. The hit circle is about 60% of the token's radius, whatever the picture.

| File | Pixels | Transparent | What it shows |
| --- | --- | --- | --- |
| `face.png` | 256x256 | yes | **Final.** The round token, normal / happy, looking at the camera. The ring touches the square's edges. |
| `face_flap.png` | 256x256 | yes | **Final.** Same token at the moment of a tap (cheeks puffed). Shown for ~0.2s per flap. |
| `face_dead.png` | 256x256 | yes | **Final.** Same token after a crash (dizzy eyes, tongue out). Also what the bird looks like once it is out. |
| `wing.png` | 128x96 | yes | **Final.** ONE white angel wing. Its root (where it joins the face) at the LEFT middle, the tip to the right. The game mirrors it for the other side and rotates it around the root. |
| `halo.png` | 256x140 | yes | Golden halo ring seen slightly from above. **In place:** a glossy gold vinyl ring (generated, cut out, brightened). |
| `obstacle.png` | 280x220 | yes | The microphone head, pointing UP, its neck at the bottom center (about 40% of the width) joining the pole. The top obstacle is the same image flipped vertically. **In place:** a round ball-type stage microphone as a vinyl toy with a comic ink outline (generated, cut out, fitted to the slot: wider than tall). |
| `obstacle_pole.png` | 96x384 | no (fills the box) | Stand pole, tiles VERTICALLY (top and bottom edges must match). Placeholder: flat chrome, ink edges, one red ring per tile. |
| `ground.png` | 512x128 | no (fills the box) | The stage floor at the bottom, tiles HORIZONTALLY (left and right edges must match). Scrolls with the game. Placeholder: a yellow / red striped lip over a cobalt front with footlights. |
| `skyline.png` | 1024x320 | yes | A strip of scenery in the upper sky, transparent, tiles HORIZONTALLY. Slow parallax. Placeholder: comic clouds. |
| `background.jpg` | 860x1864 | no | Optional full-screen backdrop. Cropped to cover any screen, so keep the important part in the middle. Static. Placeholder: the cobalt sunburst. |

Hit boxes do not depend on the images: the bird's hit circle is about 60% of the face's radius (forgiving on purpose), and the stands hit only along the pole and the head's middle, so a real face or microphone may overlap a little without a crash.

## Shipped as WebP

The pictures here ship as `.webp` (made from the PNG sources by `tools/assets/to_webp.py`: same pixels and the exact same transparency, about 7x lighter for 20 phones on party Wi-Fi). The names in the tables are the slot names: the game finds `face.webp` for the slot `face.png`. To replace a picture, drop a file with the slot name (`.png`, `.webp` or `.jpg`); a file with the exact slot name wins over the WebP.
