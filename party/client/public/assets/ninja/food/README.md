# Ninja: Israeli food set

Toy-style targets of the ninja (slicing) game, made to sit with `../../shimi/doll.png`: these are what the game throws.
Each object is a glossy hand-painted vinyl toy, photographed like a product, cut out on transparency.
All files are 384x384 transparent PNG, the object trimmed and centred with about 3% margin.
No brands, logos, text, faces or people. Untouched originals: `tests/e2e/out/ninja-food/originals/`.
Contact sheets (dark blue, 384 px and 96 px): `tests/e2e/out/ninja-food/contact_384.png`, `contact_96.png`.

Note: these are not all round. Wide shapes (shawarma, bourekas, flip-flop, shakshuka with its handle) fill the width
and leave room top and bottom; tall ones (pickle, limonana, gold falafel) the reverse. The game copes: it fits the
smallest circle around each object into its hit circle (see `../README.md`), so every picture is as large as it can be
inside the same hit circle.

How the game uses the roles (`client/src/games/ninja/skins.ts`): the 11 targets are dealt like a shuffled deck (+10 each);
about one ordinary target in 16 is a joke item instead (chair and flip-flop take turns, same +10); the gold bonus is the
rare +50 target.

## Pictures

| File | Hebrew | English | What it shows | Role |
| --- | --- | --- | --- | --- |
| `shawarma.png` | שווארמה בלאפה | Shawarma in laffa | Rolled laffa lying diagonally, white paper at the bottom, meat, tomato, cucumber, pink turnip, amba and tahini at the open end | target |
| `hummus.png` | צלחת חומוס | Hummus plate | Turquoise plate seen at an angle, hummus ring with chickpeas, paprika, parsley, olive-oil pool in the middle | target |
| `sabich.png` | סביח | Sabich | Puffy pita stuffed with fried eggplant, half a boiled egg, parsley and salad, amba and tahini dripping down | target |
| `falafel.png` | פלאפל בפיתה | Falafel in pita | Puffy pita with four falafel balls (one bitten, green inside), salad and tahini | target |
| `bourekas.png` | בורקס | Bourekas | Big glazed puff-pastry triangle with flaky layers and white and black sesame | target |
| `shakshuka.png` | שקשוקה | Shakshuka | Black cast-iron pan with handle, red tomato sauce, three sunny eggs, parsley | target |
| `schnitzel.png` | שניצל | Schnitzel | Thick oval breaded cutlet, bumpy orange crumb, lemon wedge on top | target |
| `sufganiya.png` | סופגנייה | Sufganiya (jam doughnut) | Plump doughnut, powdered sugar, red jam blob on top | target |
| `pickle.png` | מלפפון חמוץ | Pickle | One giant curved olive-green pickle with dill and peppercorns | target |
| `limonana.png` | לימונענע | Limonana | Glass of bright green lemon-mint slush, mint bunch, lemon wheel, red and white straw | target |
| `peanut_puffs.png` | ערימת חטיף בוטנים | Peanut puffs pile | A heap of golden peanut puff snacks, no bag, no brand | target |
| `gold_falafel.png` | גביע פלאפל זהב | Golden falafel trophy | Polished gold falafel ball on a gold trophy foot | gold bonus |
| `garden_chair.png` | כיסא פלסטיק לבן | White plastic garden chair | The classic white monobloc chair | joke item |
| `flip_flop.png` | כפכף | Flip-flop | Blue foam flip-flop with a red strap and white side stripe | joke item |

## Slice colours

Cut face = the colour to paint on the inside of each half. Splash kind: `sauce` (thick, blobby), `juice` (thin, droplets),
`crumbs` (dry bits). The game's table built from this one is `CUT_LOOKS` in `client/src/games/ninja/art.ts`; the last
column says what it draws on the cut face.

| File | Cut face (inside) | Splash colour | Splash kind | In the game |
| --- | --- | --- | --- | --- |
| `shawarma.png` | laffa `#F1D9A8` around meat `#7A4A2A` with salad flecks `#E83A2A` `#5DBB3F` `#F06AA8` | tahini / amba `#F2C230` | sauce | laffa ring, meat shreds, salad flecks, a sauce drizzle; cut across the roll |
| `hummus.png` | hummus `#E9D2A6`, olive-oil centre `#9A9A22`, plate edge `#3EC1C9` | hummus `#E3C997` | sauce | plate edge, hummus, the oil pool, chickpeas, paprika and parsley |
| `sabich.png` | pita `#F0D3A0`, eggplant `#4A2340`, egg white `#FAFAF2` + yolk `#FFC71A` | amba `#F4A01C` | sauce | pita ring, eggplant, a slice of egg, an amba drip, salad |
| `falafel.png` | pita `#F0D3A0` with falafel inside `#6CB33A` | tahini `#F4EEDD` | crumbs (brown `#6B3D1E` + green `#6CB33A`) | pita ring, tahini, three cut falafel balls (brown crust, green inside), tomato; the decal is a tahini puddle under the crumbs |
| `bourekas.png` | pale flaky layers `#F3DDB0` around white cheese `#FBF6E8` | `#E7B76A` | crumbs | crust, thin flaky layers, cheese in the middle |
| `shakshuka.png` | tomato sauce `#E2321F` with yolk `#FFB21A`, pan rim `#1E1E1E` | `#D62A18` | sauce | pan rim, sauce, two sunny eggs, parsley; yolk-coloured pool in the decal |
| `schnitzel.png` | white chicken `#F6EBD6` under a crust `#D9802A` | `#E39A3B` | crumbs | crust ring, white meat with short fibres |
| `sufganiya.png` | fluffy dough `#F7E2B6`, jam core `#C8102E` | jam `#D21A3A` + sugar `#FFFFFF` | sauce | fried ring, dough with air bubbles, jam core; sugar dots on the jam decal |
| `pickle.png` | pale green flesh `#C9D97A`, seeds `#E9EDB8`, skin `#556B1F` | brine `#B7C95A` | juice | skin ring, pale flesh, seeds; cut across |
| `limonana.png` | green slush `#8EE53F` | `#9BEA4A` (+ mint leaves `#2E8B3A`) | juice | glass ring, slush with mint and ice specks; mint dots on the juice decal |
| `peanut_puffs.png` | airy puff `#F2CF6A` | `#E9B740` | crumbs | an airy puff with darker holes |
| `gold_falafel.png` | gold `#FFD21F` with a star | gold `#FFC21A` + sparkles | crumbs (coin burst) | gold with a star; gold and white bits, plus the coin burst |
| `garden_chair.png` | white plastic `#F4F4F2` | `#DADADA` | crumbs (plastic shards) | plain white plastic; white and grey shards |
| `flip_flop.png` | blue foam `#2E9BE0`, red strap `#E0342A` | `#2E9BE0` | crumbs (foam bits) | blue foam with the white stripe and the red strap plug; blue and red bits |
