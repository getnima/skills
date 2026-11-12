# Designed QR codes (Shimi's face in the code)

`qrocodile.cjs` drives [QRocodile](https://qrocodile.io) (a free in-browser QR designer; the code is rendered on this
machine by their page) in a headless browser, downloads the PNG and checks that it really decodes back to the link
(scaled down to 600, 420 and 260 px, the way a phone sees a code on the TV).

One-time: `cd tools/qr && npm install` (one small decoder package). Playwright is expected on the machine.

## The party QR (do this after the deploy, when the real address is known)

The picture is fixed, so it encodes a link that never changes: `https://<host>/j`. The server redirects `/j` to the
room that is on the TV right now (`server/app.ts`).

```bash
HOST=https://your-host.example            # the address guests open, no trailing slash
node tools/qr/qrocodile.cjs --url $HOST/j --photo tools/qr/art/shimi-sun.png --out client/public/assets/host/qr.png
echo "{ \"url\": \"$HOST/j\" }" > client/public/assets/host/qr.json
npm run build                              # the TV shows qr.png only when qr.json's url is exactly <its own origin>/j
```

If the command prints FAIL, do not ship that picture: the TV then keeps its own generated code.

## Looks (`tools/qr/art/`)

| File | Look |
| --- | --- |
| `shimi-sun.png` | A: the head on the yellow sunburst, ink dots |
| `shimi-cobalt.png` | B: the head on cobalt, use `--color "#FFF8E6"` |
| `shimi-doll-pink.png` | C: the whole doll on pink |
| `shimi-paper.png` | D: the head on paper, use `--color "#10238C" --shape square` |
| `logo.png` | the head on a paper disc, for `--preset "<name>" --logo` (styled mode) |

Styled presets with a logo in the middle passed QRocodile's own scan check but not this tool's stricter decode
check, so the photo looks above are the ones to use.
