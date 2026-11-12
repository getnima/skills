# שימי טאפ (tap): art slots

Drop a file here with the name below and it replaces the placeholder: no code change.
Any of .png / .webp / .jpg / .jpeg / .svg works for the same base name (e.g. `face_happy.webp`).
In dev just reload the page; a production build must be re-run.

| File | Size (px) | Transparent | What it is used for |
| --- | --- | --- | --- |
| `face_normal.png` | 800x800 | yes | The face to tap (expression 1 of 6 it cycles through): neutral / smiling. |
| `face_happy.png` | 800x800 | yes | Expression 2: big laugh, eyes closed. |
| `face_surprised.png` | 800x800 | yes | Expression 3: wide eyes, open "O" mouth. |
| `face_angry.png` | 800x800 | yes | Expression 4: frowning, brows down. |
| `face_tongue.png` | 800x800 | yes | Expression 5: tongue out, one eye squeezed. |
| `face_wink.png` | 800x800 | yes | Expression 6: winking. |
| `face_nosepick.png` | 800x800 | yes | Shown only during a nose-pick window (every tap = +5): finger clearly up the nose, a pose people spot at once. The game adds the sunburst, the gold ring and the pink "מחטט! x5" sign around it. |
| `background.jpg` | 1080x2340 (portrait) | no | Backdrop behind everything, scaled to cover the screen (edges cropped), so keep the middle calm: the face sits on top of it. |

Framing (all seven faces the same, so the face does not jump when the expression changes)
- Square picture, head centered, filling ~92% of the square (the head circle is 46% of the square from its center; taps count up to ~49%).
- A non-square picture is fitted inside the square (not cropped); hair / ears outside the square are cut.
- The faces are kept at 800x800 px (larger files are scaled down to that; smaller ones look soft on big phones).

Background
- `.jpg` is best (opaque). A `.png` / `.webp` also works; if it has see-through parts the game clears the screen behind it every frame, which costs a little speed on old phones.
- Kept at 860x1864 px; a different shape is cropped to cover.
