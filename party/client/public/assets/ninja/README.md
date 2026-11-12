# נינג׳ה תבורי (ninja): art slots

Drop a file here with the name below and it replaces the default: no code change.
Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g. `target_3.webp`).
A missing file always falls back to the default. In dev just reload the page; a production build must be re-run.

Look: the party style of `client/public/assets/shimi/README.md` (flat colours, ink outlines, hard highlights, stickers in the Motaleh font, no soft glows): a cobalt TV-show stage, bright fruit, a white blade with a yellow edge (pink while a combo is alive, grey while the blade is down), flat juice splats on the stage, halves that show their juicy inside.

| File | Size (px) | Transparent | What it is used for |
| --- | --- | --- | --- |
| `target_1.png` | 256x256 | yes | Thing to slice no. 1, +10. **Now: a toy-figurine watermelon** (drawn fallback: a smiling cartoon watermelon). |
| `target_2.png` | 256x256 | yes | Thing to slice no. 2, +10. **Now: an orange** (fallback: a cartoon orange). |
| `target_3.png` | 256x256 | yes | Thing to slice no. 3, +10. **Now: a lemon** (fallback: a cartoon apple). |
| `target_4.png` | 256x256 | yes | Thing to slice no. 4, +10. **Now: a pomegranate** (fallback: a cartoon plum). |
| `target_5.png` | 256x256 | yes | Thing to slice no. 5, +10. **Now: a strawberry** (fallback: a cartoon lemon). |
| `target_gold.png` | 256x256 | yes | The rare golden target, +50. **Now: a gold strawberry.** Missing → a gold disc wearing one of three party props from `../shimi/` (`prop_08_crown.png`, `prop_17_party_hat.png`, `prop_09_heart_glasses.png`, picked per throw; fetched only then) → a gold star coin. The game adds a turning sunburst behind it, sparkles, and a coin burst when it is cut. |
| `bomb.png` | 256x256 | yes | The bomb = "us", the hosts: a round dark bomb with the faces in the middle. **Now: the two hosts' doll heads on a dark round bomb** (fallback: a cartoon bomb with a generic face). Do NOT draw a fuse: the game draws the cap, the lit fuse and the spark star on top (up and to the right of the body), plus a throbbing red / yellow warning burst behind it and, on the first bomb, a "לא לחתוך!" tag. Keep it dark and round so it never looks like a fruit. |
| `background.jpg` | 1080x2340 (portrait) | no | Backdrop. Scaled to cover the screen (edges cropped; on a wide screen only the middle shows), so keep the middle calm and darkish: bright fruit flies over it and juice splats land on it. Default: the drawn cobalt stage (sunburst, halftone, curtains, string lights). |

Framing
- Square picture, the round body centered and filling ~84% of the square (body circle = 42% of the square from its center; a swipe cuts up to ~44%, and the game draws the picture just as big: 44%). Anything outside the square is cut; a non-square picture is fitted inside it.
- Targets and the bomb are drawn about 70-130 px wide on a phone and kept at 256x256 px (larger files are scaled down to that).
- A sliced target splits through its center along the picture's own horizontal line (the halves are prepared once when the game starts), then fly apart along the swipe. The game paints the cut face on each half (rind, flesh and seeds / segments / stone / a gold star, by the target's style). A centered, roughly round subject splits best.
- How a cut looks is one table per slot: `CUT_LOOKS` in `client/src/games/ninja/art.ts` (slot → cut-face ring / band / inside / detail colours and pattern, splash colour, splash kind `'juice' | 'sauce' | 'crumbs'`). It is used by the halves, the droplets and the splat decals, and matches the files now in this folder: red melon with black seeds, orange segments, lemon segments, pomegranate arils, strawberry with a pale heart, gold. Swapping the pictures (e.g. to food: hummus = `'sauce'`, falafel = `'crumbs'` with `'speckles'`, sabich = `'layers'`) means changing only that table. A missing file uses its fallback drawing with `CUT_LOOKS_DRAWN`.

Background
- `.jpg` is best (opaque). A `.png` / `.webp` with see-through parts also works (the screen is then cleared behind it every frame, a little slower on old phones).

Not slots: the blade, the slash flashes, juice splats and droplets, the warning burst, the sunburst, the stickers ("+10", "קומבו ×3!", "בום! הלהב מושבת") are drawn by the game.
