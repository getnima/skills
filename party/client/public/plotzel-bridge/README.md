# Plotzel bridge: let the party read your score

Party Arena shows https://plotzel.netlify.app inside an iframe on every guest's phone.
Without help it cannot see the score, so guests type "solved in N tries" themselves.
Add the snippet below to the Plotzel site and the score flows in by itself (and that
self-report bar disappears).

## 1. Paste this into the Plotzel page (before your game script)

```html
<script>
(function () {
  var q = new URLSearchParams(location.search);
  if (q.get('embed') !== '1' || window.parent === window) return;
  var target = q.get('parentOrigin') || (document.referrer ? new URL(document.referrer).origin : '');
  if (!/^https?:\/\//.test(target)) return;
  window.plotzelBridge = function (type, data) {
    window.parent.postMessage(Object.assign({ source: 'plotzel', type: type }, data || {}), target);
  };
  window.plotzelBridge('progress', { greens: 0, yellows: 0 });
})();
</script>
```

It does nothing when the site is opened normally: only inside the party (`?embed=1`,
in an iframe). Messages go only to the party's own origin (`parentOrigin`, which the
party puts in the URL), never to `*`.

## 2. Call it from your game (three lines)

```js
// after every guess that is not the answer (greens/yellows = colors of THAT row)
window.plotzelBridge && plotzelBridge('progress', { tries: 2, greens: 3, yellows: 1 });
// solved on try N
window.plotzelBridge && plotzelBridge('solved', { tries: 3 });
// out of tries: the best row's colors
window.plotzelBridge && plotzelBridge('failed', { greens: 3, yellows: 1 });
```

Rules the party checks (anything else is ignored): `source: 'plotzel'`, `type` is
`progress` / `solved` / `failed`, `tries` an integer 1-6, `greens` and `yellows`
integers 0-5 with greens + yellows <= 5, optional `score` 0-1500 (if you send `score`
with `solved`, it is used instead of the party's formula).

Party scoring: solved on try N = 1000 - (N-1) x 100 + up to 500 for time left;
not solved = best row's greens x 60 + yellows x 20 (max 300).

## 3. Same word for everyone: read the seed

The party adds `?seed=<integer>&embed=1&lang=he&parentOrigin=...` to the URL. Every
phone in a round gets the same seed. Pick the word from it instead of the date:

```js
var seed = Number(new URLSearchParams(location.search).get('seed'));
var word = Number.isFinite(seed) ? WORDS[Math.abs(Math.floor(seed)) % WORDS.length] : wordOfTheDay();
```

(`WORDS` is your answer list; keep its order fixed so all phones agree.)

## 4. Allow being framed

The site must not send `X-Frame-Options: DENY` / `SAMEORIGIN` or a CSP
`frame-ancestors` that excludes the party. Netlify does not by default; if a
`_headers` file adds them, remove them for `/`.

## Testing without the real site

`mock.html` in this folder is a stand-in that already contains the snippet above:
open the party harness with
`/dev.html?game=plotzel&plotzelUrl=http://127.0.0.1:5173/plotzel-bridge/mock.html`
(add `?bridge=0` to the mock URL for a site without the snippet).
