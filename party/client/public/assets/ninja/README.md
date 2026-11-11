# נינג׳ה תבורי (ninja): art slots

Drop a file here with the name below and it replaces the placeholder: no code change.
Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g. `target_3.webp`).
In dev just reload the page; a production build must be re-run.

| File | Size (px) | Transparent | What it shows |
| --- | --- | --- | --- |
| `target_1.png` | 256x256 | yes | Thing to slice no. 1 (placeholder: a smiling watermelon). |
| `target_2.png` | 256x256 | yes | Thing to slice no. 2 (placeholder: an orange). |
| `target_3.png` | 256x256 | yes | Thing to slice no. 3 (placeholder: an apple). |
| `target_4.png` | 256x256 | yes | Thing to slice no. 4 (placeholder: a plum). |
| `target_5.png` | 256x256 | yes | Thing to slice no. 5 (placeholder: a lemon). |
| `target_gold.png` | 256x256 | yes | The rare golden target, +50 (placeholder: a gold star coin). Should read as "gold / bonus" at a glance; the game adds a gold glow and sparkles. |
| `bomb.png` | 256x256 | yes | The bomb = "us", the hosts: a round dark bomb with the faces in the middle. Do NOT draw a fuse: the game draws the cap, the lit fuse and the sparks on top (up and to the right of the body), plus a red warning glow. |
| `background.jpg` | 1080x2340 (portrait) | no | Optional backdrop. Scaled to cover the screen (edges cropped; on a wide screen only the middle shows), so keep the middle calm and darkish: bright fruit flies over it. |

Notes
- Targets and the bomb are drawn about 100-125 px wide on a phone; 256 px is enough, 384 px is sharper.
- Keep the round body filling ~84% of the square, centered (the slice / hit circle is 42% of the square around its center). Anything outside the square is cut.
- A sliced target is split along the swipe line through the image center, so a centered, roughly round subject splits best.
- The juice color of each target_N is set in code (`FRUIT_STYLES` in `client/src/games/ninja/art.ts`): red, orange, red, purple, yellow. Change it there if the real pictures want other colors.
