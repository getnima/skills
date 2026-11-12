# פלאפי תבורי: art slots

Drop a file here with the name below and it replaces the placeholder with no code change
(`.png`, `.webp`, `.jpg`, `.jpeg` or `.svg` with the same base name also works; a production
build must be re-run after adding files). Sizes are the recommended pixel sizes (2x the
logical size the game draws at).

The look is the party design system (`../shimi/README.md`): a cobalt sunburst stage with halftone dots, flat colours,
ink outlines, hard shadows, Motaleh for numbers and callouts. Placeholders are painted in that look, so a slot with no
file still fits.

**The face is a finished round token** (final art, do not regenerate): Shimi's head inside a paper-coloured disc with an
ink ring, 256x256, transparent outside the ring. The game draws it as it is, about 60-75 px wide on a phone: no extra
outline, shadow or clipping (that would double the ring). The wings' roots sit on the circle's left and right sides and
the halo floats over its top. The hit circle is about 60% of the token's radius, whatever the picture.

| File | Pixels | Transparent | What it shows |
| --- | --- | --- | --- |
| `face.png` | 256x256 | yes | **Final.** The round token, normal / happy, looking at the camera. The ring touches the square's edges. |
| `face_flap.png` | 256x256 | yes | **Final.** Same token at the moment of a tap (cheeks puffed). Shown for ~0.2s per flap. |
| `face_dead.png` | 256x256 | yes | **Final.** Same token after a crash (dizzy eyes, tongue out). Also what the bird looks like once it is out. |
| `wing.png` | 128x96 | yes | **Final.** ONE white angel wing. Its root (where it joins the face) at the LEFT middle, the tip to the right. The game mirrors it for the other side and rotates it around the root. |
| `halo.png` | 128x48 | yes | Golden halo ring seen slightly from above. |
| `obstacle.png` | 280x220 | yes | The microphone head, pointing UP, its neck at the bottom center (about 40% of the width) joining the pole. The top obstacle is the same image flipped vertically. **In place:** a round ball-type stage microphone as a vinyl toy with a comic ink outline (generated, cut out, fitted to the slot: wider than tall). |
| `obstacle_pole.png` | 96x384 | no (fills the box) | Stand pole, tiles VERTICALLY (top and bottom edges must match). Placeholder: flat chrome, ink edges, one red ring per tile. |
| `ground.png` | 512x128 | no (fills the box) | The stage floor at the bottom, tiles HORIZONTALLY (left and right edges must match). Scrolls with the game. Placeholder: a yellow / red striped lip over a cobalt front with footlights. |
| `skyline.png` | 1024x320 | yes | A strip of scenery in the upper sky, transparent, tiles HORIZONTALLY. Slow parallax. Placeholder: comic clouds. |
| `background.jpg` | 860x1864 | no | Optional full-screen backdrop. Cropped to cover any screen, so keep the important part in the middle. Static. Placeholder: the cobalt sunburst. |

Hit boxes do not depend on the images: the bird's hit circle is about 60% of the face's radius (forgiving on purpose), and the stands hit only along the pole and the head's middle, so a real face or microphone may overlap a little without a crash.

## Shipped as WebP

The pictures here ship as `.webp` (made from the PNG sources by `tools/assets/to_webp.py`: same pixels and the exact same transparency, about 7x lighter for 20 phones on party Wi-Fi). The names in the tables are the slot names: the game finds `face.webp` for the slot `face.png`. To replace a picture, drop a file with the slot name (`.png`, `.webp` or `.jpg`); a file with the exact slot name wins over the WebP.
