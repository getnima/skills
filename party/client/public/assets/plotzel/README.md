# Plotzel art slots

Drop files here with these names (.png, .webp, .jpg, .jpeg or .svg with the same base
name also work). A missing file uses the built-in placeholder; no code change.
A production build must be re-run after adding files (the list of files is taken at build time).

| File             | Size (CSS px)            | Transparency        | Where it shows                                                                                   |
| ---------------- | ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------ |
| `background.jpg` | full screen, `cover`     | opaque (jpg)        | optional backdrop behind the whole Plotzel screen. Missing = the cobalt stage with halftone dots. Keep it calm and dark: white tiles and keys sit on it. About 1080 x 1920. |
| `puff.png`       | 120 x 120                | transparent         | the 💨 that pops out of the solved row and flies off up-left on every solve. Subject facing / flying left. |
| `mascot.png`     | 96 x 96, clipped round   | transparent or not  | the face that pops up next to the star-burst sticker on every solve. Missing = Shimi's head from `../shimi/head.png`; if that is missing too, a generic cartoon face. |

Square images, subject centered. Use about 2x the size (e.g. 240 x 240 for `puff.png`) for sharp phones.
Placeholders are generic cartoons; do not use a photo of a real person without their OK.
