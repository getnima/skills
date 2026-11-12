# נינג׳ה תבורי (ninja): art slots

What flies up and gets sliced is Israeli food; what must not be sliced is the two party hosts, one bomb each.
Replace a file here with the same name and the game shows the new picture: no code change.
Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g. `food/pickle.webp`).
A missing file (or one that does not load) falls back to a drawing made by the game. In dev just reload the page; a production build must be re-run.
Every picture in this folder is loaded by the game; nothing else is shipped from here.

Look: the party style of `client/public/assets/shimi/README.md` (flat colours, ink outlines, hard highlights, stickers in the Motaleh font, no soft glows): a cobalt TV-show stage, glossy toy food, a white blade with a yellow edge (pink while a combo is alive, grey while the blade is down), flat splats on the stage (sauce, juice or crumbs, by the food), halves that show the inside of their food.

| File | Size (px) | Transparent | What it is used for |
| --- | --- | --- | --- |
| `food/shawarma.png`, `hummus.png`, `sabich.png`, `falafel.png`, `bourekas.png`, `shakshuka.png`, `schnitzel.png`, `sufganiya.png`, `pickle.png`, `limonana.png`, `peanut_puffs.png` | 384x384 | yes | The 11 things to slice, +10 each. Dealt like a shuffled deck, so a round shows all of them again and again. Details and colours: `food/README.md`. Missing → a flat sticker blob in the food's colour with a little face (it still cuts open to the food's inside). |
| `food/garden_chair.png`, `food/flip_flop.png` | 384x384 | yes | Joke items: about one ordinary target in 16 is the plastic chair or the flip-flop (they take turns). Same +10, same hit circle: a joke for the eyes, not a rule. Missing → a sticker blob. |
| `food/gold_falafel.png` | 384x384 | yes | The rare golden target, +50: the gold falafel trophy. Missing → a gold disc wearing one of three party props from `../shimi/` (`prop_08_crown.png`, `prop_17_party_hat.png`, `prop_09_heart_glasses.png`, picked per throw; fetched only then) → a gold star coin. The game adds a turning sunburst behind it, sparkles, and a coin burst when it is cut. |
| `bombs/bomb_host_a.png`, `bombs/bomb_host_b.png` | 384x384 | yes | The bombs = "us", the hosts: one bomb per host, taking turns (A, B, A, B; which one opens changes from round to round), so both are in every round. Framing: `bombs/README.md`. Do NOT draw a fuse: the game draws the lit fuse and the spark star out of the top of the metal cap, a throbbing red / yellow warning burst behind the bomb and, on the first bomb, a "לא לחתוך!" tag. Missing → a drawn dark bomb with a cap and a generic face (red ring for A, pink for B). |
| `background.jpg` | 1080x2340 (portrait) | no | Backdrop (not in the folder now). Scaled to cover the screen (edges cropped; on a wide screen only the middle shows), so keep the middle calm and darkish: bright food flies over it and splats land on it. Default: the drawn cobalt stage (sunburst, halftone, curtains, string lights). |

Which throw wears which picture is looks only (`client/src/games/ninja/skins.ts`): it is derived from the finished throw schedule, the same on every phone, and never changes what is thrown, when, the hit circle or the score.

Framing of a target (food, joke item, gold)
- Any shape, anywhere on a transparent square. When a picture loads the game finds the smallest circle around its opaque pixels and scales the picture (aspect kept) so that this circle is exactly the hit circle. So a long pickle, a wide plate and a round doughnut all sit inside the same hit circle, each as large as it can be, and none is cut by it. Soft shadows (alpha under about 10%) do not count.
- Drawn about 65-115 px across on a phone, from a sprite pre-rendered about 215 px across and trimmed to the object (so a blit costs what the food covers, not a square box). 384x384 files are plenty.
- A sliced target splits along one straight line through the middle of that circle (the halves are prepared once when the game starts), then the halves fly apart along the swipe. The game paints the cut face on each half where the line crosses the picture, as wide as the food is there.
- How a cut looks is one row per picture: `CUT_LOOKS` in `client/src/games/ninja/art.ts` (ring / band / inside / detail colours, the pattern of the inside, how deep the face is, an optional turn so a long diagonal thing is cut across, and the splash: colours and kind `'juice' | 'sauce' | 'crumbs'`). It drives the halves, the droplets and the splat decals. The colours follow the "Slice colours" table of `food/README.md`. A new picture with a new inside needs its row changed (and a new pattern in `cutFace` when none fits).

Framing of a bomb
- Both bomb pictures share one frame (`BOMB_FRAME` in `art.ts`, numbers in `bombs/README.md`): the black sphere and the top of the metal cap. The game scales the picture so the sphere is the hit circle and starts the fuse at the cap's top. A replacement must keep that frame (or `BOMB_FRAME` must be changed with it).

Background
- `.jpg` is best (opaque). A `.png` / `.webp` with see-through parts also works (the screen is then cleared behind it every frame, a little slower on old phones).

Not slots: the blade, the slash flashes, splats and droplets, the fuse and its spark, the warning burst, the sunburst, the stickers ("+10", "קומבו ×3!", "לא לחתוך!", "בום! הלהב מושבת") are drawn by the game.

Retired: the toy fruit (`target_1..5.png`, `target_gold.png`) and the shared two-host `bomb.png` are no longer loaded and were taken out of this folder.
