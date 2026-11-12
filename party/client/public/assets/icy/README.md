# אייסי שימי — art slots

Drop a file here with the name below (same base name with .png / .webp / .jpg / .jpeg / .svg also works) and it replaces the default with no code change. A missing file always falls back to the default (and the default falls back to a built-in drawing). After adding files, re-run the production build.

Look: the party style of `client/public/assets/shimi/README.md` (cobalt / pink / red / sunburst yellow, ink outlines, hard shadows, halftone, the Motaleh display font). You are inside a tower: side walls of big blocks, an inner back wall scrolling at half speed, paper ledges with an ink outline and a hard shadow, a sign on the wall at every 10th floor, and a new mood every 25 floors (cobalt night → pink → red with torches → sunburst summit).

| File | Recommended pixels | Transparent | What it shows |
| --- | --- | --- | --- |
| `face.png` | 256 x 256 | yes | The climber's head (a big bobble head on the small drawn runner), normal / running / standing. Head centred, filling most of the square, chin near the bottom edge (the neck and scarf sit under it). **Now: the owner's Shimi doll head (toy-figurine photo, smiling).** Missing → the doll head `../shimi/head.png` → a generic cartoon face in a beanie. |
| `face_jump.png` | 256 x 256 | yes | Same head while flying upwards. **Now: the doll head laughing.** Missing → `face.png` → the doll head. |
| `face_fall.png` | 256 x 256 | yes | Same head falling / just fell off. **Now: the doll head surprised.** Missing → `face.png` → the doll head. |
| `shirt.png` | 128 x 128 | yes | The runner's jacket / shirt (torso only, centred), drawn about 24 x 20 px over the body. Missing → the drawn red jacket with a yellow zip. |
| `platform.png` | 128 x 32 | no (opaque is best) | One tile of a normal floor, repeated along it and clipped to rounded ends (left and right edges must tile). Missing → paper ledge in the zone's colour with an ink outline. The ink outline and the hard shadow are always drawn. |
| `milestone.png` | 128 x 32 | no | Same for every 10th floor (full width). Missing → red ledge with a yellow top; the "קומה 10/20/…" sign on the wall is always drawn by the game. |
| `wall.png` | 32 x 256 | no | One tile of the side walls (the ones you bounce off), repeated vertically on both sides (top and bottom edges must tile). Missing → block walls in the zone's colour with halftone shading. |
| `bg.png` | 720 x 1280 | no (opaque is best) | The inner back wall behind the floors: repeats vertically (top and bottom edges must tile) and scrolls at half the floor speed. Tinted a little towards the zone's colour above floor 25. Missing → the drawn block wall with lit windows / hearts / torches / sun windows per zone. |

Notes
- The head is drawn about 55-60 px wide on a phone, so keep features big and bold. Any square picture works; a transparent background looks best (the doll head is one).
- The runner's legs, arms and scarf are drawn by the game (they animate: run, tuck, stretch, spin), so they are not slots.
- Not slots: the ghost finger of the "hold a side" hint, the floor signs, stickers, stars and the hazard tape are game UI and always drawn by the game.
- Test flag (dev harness only, looks only): `/dev.html?game=icy&icyLookFloor=50` paints the tower as if the camera were 50 floors higher, to look at a zone without climbing. Gameplay is untouched.
