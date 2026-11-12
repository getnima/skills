# נינג׳ה תבורי (ninja): art slots

Drop a file here with the name below and it replaces the placeholder: no code change.
Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g. `target_3.webp`).
In dev just reload the page; a production build must be re-run.

| File | Size (px) | Transparent | What it is used for |
| --- | --- | --- | --- |
| `target_1.png` | 256x256 | yes | Thing to slice no. 1, +10 (placeholder: a smiling watermelon). |
| `target_2.png` | 256x256 | yes | Thing to slice no. 2, +10 (placeholder: an orange). |
| `target_3.png` | 256x256 | yes | Thing to slice no. 3, +10 (placeholder: an apple). |
| `target_4.png` | 256x256 | yes | Thing to slice no. 4, +10 (placeholder: a plum). |
| `target_5.png` | 256x256 | yes | Thing to slice no. 5, +10 (placeholder: a lemon). |
| `target_gold.png` | 256x256 | yes | The rare golden target, +50 (placeholder: a gold star coin). Should read as "gold / bonus" at a glance; the game adds a gold glow and sparkles. |
| `bomb.png` | 256x256 | yes | The bomb = "us", the hosts: a round dark bomb with the faces in the middle. Do NOT draw a fuse: the game draws the cap, the lit fuse and the sparks on top (up and to the right of the body), plus a pulsing red glow and, on the first bomb, a "לא לחתוך!" tag. Keep it dark and round so it never looks like a fruit. |
| `background.jpg` | 1080x2340 (portrait) | no | Backdrop. Scaled to cover the screen (edges cropped; on a wide screen only the middle shows), so keep the middle calm and darkish: bright fruit flies over it. |

Framing
- Square picture, the round body centered and filling ~84% of the square (body circle = 42% of the square from its center; a swipe cuts up to ~44%). Anything outside the square is cut; a non-square picture is fitted inside it.
- Targets and the bomb are drawn about 70-130 px wide on a phone and kept at 256x256 px (larger files are scaled down to that).
- A sliced target splits through its center along the picture's own horizontal line (the halves are prepared once when the game starts), then fly apart along the swipe. A centered, roughly round subject splits best.
- The juice color of each target_N is set in code (`FRUIT_STYLES` in `client/src/games/ninja/art.ts`): red, orange, red, purple, yellow. Change it there if the real pictures want other colors.

Background
- `.jpg` is best (opaque). A `.png` / `.webp` with see-through parts also works (the screen is then cleared behind it every frame, a little slower on old phones).
