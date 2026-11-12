# אייסי שימי — art slots

Drop a file here with the name below (same base name with .png / .webp / .jpg / .jpeg / .svg also works) and it replaces the placeholder with no code change. Missing files fall back to the built-in cartoon placeholders. After adding files, re-run the production build.

| File | Recommended pixels | Transparent | What it shows |
| --- | --- | --- | --- |
| `face.png` | 256 x 256 | yes | The climber's face, normal / running / standing. A round head filling about 92% of the square, centered (the game draws it as a ball and spins it on big jumps). |
| `face_jump.png` | 256 x 256 | yes | Same face while flying upwards after a jump (happy, excited). Same framing as `face.png`. |
| `face_fall.png` | 256 x 256 | yes | Same face falling / scared / just fell off the screen. Same framing as `face.png`. |
| `platform.png` | 128 x 32 | no (opaque is best) | One tile of an ice floor. Repeated horizontally along every floor and clipped to rounded ends, so its left and right edges must tile seamlessly. Snowy top edge looks best. |
| `milestone.png` | 128 x 32 | no | Same as `platform.png` for every 10th floor (full width, shows "קומה 10/20/…"). Make it stand out (gold, party colors). |
| `wall.png` | 32 x 256 | no | One tile of the side walls (ice pillar). Repeated vertically on both sides, so its top and bottom edges must tile seamlessly. |
| `bg.png` | 720 x 1280 | yes (or opaque) | Parallax backdrop layer, scrolls slowly behind the tower and repeats vertically (top and bottom edges must tile). Transparent lets the color sky (blue day → sunset → night → aurora as you climb) show through; an opaque picture covers it. |

Notes
- The faces are drawn about 45-52 px wide on a phone (the head is a ball of that size), so keep features big and bold.
- With the real `platform.png` / `milestone.png` the placeholder icicles under the floors are no longer drawn.
- Without `bg.png` the stars and ice crystals are drawn as cheap shapes. A real `bg.png` is drawn as one more full-screen picture every frame: fine on a phone, but keep it a plain PNG (no huge file, 720 x 1280 is plenty).
- Not slots: the ghost finger of the "hold a side" hint and the glow behind big jumps are game UI and always drawn by the game.
