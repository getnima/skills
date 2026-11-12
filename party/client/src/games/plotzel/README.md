# פלוצל (Plotzel): the word ladder

A native port of the owner's game. `original/plotzel.netlify.app.html` is the owner's complete
source (CSS, markup, JS, packed dictionary), kept untouched for reference: when in doubt about a
rule, that file wins.

## The game

From a start word reach **פלוץ**. Every step changes exactly one letter and must be a dictionary
word (4 letters; final letters are typed or not, they normalise). Green tile = the letter is
already in its place in פלוץ; red underline = the letter changed in that step. **Par** ("מינימום N")
is the true minimum number of steps (BFS over the whole dictionary).

A party round (120 s, `GAMES.plotzel`) is a **sequence** of ladders, the same on every phone
(derived only from the round seed). Solve one, a short celebration, the next slides in, until
time is up. Every round opens with **שימי → פלוץ** (the owner's rule, `OPENER` in `round.ts`).
There are **no hints** (the owner's rule: the original's hint button is removed). Skip as in the original.

## Where each rule lives

| What | File |
| --- | --- |
| Words: the original's `DATA` (dict 22468, common 8999, starts 599), verbatim | `data.ts` |
| `unpack`, `norm`, `disp` (finals), `neighbors`, BFS `DIST` / `CDIST` (common words only), `bestNext`, `shortestPath`, `diffCount`, `diffPos`, step check + Hebrew rejection messages (`checkStep`) | `ladder.ts` (pure; the graph is built once, ~10-40 ms on a phone, ~75-125 ms with a 4x throttled CPU, during the countdown) |
| The round sequence (seeded, par ramp) and the scoring table | `round.ts` (pure) |
| Screen, keyboard, skip, celebration, freeze, the test hook | `index.ts` |
| Reload resume (sessionStorage, keyed by seed) | `snapshot.ts` |
| Art slots | `art.ts`, files in `client/public/assets/plotzel/` |
| Look | `plotzel.css` |
| Tests | `tests/unit/plotzel-ladder.test.ts`, `tests/e2e/plotzel-play.cjs` |

Rejections, in the original's order and words: fewer than 4 letters `צריך 4 אותיות`; same word
`זו אותה מילה`; more than one letter changed `משנים רק אות אחת בכל צעד`; not a word
`X לא נמצאת במילון`; already used `כבר השתמשתם בX`. A rejected word stays in the row (as in the
original): ⌫ to fix it.

Sequence: puzzle 1 is always שימי. It is a hard one: par 5 (שימי → שימת → שלמת → שלות → פלות → פלוץ),
and 6 steps when only common words are used. After it the start words have a path through common
words as short as par (`CDIST = DIST`), never repeat and are never the demo word or שימי. Par ramp
after the opener: puzzle 2 par 2, puzzle 3 par 2-3, puzzles 4-7 par 3-4, then par 4-5. Par 3-5 come from the original's curated starts, par 2 from common words (rank
≤ 3400). About 420 ladders per seed: `ctx.finish()` only if they all run out.

## Scoring (raw, `round.ts` → `ladderScore`)

| Ladder | Points |
| --- | --- |
| Solved | 300 |
| ... in exactly par steps ("מושלם") | +100 |
| ... in par + 1 steps | +50 |
| Skipped ("דלג", after 15 s on the same ladder, confirm tap; shows the shortest path ~2.5 s) | 0 |

No points for unsolved progress. The total is clamped to `GAMES.plotzel.maxRaw` = 12,000: 1.5x the
best 120 s score of a bot typing shortest paths at 4 keys/s with no mistakes (7,600-8,000, 19-20
ladders, measured on six phone sizes by `tests/e2e/plotzel-play.cjs bots`).

## Freeze and reload

All timers (toasts, the skip unlock, the celebration and reveal delays, the demo) are kit loop
timers and all motion is CSS animations, which `setPaused` freezes with `.pz.is-paused`; keys do
nothing while frozen. A reload mid-round restores the puzzle, its words, score and results
for the same seed.

## Restyling

`plotzel.css` holds everything, scoped under `.pz`. The colours at its top are the party design
system's (`client/public/assets/shimi/README.md`) as `--pz-*` variables, plus `--pz-green` for hit
tiles; fonts `--pz-disp` (Motaleh, `/fonts/motaleh.woff2`, Hebrew + digits only) and `--pz-ui`.
Sizes (`--tile`, `--key-h`, `--key-gap`, ...) are set by `layout()` in `index.ts` from the screen;
tiles, keys and chips have fixed heights so the font loading never moves anything. Art slots
(`client/public/assets/plotzel/README.md`): `background`, `puff` (replaces the 💨), `mascot`
(defaults to `/assets/shimi/head.png`).

## Test hook

`window.__plotzel` (read-only, removed on destroy): `start`, `target`, `par`, `words`,
`puzzleIndex`, `solved`, `score`, `phase`, `typed`, `skipReady`, `results`, `buildMs`,
`path()` (shortest path from the current word, as shown), `sequence(n)` (the first n start words).
Keys carry `data-k` like the original (letters including finals, `BACK`, `ENTER`); tools
`data-act="skip"`. Dev harness: `/dev.html?game=plotzel&seed=1`.
