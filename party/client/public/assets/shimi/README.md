# Shimi assets and the party design system

Source: the owner's house-warming page, https://albert-14-11.netlify.app (14.11). The pictures, the font
and the look below come from that page. This is the design language for the whole of Party Arena.

## Pictures in this folder

| File | Size | What it is |
| --- | --- | --- |
| `doll.png` | 483x1200, transparent | The whole Shimi doll (head + body, strawberry hat, standing). |
| `head.png` | 512x512, transparent | The doll's head only, centred on a square. Use as the "face". |
| `body.png` | 473x680, transparent | The doll's body only (neck down). |
| `prop_01_beer_helmet.png` .. `prop_17_party_hat.png` | various, transparent | 17 accessories: 01 beer helmet, 02 straw hat, 03 pirate hat, 04 backwards cap, 05 shutter glasses, 06 green ears, 07 pink bow, 08 crown, 09 heart glasses, 10 top hat, 11 moustache, 12 sombrero, 13 headphones, 14 viking helmet, 15 lei, 16 bucket hat, 17 party hat. |

On the source page the head is the top 43% of the doll and accessories sit on it by slot
(HEAD / EYES / EARS / FACE / NECK).

Accessory photo credits (Wikimedia Commons, as listed on the source page; keep them in the app's credits):
crown: Gryffindor, CC BY-SA 3.0 · heart glasses: ShyAndroid, CC0 · top hat: The Metropolitan Museum of Art, CC0 ·
moustache: Denisgrim, CC BY-SA 3.0 · sombrero: Jamain, CC BY-SA 3.0 · headphones: Sotti, Niabot, CC BY-SA 3.0 ·
viking helmet: Michel wal, CC BY-SA 3.0 · lei: Bchachara, CC BY-SA 4.0 · bucket hat: Araras Sombrerería, CC BY-SA 4.0 ·
party hat: Polylerus, Iain, CC BY-SA 3.0. Changes: background removed, resized.

## Font

`client/public/fonts/motaleh.woff2` - "Motaleh", the display font of the source page (7.6 KB).
It contains Hebrew letters (with final forms), digits, basic punctuation and ₪. It has NO Latin letters and no ★:
those fall back to the system font, so keep display text Hebrew + digits.

```css
@font-face { font-family: 'Motaleh'; src: url('/fonts/motaleh.woff2') format('woff2'); font-display: swap; }
--disp: 'Motaleh', 'Arial Hebrew', 'Noto Sans Hebrew', system-ui, sans-serif;   /* titles, buttons, numbers, callouts */
--ui: system-ui, -apple-system, 'Segoe UI', 'Arial Hebrew', 'Noto Sans Hebrew', Roboto, Arial, sans-serif;  /* body text */
```

## Colours

```css
--yel: #FFD21F;  --yel-2: #FFE45A;  --org: #FF9F0A;      /* sunburst yellow, highlight, orange */
--red: #F2361B;  --red-d: #B5200A;                       /* primary buttons, accents */
--cob: #1E3FD8;  --cob-d: #10238C;  --cob-l: #4F6CFF;    /* cobalt blue: bars, panels, page background */
--ink: #16120E;  --paper: #FFF8E6;  --pink: #FF7EB6;  --white: #FFFFFF;
```

## The look (retro TV game show / comic sticker)

- **Display type**: Motaleh, bold, slightly skewed (about `skewX(8deg) rotate(-2deg)` on headline words), yellow or
  white fill with a thick ink outline (`-webkit-text-stroke: .04em var(--ink); paint-order: stroke fill`) and a hard
  two-step shadow (`text-shadow: .05em .06em 0 var(--red), .09em .11em 0 var(--ink)`). Key words in red.
- **Surfaces**: flat colours, thick ink borders (2.5-4 px), hard offset shadows with no blur
  (`box-shadow: 3px 3px 0 var(--ink)` on chips, `0 7px 0 var(--ink)` on big buttons). No soft glows, no glass, no gradients
  except the sunburst.
- **Buttons**: pills (`border-radius: 999px`) in red with white Motaleh text, or yellow with ink text, or white with
  cobalt text; ink border; hard shadow; press = move down by the shadow height.
- **Stage background**: yellow sunburst (rays from the centre in two yellows towards orange at the edges) with a
  halftone dot texture; the main character stands in the middle on a small cobalt disc.
- **Frames**: cobalt-dark top bar and bottom tray; chips and tiles on them are white / yellow / pink / red with ink borders.
- **Idle / waiting screens**: TV colour bars (SMPTE-style test card) with scanlines and a vignette.
- **Stickers and callouts**: star-burst stickers ("חדש!", "מסיבה!"), small skewed words flying out of the character
  on every hit ("וואו"), a "וואו־מטר" counter, a "live" red chip with a blinking dot.
- **Speech**: a white box with ink border and a red name tab ("הבובה · בשידור חי").
- **Motion**: snappy, squash and stretch, things pop and shake; nothing floats slowly.

The 14-point star, 10-point star and "kaboom" burst shapes of the source page (CSS `clip-path` polygons):

```css
--star14: polygon(50% 0%,58.7% 12%,71.7% 5%,74.3% 19.5%,89.1% 18.8%,85.1% 33.1%,98.7% 38.9%,89% 50%,98.7% 61.1%,85.1% 66.9%,89.1% 81.2%,74.3% 80.5%,71.7% 95%,58.7% 88%,50% 100%,41.3% 88%,28.3% 95%,25.7% 80.5%,10.9% 81.2%,14.9% 66.9%,1.3% 61.1%,11% 50%,1.3% 38.9%,14.9% 33.1%,10.9% 18.8%,25.7% 19.5%,28.3% 5%,41.3% 12%);
--star10: polygon(55% .2%,63.3% 19.8%,83.3% 12.7%,78.5% 33.4%,98.9% 39.4%,82.8% 53.3%,95.8% 70.1%,74.6% 72%,75.2% 93.2%,57% 82.2%,45% 99.8%,36.7% 80.2%,16.7% 87.3%,21.5% 66.6%,1.1% 60.6%,17.2% 46.7%,4.2% 29.9%,25.4% 28%,24.8% 6.8%,43% 17.8%);
--kb: polygon(50% 0%,58% 22%,78% 6%,74% 30%,98% 22%,84% 44%,100% 58%,78% 64%,88% 88%,64% 76%,54% 100%,44% 78%,22% 94%,26% 70%,0% 72%,14% 52%,0% 32%,24% 32%,18% 8%,40% 22%);
```

## Voice

Short, loud, Hebrew slang, like the source page ("וואו־מטר", "עוד כובע!", "הכל!", "ניעור"). The owner's words for
reactions: "נודר" (for real), "כפרה!" / "תכבדו!" (nice), "וואו!", "מחורחר!" (that's crazy). No צדיק, and בן פורת יוסף only for the champion (the owner, 2026-11-12).
Instructions and button labels stay plain and clear.
