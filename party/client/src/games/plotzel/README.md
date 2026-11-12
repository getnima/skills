# Plotzel (פלוצל)

Hebrew five-letter word game, about 120 s. Two implementations behind one switch.

## The switch (`config.ts`)

| Where            | How                                                                 |
| ---------------- | ------------------------------------------------------------------- |
| this page load   | `?plotzel=builtin` or `?plotzel=embed`, `?plotzelUrl=https://...`   |
| build time       | `VITE_PLOTZEL_MODE=builtin` / `embed`, `VITE_PLOTZEL_URL=https://...` |
| default          | `embed`, `https://plotzel.netlify.app`                              |

The page-load param wins over the build-time variable. If the owner's site turns out
not to work on phones, build with `VITE_PLOTZEL_MODE=builtin`.

## embed (`embed.ts`)

The owner's site in an iframe under the HUD, with `seed`, `embed=1`, `lang=he` and
`parentOrigin` added to its URL. Sandbox `allow-scripts allow-same-origin allow-forms`:
no top navigation, no popups / new tabs, no `alert()` (it would freeze the phone).
Score sources, in order:

1. the postMessage bridge (`bridge.ts`, contract in `client/public/plotzel-bridge/README.md`):
   only from the iframe window and its origin, every field validated; `tries` wins over a
   site-made `score`;
2. otherwise our self-report bar "פתרתם? בכמה ניסיונות?" (1-6 / "לא הצלחתי"): the first tap
   arms ("לאישור הקישו שוב על 3"), the second confirms. After a report the bar stays open
   8 s of round time for a correction ("טעות? אפשר לתקן (8)"; each correction restarts it,
   a correction keeps the solve moment), then the player is finished, so the round can
   still end early. Nothing reported = 0. The bar hides for good on the first bridge message.

Safety net: until the first bridge message (the only sign of life we can see; a page blocked
by X-Frame-Options / CSP, or the browser's error page, looks loaded) the bar carries
"לא נטען? לשחק כאן ▶": one tap = the builtin game for the rest of the round, from the first
second; after 10 s with no sign of life and no tap into the frame it pulses. It is gone once
the player self-reported (nobody scores twice). No load event in 6 s shows "פלוצל נטען לאט…"
(play here / keep waiting; a late load hides it by itself); an unreachable site shows
"פלוצל לא נטען" (play here / retry). While the round is frozen an opaque cover hides the
iframe. A native keyboard over the site (viewport shrinks while the frame has focus) hides
the bar so the site keeps the room.

`memory.ts` keeps, per round seed in sessionStorage, the builtin switch, the self-report and
the builtin rows, so a reload / remount mid-round resumes where the player was.

## builtin (`builtin.ts`)

DOM grid 6 x 5 + on-screen Hebrew keyboard (22 base letters, "שלח", delete), no
native keyboard. Phones >= ~410 px get the phone keyboard's 3 rows; narrower ones the same
order wrapped at 7 keys (4 rows) so every key is at least 40 x 48 px on a 320 x 568 phone.
Final forms are normalised for comparison and displayed in the last position. Any five
letters are accepted as a guess (no dictionary, deliberate). Count-based duplicate rules
(`logic.ts`). The word comes from `words.ts` by `ctx.seed` (spelling rules in its header).
Every timer and animation runs on the kit loop, so a freeze stops it; the next row is typable
1.3 s after Enter.

Scores (`logic.ts`, the same for builtin, bridge and self-report): solved on try n =
`1000 - (n-1)*100 + round(500 * timeLeft / duration)` (500..1500, maxRaw is 2000); a
self-report is timed at its first tap + 2 s; a finished fail = best row's
`greens*60 + yellows*20`, at least 100 (max 300, always below any solve); unfinished at
time-up = best row without the minimum.

## Checks

- `npx tsx client/src/games/plotzel/check-words.ts` validates the word list, 24 hand-checked
  colouring cases and the score rules.
- `node tests/e2e/qa-plotzel-play.cjs` (vite :5223 + `tests/e2e/fixtures/plotzel-standin.cjs` on
  :5233) plays every embed failure (XFO, CSP, hang, slow, tall, native keyboard, alert / top
  navigation / popup), the self-report bar, reload resume and the builtin on 9 phone sizes.
- `node tests/e2e/qa-plotzel-flow.cjs` (plus the server on :8823): TV + 3 phones, all solve,
  the round ends early.
- `node tests/e2e/plotzel-play.cjs` (vite on :5214) plays both modes on iPhone 14 / Pixel 7.
- `client/public/plotzel-bridge/mock.html` is a stand-in for the owner's site.

Art slots: `client/public/assets/plotzel/README.md`.
