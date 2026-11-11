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
`parentOrigin` added to its URL. Score sources, in order:

1. the postMessage bridge (`bridge.ts`, contract in `client/public/plotzel-bridge/README.md`):
   only from the iframe window and its origin, every field validated;
2. otherwise our self-report bar "פתרתי! בכמה ניסיונות?" (1-6 / "לא הצלחתי",
   confirm with a second tap). It hides for good on the first bridge message.

No load signal in 6 s, or the site is unreachable: a notice offers "לשחק כאן" =
switch this player to the builtin game for the rest of the round. A site that
"loads" an error page (e.g. a blocked network) cannot be told apart from a real
page, so the bar also has a "לא נטען? משחק חלופי" link to the same notice.
While the round is frozen an opaque cover hides the iframe.

## builtin (`builtin.ts`)

DOM grid 6 x 5 + on-screen Hebrew keyboard (22 base letters, "שלח", delete), no
native keyboard. Final forms are normalised for comparison and displayed in the last
position. Count-based duplicate rules (`logic.ts`). The word comes from `words.ts`
by `ctx.seed`. Every timer and animation runs on the kit loop, so a freeze stops it.

Scores (`logic.ts`, also used by embed): solved on try n =
`1000 - (n-1)*100 + round(500 * timeLeft / duration)`; unsolved = best row's
`greens*60 + yellows*20` (max 300).

## Checks

- `npx tsx client/src/games/plotzel/check-words.ts` validates the word list and rules.
- `node tests/e2e/plotzel-play.cjs` (vite on :5214) plays both modes on iPhone 14 / Pixel 7.
- `client/public/plotzel-bridge/mock.html` is a stand-in for the owner's site.

Art slots: `client/public/assets/plotzel/README.md`.
