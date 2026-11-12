# שימי טאפ (tap)

The opening game: a 20-second sprint of tapping Shimi while he picks his nose. Art slots and how to replace a
picture: `client/public/assets/tap/README.md`.

## The rules (all in `pick.ts`, a pure engine, unit-tested in `tests/unit/tap-pick.test.ts`)

- The round is `ctx.durationMs` (53 000 in production, `GAMES.tap` in `shared/protocol.ts`):
  a start window of 30/53 (30 s), a personal sprint of 20/53 (20 s), and 3/53 (3 s) of hold, so a player who
  starts at the very end of the window still sees the final frame. Test rounds scale (`tapTiming`).
- The player's first touch starts the sprint and is tap #1. No touch: the sprint starts by itself when the
  window runs out. A phone that joins after the window starts at once and is cut at the round end.
- A touch counts when `t0 <= t < t0 + sprint`. At the end: `ctx.setScore(final)`, `ctx.finish()` once.
- **Score = counted taps.** Every finger of a touch anywhere below the HUD counts; a held finger counts once;
  touches during a freeze count for nothing.
- Anti-mash cap: 12 counted taps per second (token bucket, depth 3) and 25 ms between taps, so at most 243 in a
  sprint. Two honest thumbs at 11-12/s are never capped; drumming five fingers reaches the cap and so can at
  best tie a 12/s two-thumb tapper. (`GAMES.tap.maxRaw` is 300, above the cap.)
- A touch is stamped with the round time when the finger landed (`PointerEvent.timeStamp`, kept by a capture
  listener on the game root), not when a busy phone got round to handling it.
- A reload mid-round does not give a second try: the sprint (start, taps, done) is kept in `sessionStorage`
  per round (seed + duration); after a reload the same sprint continues, or the final frame comes back.
- Scripted: slow 3/s ≈ 61, normal 6/s ≈ 122, fast 11/s ≈ 221, the cap 243.

## The ladder (the show, all in `index.ts`; it never changes the score)

| When | What |
| --- | --- |
| Waiting, every 3.3 s | One of five bits, all five before any repeats (`schedule.ts`): the sneak (caught, "לא ראית כלום."), the yawn ("נו? יש לי הופעה בבת ים."), the knock (fist, glass cracks, face pressed to the glass, "טוק טוק. יש פה מישהו?"), dozing off ("רק עצמתי עיניים."), the shy booger ("ששש. הוא ביישן."). Between bits a toy finger pokes his nose: "הקישו כדי להתחיל!" |
| Last 5 s of the wait | Red star digits 5..1 in the sticker band, faces get impatient, his finger goes in by itself; at 2 "טוב. אני מתחיל לבד."; at 0 the auto-start "התחלתי בלעדיך. נודר." |
| First tap | Paparazzi flash, caught face, "קליק!", then the shrug "כן, ו?" |
| 8 / 18 / 28 / 40 | Yossi / the rope ("מחורחר!") / out of the ear ("יצא מהצד השני. נודר.") / mini Shimi ("שימי בתוך שימי. אחשילי.") |
| 54 / 68 / 84 | The sneeze ("אפצ׳י!", "לבריאות לי.") / the squeegee ("ניקיתי. בערך.") / the king ("בן פורת יוסף!") |
| 120 / 150 | The bobble spin ("סיבוב חינם. לונה פארק.") / the cork ("פקק באיילון. סוף סוף משהו זז.") |
| Last 5 s of the sprint | No new set piece. Red star digits 5..1 ("תן הכול!"), the strand to his chin, one last booger grows on his fingertip with every tap, the head bobs harder. A milestone reached here is a burst of stars and a bigger booger. |
| Final frame | The last booger lands on his head (the crowned king at 190+), a trophy face per rank (under 70 bored, 70-129 knuckle, 130-189 the long strand, 190+ both fingers), the count on a red star, the rank above: "חוטט מתלמד." / "חוטט מוסמך." / "דוקטור לחטטנות." / "האף של המדינה.", and "תראו לשכן. מחכים לכולם." One small alive gag every 2 s. The stage does not cover it (`ownsFinalScreen`). |

Continuous: the hand level follows the smoothed tap rate (0.8 / 1.8 / 2.8 / 5 / 8 taps/s): L1 the hand climbs,
L2 finger at the nostril, L3 to the knuckle, L4 deep with the head thrown back, L5 both fingers with speed
lines and steam ("דאבל. כמו בטוטו.", then "וואו!"). A slowdown triggers the innocence gag ("לא אני."). Slow
players get up to three fillers. A booger drips every 6 taps (every 3 in the last 5 s), at most 6 on the glass,
never over his head; they pile up under the token with name chips on fixed slots (יוסי, מוטי, ציפי, אבי,
שימי הקטן, מלך הנזלת). The golden booger shows once, seeded.

## Where to change things

- **A line**: the `W` object at the top of `index.ts` (the Hebrew words, in the order they appear). Stickers
  are pre-rendered once in `create()` (`renderSticker` / `renderChip`); a line with a `...Sub` partner is drawn
  as a sticker with a second, smaller line.
- **A rule or a threshold**: `TAP` in `pick.ts` (window / sprint shares, the cap, the hand-level thresholds,
  `MILESTONES` for the set pieces, `RANKS` for the final ranks). Milestones and ranks are written for a 20 s
  sprint and scaled for test rounds. Run `npx vitest run tests/unit/tap-pick.test.ts` after a change.
- **Seeded order** (drip kinds, the golden drip, the waiting bits, fillers, final gags): `schedule.ts`.
- **Sizes and timings of the show**: the tuning block at the top of `index.ts` (live boogers, decals, booger
  sizes, the last-5 booger, the final-frame gag interval).
- **Art**: `art.ts` lists every slot; geometry of the head frames is `FRAME_SCALE` / `FRAME_TOP` / `MASK_R`.

## Checks

`tests/unit/tap-pick.test.ts` (the engine). Browser scripts, with vite on `QA_BASE` (HMR off:
`tests/e2e/qa-icy-vite.config.mjs`): `qa-tap-comedy-play.cjs` (scripted players and the round format),
`qa-tap-stage.cjs` (final frame not covered, crash overlay, reload), `qa-tap-stamp.cjs` (a throttled phone
loses no honest taps), `qa-tap-comedy-determinism.cjs` (scores = replay through pick.ts at three sizes and
20 fps), `qa-tap-comedy-freeze.cjs`, `qa-tap-comedy-boundary.cjs`, `qa-tap-comedy-cycles.cjs`,
`qa-tap-layout.cjs`, `qa-tap-comedy-perf.cjs`, `qa-tap-comedy-shots.cjs` + `qa-tap-comedy-storyboard.py`,
`qa-tap-film.cjs` (a frame every 400 ms of a whole round, contact sheets). `window.__tap()` is the read-only
state for tests.
