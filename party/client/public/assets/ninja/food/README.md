# Ninja: Israeli food set

Toy-style targets for the ninja (slicing) game, made to sit with `../target_*.png` and `../../shimi/doll.png`:
each object is a glossy hand-painted vinyl toy, photographed like a product, cut out on transparency.
All files are 384x384 transparent PNG, the object trimmed and centred with about 3% margin (the game scales them to 256).
No brands, logos, text, faces or people. Untouched originals: `tests/e2e/out/ninja-food/originals/`.
Contact sheets (dark blue, 384 px and 96 px): `tests/e2e/out/ninja-food/contact_384.png`, `contact_96.png`.

Note: these are not all round. Wide shapes (shawarma, bourekas, flip-flop, shakshuka with its handle) fill the width
and leave room top and bottom; tall ones (pickle, limonana, gold falafel) the reverse.

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
`crumbs` (dry bits).

| File | Cut face (inside) | Splash colour | Splash kind |
| --- | --- | --- | --- |
| `shawarma.png` | laffa `#F1D9A8` around meat `#7A4A2A` with salad flecks `#E83A2A` `#5DBB3F` `#F06AA8` | tahini / amba `#F2C230` | sauce |
| `hummus.png` | hummus `#E9D2A6`, olive-oil centre `#9A9A22`, plate edge `#3EC1C9` | hummus `#E3C997` | sauce |
| `sabich.png` | pita `#F0D3A0`, eggplant `#4A2340`, egg white `#FAFAF2` + yolk `#FFC71A` | amba `#F4A01C` | sauce |
| `falafel.png` | pita `#F0D3A0` with falafel inside `#6CB33A` | tahini `#F4EEDD` | crumbs (brown `#6B3D1E` + green `#6CB33A`) |
| `bourekas.png` | pale flaky layers `#F3DDB0` around white cheese `#FBF6E8` | `#E7B76A` | crumbs |
| `shakshuka.png` | tomato sauce `#E2321F` with yolk `#FFB21A`, pan rim `#1E1E1E` | `#D62A18` | sauce |
| `schnitzel.png` | white chicken `#F6EBD6` under a crust `#D9802A` | `#E39A3B` | crumbs |
| `sufganiya.png` | fluffy dough `#F7E2B6`, jam core `#C8102E` | jam `#D21A3A` + sugar `#FFFFFF` | sauce |
| `pickle.png` | pale green flesh `#C9D97A`, seeds `#E9EDB8`, skin `#556B1F` | brine `#B7C95A` | juice |
| `limonana.png` | green slush `#8EE53F` | `#9BEA4A` (+ mint leaves `#2E8B3A`) | juice |
| `peanut_puffs.png` | airy puff `#F2CF6A` | `#E9B740` | crumbs |
| `gold_falafel.png` | gold `#FFD21F` with a star (like `target_gold`) | gold `#FFC21A` + sparkles | crumbs (coin burst) |
| `garden_chair.png` | white plastic `#F4F4F2` | `#DADADA` | crumbs (plastic shards) |
| `flip_flop.png` | blue foam `#2E9BE0`, red strap `#E0342A` | `#2E9BE0` | crumbs (foam bits) |
