# פלאפי תבורי: art slots

Drop a file here with the name below and it replaces the placeholder with no code change
(`.png`, `.webp`, `.jpg`, `.jpeg` or `.svg` with the same base name also works; a production
build must be re-run after adding files). Sizes are the recommended pixel sizes (2x the
logical size the game draws at). Faces are drawn as a circle about 2.2x the hit radius, so keep the face centered and filling the square.

| File | Pixels | Transparent | What it shows |
| --- | --- | --- | --- |
| `face.png` | 256x256 | yes | The flying face, normal / happy, looking at the camera. Centered, filling the square. |
| `face_flap.png` | 256x256 | yes | Same face at the moment of a tap (laughing, cheeks puffed). Shown for ~0.2s per flap. |
| `face_dead.png` | 256x256 | yes | Same face after a crash (dizzy / X eyes / tongue out). |
| `wing.png` | 128x96 | yes | ONE white angel wing. Its root (where it joins the face) at the LEFT middle, the tip to the right. The game mirrors it for the other side and rotates it around the root. |
| `halo.png` | 128x48 | yes | Golden halo ring seen slightly from above. |
| `obstacle.png` | 280x220 | yes | The microphone head, pointing UP, its neck at the bottom center (about 40% of the width) joining the pole. The top obstacle is the same image flipped vertically. |
| `obstacle_pole.png` | 96x384 | no (fills the box) | Stand pole, tiles VERTICALLY (top and bottom edges must match). |
| `ground.png` | 512x128 | no (fills the box) | Dance-floor strip at the bottom, tiles HORIZONTALLY (left and right edges must match). Scrolls with the game. |
| `skyline.png` | 1024x320 | yes | Background silhouettes (city / party hall), transparent sky, tiles HORIZONTALLY. Slow parallax just above the ground. |
| `background.jpg` | 860x1864 | no | Optional full-screen backdrop (night sky). Cropped to cover any screen, so keep the important part in the middle. Static. |

Hit boxes do not depend on the images: a real face may stick out of the circle a little.
