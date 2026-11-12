# שימי טאפ (tap)

The opening game: a 20-second sprint of tapping Shimi while he picks his nose. The faster you tap, the further
his hand rises and the deeper the finger goes. Art slots and how to replace a picture:
`client/public/assets/tap/README.md`.

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

## The picking (the show, all in `index.ts`; it never changes the score)

The doll's picture is a **clip**: 40 frames of one image-to-video take (the hand rises from below, the index
finger slides into the nostril, the eyes close in bliss and roll up, the head tilts back a little), all in the
one head framing (`art.ts`: `CLIP_SRC`, `CLIP_KEYS`). One continuous state drives it, stepped at the fixed
60 Hz step:

- **depth d** (0 the hand is down out of sight, 0.35 the fingertip at the nostril, 0.62 in to the knuckle,
  0.82 eyes shut, 1 eyes rolled up) follows the engine's smoothed tap rate (`D_RATE`: 1.5/s ≈ 0.26, 3/s ≈ 0.5,
  5/s ≈ 0.8, 8/s ≈ 0.94, 11/s and up 1) through a critically damped spring, never faster than `D_MAX_V`;
- **every counted tap is a jab**: a kick on a stiff spring, about 2.5 clip frames inward, back in ~150 ms;
- **while deep the finger digs**: the clip rocks a few frames and the head turns ~2.4° about the nostril;
- d is mapped to a clip position and the two nearest frames are crossfaded, so the motion never steps; when the
  player stops, the hand eases out and drops. The last 5 s keep the finger at least at the knuckle.

Still faces are crossfaded over the clip in 0.14 s (`FADE_S`); a face without the hand (the whistle, the
yawn...) waits until the clip's hand is down (it pulls it down), so no ghost hand ever shows. Only the camera
flash of the first tap and the final frame change the picture at once, under a white flash. The picture is
blended at the frames' own size into one canvas only when it changed, so the screen gets one scaled draw per
frame. `tests/e2e/qa-tap-fluent.cjs` checks all of this per rendered frame.

| When | What |
| --- | --- |
| Waiting, every 3.3 s | One of four bits, all four before any repeats (`schedule.ts`): the sneak (the hand sneaks up, caught by your stare, "לא ראית כלום." / "זה לא מה שנראה. זה פילאטיס.", the hand drops, he whistles), the yawn ("נו? יש לי הופעה בבת ים."), the knock (fist, glass cracks, face pressed to the glass, "טוק טוק. יש פה מישהו?"), dozing off ("רק עצמתי עיניים."). Between bits a white hand taps the glass: "הקישו כדי להתחיל!" |
| Last 5 s of the wait | Red star digits 5..1, faces get impatient, at 2 and 1 his hand starts up by itself, at 2 "טוב. אני מתחיל לבד."; at 0 the auto-start: the finger goes in, "התחלתי בלעדיך. נודר." |
| First tap | Paparazzi flash, caught with the finger at the nostril, "קליק!", then "צלמו מהצד הטוב." and he carries on |
| 8 / 18 / 28 / 40 / 54 / 68 / 84 / 120 / 150 taps | A line each, with stars from the nostril and a pop of the token: "צדיק!", "כורה ביטקוין מחולון.", "מחורחר!", "ארכיאולוג. של רשות העתיקות.", "בן פורת יוסף!", "חופר כמו בקו האדום.", "וואו!", "מנהרות הכרמל. בלי אגרה.", "אחשילי." A line stays at least 0.9 s. |
| Top speed (8/s) held 1.5 s | Speed lines and a tiny shake; "סגרתי קיסריה.", the next time "נודר." |
| He slows down | The hand drops, he whistles innocently: "לא אני." (1st, 3rd, 5th time); the next tap and he is back at it |
| Slow player, 1.6 s without a line | Up to three lines, once each: "לאט. / כמו ספא בים המלח.", "צדיק! / אייקונים לא ממהרים.", "קצב של שישי בצהריים. / מי ממהר." |
| Last 5 s of the sprint | Red star digits 5..1 ("תן הכול!"), the finger stays in, the head rocks harder, a red frame pulses. A milestone here is stars and a pop. |
| Final frame | A picture per rank under a white flash (under 70 the proud face, 70-129 the finger in, 130-189 eyes shut in bliss, 190+ both hands), the count on a red star, the rank and its line on top: "חוטט מתחיל. / גם ביונסה התחילה ככה.", "חוטט מוסמך. / תעודה ממוסגרת בסלון.", "דוקטור לחטטנות. / מרצה אורח בטכניון.", "האף של המדינה. / מחר בכל המהדורות.", and "תראו לשכן. מחכים לכולם." One small alive gag every 2 s (a nod, a little dig, a bounce). The stage does not cover it (`ownsFinalScreen`). |

## Where to change things

- **A line**: the `W` object at the top of `index.ts` (the Hebrew words, in the order they appear). Stickers
  are pre-rendered once in `create()` (`renderSticker` / `renderChip`). The voice: `design/punchlines.he.md`.
- **A rule or a threshold**: `TAP` in `pick.ts` (window / sprint shares, the cap, the hand-level thresholds,
  `MILESTONES` for the lines, `RANKS` for the final ranks). Milestones and ranks are written for a 20 s
  sprint and scaled for test rounds. Run `npx vitest run tests/unit/tap-pick.test.ts` after a change.
- **How the picking moves**: the tuning block at the top of `index.ts` (`D_RATE`, `D_FOLLOW`, `D_MAX_V`, the
  jab, the dig, `FADE_S`, `FINAL_D`). The clip itself: `art.ts` (`CLIP_SRC`, `CLIP_KEYS`).
- **Seeded order** (the waiting bits, the slow-player lines, the final gags): `schedule.ts`.
- **Art**: `art.ts` lists every slot; the head framing is `FRAME_SCALE` / `FRAME_TOP` / `MASK_R`.

## Checks

`tests/unit/tap-pick.test.ts` (the engine, the schedule, the clip map). Browser scripts, with vite on `QA_BASE`
(HMR off: `tests/e2e/qa-icy-vite.config.mjs`): `qa-tap-fluent.cjs` (no pops, the depth follows the rate, the
strip and the 4 s recording; `qa-tap-fluent-strip.py` composes them), `qa-tap-comedy-play.cjs` (scripted players
and the round format), `qa-tap-stage.cjs` (final frame not covered, crash overlay, reload), `qa-tap-stamp.cjs` (a
throttled phone loses no honest taps), `qa-tap-comedy-determinism.cjs` (scores = replay through pick.ts at three
sizes and 20 fps), `qa-tap-comedy-freeze.cjs`, `qa-tap-comedy-boundary.cjs`, `qa-tap-comedy-cycles.cjs`,
`qa-tap-layout.cjs`, `qa-tap-comedy-perf.cjs`, `qa-tap-comedy-shots.cjs` + `qa-tap-comedy-storyboard.py`,
`qa-tap-film.cjs` (a frame every 400 ms of a whole round, contact sheets). `window.__tap()` is the read-only
state for tests (`depth`, `clip`, `frame`, `still`, `sticker` among others).
