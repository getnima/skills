# שימי טאפ (tap): art slots

Drop a file here with the name below and it replaces the placeholder: no code change.
Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g. `face_happy.webp`).
In dev just reload the page; a production build must be re-run.

| File | Size (px) | Transparent | What it shows |
| --- | --- | --- | --- |
| `face_normal.png` | 512x512 | yes | Shimi's face, neutral / smiling. Head fills ~92% of the square, centered. |
| `face_happy.png` | 512x512 | yes | Big laugh, eyes closed. |
| `face_surprised.png` | 512x512 | yes | Wide eyes, open "O" mouth. |
| `face_angry.png` | 512x512 | yes | Frowning, brows down. |
| `face_tongue.png` | 512x512 | yes | Tongue out, one eye squeezed. |
| `face_wink.png` | 512x512 | yes | Winking. |
| `face_nosepick.png` | 512x512 | yes | Picking his nose: finger clearly up the nose, a pose people spot at once (this is the +5 moment). |
| `background.jpg` | 1080x2340 (portrait) | no | Optional backdrop behind everything. Scaled to cover the screen (cropped at the edges), so keep the middle calm: the face sits on top of it. |

Notes
- Faces are drawn up to ~420 px wide on a phone; 512 px is enough, 768 px is sharper.
- The tap area is the circle of 46% of the square around its center: crop the photo so the head fills the square and is centered (all seven files the same framing, so the face does not jump when the expression changes).
- Keep the hair / ears inside the square: anything outside is cut.
