# The hosts as dolls

Made with Higgsfield (model Nano Banana 2.1) from the hosts' own photos, in the style of the Shimi doll.
The source photos are not in the repository.

| File | Size | What it is |
| --- | --- | --- |
| `host_a.png` | about 500x1100, transparent | Host A as a doll, whole figure (lemon hat, round glasses, green shirt): the version the owner picked. |
| `host_b.png` | about 500x1100, transparent | Host B as a doll, whole figure (dark hair with bangs, striped top): the version the owner picked. |
| `host_a_head.png`, `host_b_head.png` | 512x512, transparent | The heads only, centred on a square. |
| `bomb_hosts.png` | 512x512, transparent | Both heads on a dark round bomb, no fuse. A 256 px copy is installed as `assets/ninja/bomb.png` ("we are the bomb"). |

Intended uses: the bomb in the ninja game (installed), the TV commentator pair, the lobby, cutscene cards.

## The narrating poses (`poses/`)

The two hosts narrating the show on the TV (`client/src/host/narrator.tsx`, the script in
`client/src/host/show/narration.ts` and `design/narration.he.md`). Twelve full-body pictures, one per host and
pose, `poses/<a|b>_<pose>.webp`: transparent WebP, 640 px tall (about 260 to 340 px wide), 31 to 38 KB each.

| Pose | `a_` / `b_` | What the host does | Used for |
| --- | --- | --- | --- |
| `present` | both | a handheld microphone at the chin, the other arm out, open palm | openings, intros, standings, podium |
| `cheer` | both | both fists up, shouting with joy, one knee up | GO, the reveal, the champion |
| `shocked` | both | both hands on the cheeks, mouth an O | the last 10 seconds, the flappy finale, time up |
| `shush` | both | leaning in, a finger to the lips, eyes to the side | the drum roll before the winner, the podium |
| `laugh` | both | laughing, pointing to the side, a hand on the belly | the intros' answers, after a cutscene |
| `wave` | both | one hand up waving, the other on the chest | goodbye |

How they were made (12 generations, no paid cut-outs, 23 credits):

- Higgsfield, model `nano_banana_2_1`, one picture per generation, 3:4. The image reference of every pose is
  THAT host's own doll (`host_a.png` / `host_b.png` flattened on light grey), so the face, hair, glasses
  and clothes stay the same. The prompt: the same glossy hand-painted vinyl toy figurine, full body, the
  pose, product photo, plain flat light-grey background, soft even light, no text, no logos.
- Cut out locally from the flat grey backdrop with `tests/e2e/intro-art-cut.py` and packed with
  `tests/e2e/intro-art-pack.py` (trim, 640 px, WebP). `tests/e2e/host-poses-pack.sh <name>` (or `all`)
  re-runs both with the settings each picture was made with: host B's white stripes and teeth need a tight
  tolerance and a flatness guard, and the grey pockets between the arms, hair and legs are dropped inside
  small polygons.
- The originals are kept out of the repository (`tests/e2e/out/host-poses/originals/`, git-ignored); the
  contact sheet is `tests/e2e/out/host-poses/sheet.png` (`python3 -I tests/e2e/host-poses-sheet.py . <out>`).

A missing pose file is not an error: the narrator shows that host's head (`host_<a|b>_head.png`) instead.
A new pose is a new file named `<a|b>_<pose>.webp` plus its name in `POSES` (`narration.ts`).
