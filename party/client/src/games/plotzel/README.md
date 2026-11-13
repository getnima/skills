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
time is up. Every round opens with the owner's four words, in this order, with an easy word on each side of פוקי:
**חמוד, an easy word, פוקי, an easy word, נדיר, שימי** (`OPENERS` and `EASY_AFTER` in `round.ts`).
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

Sequence: the opening is always חמוד (par 3), an easy word (par 2, drawn by the seed), פוקי (par 5), another easy
word, נדיר (par 5), שימי (par 5). פוקי is not in the
dictionary: it still starts a ladder (`startPar` = one more than its best neighbour, `startPath` goes through it),
and its first step must be a real word like any other step. After the openers the start words have a path through
common words as short as par (`CDIST = DIST`), never repeat and are never the demo word or an opener. Par ramp after
the openers: par 2, then 2-3, then 3-4 for four puzzles, then 4-5.

## Scoring (raw, `round.ts` → `ladderScore`)

The owner's rule: **80% time, 20% attempts**. Attempts are the steps taken (the words entered), against the minimum.
A solved ladder is worth at most 1,000 points:

| Part | Points | How |
| --- | --- | --- |
| Speed (80%) | 0 - 800 | 800 at once, running down in a straight line to 0 over 15 s for every step of par (par 2: 30 s, par 3: 45 s, שימי with par 5: 75 s) |
| Steps (20%) | up to 200 | 200 in the minimum number of steps, otherwise 200 x par / steps |
| Skipped ("דלג", after 15 s on the same ladder, confirm tap; shows the shortest path ~2.5 s) | 0 | |

`points = max(1, round(1000 x (0.8 x speed + 0.2 x steps)))`. No points for unsolved progress.

The time of a ladder runs on the round clock (`ctx.timeLeftMs()`): it stands still in a freeze and keeps running
through a reload (the ladder's start is in the snapshot). The first ladder starts with the round. The tray shows
"שווה N": what the ladder is worth if the next word solves it, counting down, so players see that speed matters.

The total is clamped to `GAMES.plotzel.maxRaw` = 30,000. A bot typing shortest paths at 4 keys/s with no mistakes
gets about 17,800 in 120 s (19 ladders, about 935 each; `tests/e2e/plotzel-play.cjs bots`). Because the speed part is
measured in milliseconds, two players with the same raw score are very unlikely.

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
`puzzleIndex`, `solved`, `score`, `worth`, `elapsedMs`, `phase`, `typed`, `skipReady`, `results`, `buildMs`,
`path()` (shortest path from the current word, as shown), `sequence(n)` (the first n start words).
Keys carry `data-k` like the original (letters including finals, `BACK`, `ENTER`); tools
`data-act="skip"`. Dev harness: `/dev.html?game=plotzel&seed=1`.
