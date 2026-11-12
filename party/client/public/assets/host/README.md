# TV show pictures (`client/public/assets/host/`)

Drop a file with one of these names into this folder and it replaces the placeholder.
No code change. Reload the page in dev; re-run `npm run build` for a production build.

- Any of `.png`, `.webp`, `.jpg`, `.jpeg`, `.svg` works for every slot (the base name is what counts).
- "Transparent" = PNG / WebP with a transparent background. A photo with a background still works, it just shows as a square picture.
- Preview everything without a party at `/show.html` (the control room).

| File | Recommended size | Transparent | Where it shows up |
| --- | --- | --- | --- |
| `mascot_normal.png` | 512x512 | yes | The commentator that slides in from the corner with a speech bubble: neutral remarks (overtakes). |
| `mascot_happy.png` | 512x512 | yes | Commentator: new leader, comeback, on fire, the climber of the round, podium intro. |
| `mascot_shocked.png` | 512x512 | yes | Commentator: big jump, dead heat, last 10 seconds, photo finish, THE WINNER CEREMONY and the champion (it jumps around while it talks). |
| `mascot_laugh.png` | 512x512 | yes | Commentator: somebody hit the bomb, last place, the roast in the results, "nobody won". |
| `mascot_angry.png` | 512x512 | yes | Commentator: somebody is still on zero. |
| `sticker_1.png` .. `sticker_8.png` | about 512x512 | yes (best) | Fly-bys during the race: they bounce across, spin through or zoom in on a moment. Any funny picture. As soon as at least one sticker file exists the moments without a drawn sticker (below) use the files instead. |
| `sticker_rocket`, `sticker_fire`, `sticker_fist`, `sticker_snail`, `sticker_sleep`, `sticker_camera`, `sticker_clock` (.webp) | about 420 wide | yes | **Drawn stickers** (die-cut, the show's comic look) for the race's moments: a big jump, on fire, neck and neck, last place, still on zero, a photo finish, and the rain of the last ten seconds; the crown (`crown.png`) for a new leader. The ninja bomb rain is the hosts' own bomb (`../hosts/bomb_hosts.png`). Each one replaces the emoji it stands for; the other fly-bys pick among them. |
| `crown.png` | 256x256 | yes | On the leader's avatar in the race (it hops to the new leader) and on the champion in the final podium (it drops onto the champion's head). **Now:** `crown.webp`, a comic gold crown with pearls and gems. |
| `last_place.png` | 128x128 | yes | Small badge on the last place: in the race and in the round results. **Now:** `last_place.webp`, the drawn snail in a party hat. |
| `prize.jpg` | 1000x1333 (3:4 portrait) | no | THE PRIZE in the winner ceremony of every round, and small in the winner banner. A photo is cropped around the MIDDLE of the picture (about x 19%..81%, y 28%..91%) and set in an arched golden frame with a halo, wings, god-rays and sparkles: keep the figurine in the middle, like the current photo. |
| `prize.png` | about 900x1200 (3:4 portrait), figurine fills the picture | yes | Same slot, wins over `prize.jpg` when both exist. A transparent cut-out is shown whole, with no frame, floating in the light with the halo and wings: this looks best. |
| `podium_1.png`, `podium_2.png`, `podium_3.png` | about 360x360 | yes | The final podium: the medallion on the face of each block (the place is written on it) and the medal pinned on each doll. **Now:** gold, silver and bronze laurel medallions (`podium_<n>.webp`; silver and bronze are the gold one recoloured). |
| `curtain.png` | about 930x1150 | no (it fills its half) | The final podium opens behind a red velvet curtain: this is its LEFT half (the right half is the same picture mirrored), the fold that meets the middle at its right edge, a gold fringe along the bottom. It opens during the drum roll. **Now:** `curtain.webp`. |
| `valance.png` | about 1280x200 | yes | The swagged valance with the gold fringe across the top of the closed curtain; it lifts away as the curtain opens (repeated across the width). **Now:** `valance.webp`. |
| `spotlight.png` | about 400x450 | yes | Two toy stage spotlights in the top corners of the final (the right one mirrored), lens to the lower right: their beams sweep during the drum roll and then find each place as it comes up, both on the champion. **Now:** `spotlight.webp`. |
| `trophy.png` | about 600x700 | yes | The evening's trophy: a gold cup, open on top. It rises at the right of the stage with the champion, the prize angel (`prize.png`, when it is a cut-out) standing in the cup, god-rays behind. **Now:** `trophy.webp`. |
| `cannon.png` | about 440x400 | yes | Two toy confetti cannons (the right one mirrored), aimed up to the right: they pop up from the bottom corners with the champion and kick back with each volley of confetti. **Now:** `cannon.webp`. |
| `bg_show.jpg` | 1920x1080 | no | Optional backdrop behind the race, the results and the final (darkened so the text stays readable). |

Songs live next to the pictures, in `client/public/audio/` (`.mp3`, `.m4a`, `.ogg` or `.wav`):

| File | When it plays |
| --- | --- |
| `victory.mp3` | The winner ceremony of every round, from the moment the name appears. Until the file exists a short synth tune plays. A real song keeps playing over the standings that follow and fades out when the results screen is left. |
| `final.mp3` | The champion on the final podium. Until the file exists the synth victory tune plays. |
