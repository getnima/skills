# Intro key art

One picture per game, plus one for the show itself. They replace the emoji on the game's TV intro scene, on the phone's intro screen and on the game cards in the TV lobby.
Each one is Shimi, the glossy vinyl toy figurine from `../shimi/`, photographed like a product and cut out on transparency. The app places it on its own flat comic background (cobalt, sunburst yellow, red, pink: see `../shimi/README.md`).
Every picture is one scene, composed to read at about 200 px on a phone and 500 px on a TV. None has a background, text, letters or logos.

| File | Game | What it shows | Pixels | Weight |
| --- | --- | --- | --- | --- |
| `show.webp` | the show (lobby, the show's own intro) | Shimi as the game-show host in a sparkly pink sequin jacket, yellow bow tie and red shoes: one arm up, mic at his chin, shouting "welcome to the show!" | 415 x 768 | 58 KB |
| `tap.webp` | שימי טאפ (tap) | Shimi sitting like a baby doll in a blue onesie, finger up his nose, eyes rolled up in bliss (made with a frame of the game's picking clip as the reference) | 435 x 768 | 40 KB |
| `icy.webp` | אייסי שימי (tower climb) | Shimi in the climber's outfit from `../icy/hero/` (red puffer, yellow scarf and mittens, blue trousers, white boots) leaping between two snowy stone-brick ledges with icicles | 647 x 768 | 55 KB |
| `flappy.webp` | פלאפי תבורי (flying) | Shimi's head with white angel wings and a golden halo, flying past a giant silver stage microphone | 739 x 768 | 72 KB |
| `plotzel.webp` | פלוצל (word ladder) | Shimi sitting proudly on a stack of five blank letter cubes, hands on hips, a smiling mint puff cloud coming out behind him (the cubes are blank on purpose: no letters) | 496 x 768 | 44 KB |
| `ninja.webp` | נינג׳ה תבורי (slicing) | Shimi in a black ninja suit and red headband slashing a toy katana through a falafel pita in mid-air, with the halves, falafel balls and crumbs flying | 768 x 735 | 73 KB |

All six are WebP with alpha (quality 86), longest side 768 px, trimmed to the subject with a 2 px transparent margin. They are not square: the screen fits each one into its box with the aspect ratio kept.

## Replacing a picture

- Drop a new file here with the same base name: `tap.webp`, `icy.webp`, `flappy.webp`, `plotzel.webp`, `ninja.webp` or `show.webp`. Any of `.webp`, `.png`, `.jpg`, `.jpeg`, `.svg` works, but the base name is what counts.
- `<name>.webp` wins whenever it exists. So to use a PNG, delete `tap.webp` and add `tap.png`; adding the PNG next to the WebP changes nothing.
- Use a transparent cut-out, longest side about 768 px, with the subject filling the picture (no wide empty margins: the picture is fitted by its box). Keep it under about 160 KB; WebP with alpha is the smallest.
- The list of files is taken when the dev server starts and when the app is built (`client/src/kit/files.ts`). In dev, reload the page after adding a file. For production, re-run the build.

## A missing picture

A missing file (or one that fails to load) is never an error: that screen shows the game's emoji on a star sticker instead (👆 tap, 🧊 icy, 🐤 flappy, 💨 plotzel, 🗡️ ninja, 🎤 the show), laid out in the same box. Nothing is requested for a file that is not there.

## How they were made

Generated one picture at a time (Higgsfield, Nano Banana 2.1), with `../shimi/doll.png` and `../shimi/head.png` as the character reference; `icy.webp` also used the climber sprite `../icy/hero/jump.webp` so the two match. Each was asked for as a product photo of a vinyl toy diorama on a plain light-grey studio backdrop, then cut out.
Cut-outs: all six were cut locally with `tests/e2e/intro-art-cut.py` (a backdrop model fitted to the frame plus a flatness test, so silver mesh and white wings survive). `tests/e2e/intro-art-icy-compose.py` moved the two ledges of `icy.webp` closer to the climber. `tests/e2e/intro-art-pack.py` trims, resizes and saves the WebP. Contact sheet (every picture at 96, 200 and 480 px on cobalt and on yellow): `tests/e2e/intro-art-sheet.py client/public/assets/intro tests/e2e/out/intro-art/sheet.png`.
