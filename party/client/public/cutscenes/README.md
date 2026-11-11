# Cutscene videos

Short videos that play full screen on the TV. While one plays, every phone shows
"watch the TV" and a running game stops; when the video ends the game continues
exactly where it stopped, after a 3-2-1.

## Add a video

1. **Put the file in this folder** (`client/public/cutscenes/`), for example
   `joker_1.mp4`.
2. **Register it** in `shared/cutscenes.ts`, in the `CUTSCENES` list:

   ```ts
   { id: 'joker_1', title: 'ג׳וקר 1', file: 'joker_1.mp4', when: { at: 'manual' } },
   ```

   - `id`: any unique English name.
   - `title`: the Hebrew name shown on the host's menu and on the placeholder card.
   - `file`: the file name in this folder.
   - `when`: when it plays (see below).
   - optional `phoneText`: the line the phones show while it plays.
   - optional `repeat: true`: an automatic one fires every time, not only once per competition.
   - optional `enabled: false`: keep the entry but never fire it automatically.

   The six entries already in the list only need their file dropped in here
   (`opening.mp4`, `tap_freeze.mp4`, `before_ninja.mp4`, `before_podium.mp4`,
   `joker_1.mp4`, `joker_2.mp4`). An entry whose file is missing is fine: the TV
   shows a 4-second "a video goes here" card instead.
3. Reload the host page. In the host's **🎬 סרטונים** menu (key `C`) the dot next to
   the entry turns green when the file is found, and **▶ נגן** plays it right away.

## Format

- **MP4, H.264 video + AAC audio** (plays in Chrome and Safari on the party laptop).
  Any 16:9 size works; 1280x720 or 1920x1080 is ideal. Other shapes are letterboxed on black.
- **Keep it short: 5 to 20 seconds.** The server gives up on a video after 90 seconds.
- Sound is on. If the browser blocks sound (no click on the page yet), the video plays
  muted and a "🔊 הפעלת סאונד" button appears.
- The player tries the file named in the manifest, then the same name as `.webm`
  and `.mp4`, and plays the first one the browser can open. So `joker_1.webm` next to
  `joker_1.mp4` is fine (the test browser has no H.264, which is why the two test
  clips exist in both formats).
- Converting with ffmpeg:
  `ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart joker_1.mp4`

## When it plays (`when`)

| trigger | plays |
| --- | --- |
| `{ at: 'manual' }` | only when the host presses its button in the 🎬 menu |
| `{ at: 'before', gameId: 'ninja' }` | right after the host starts that game, before its instructions |
| `{ at: 'during', gameId: 'tap', atMs: 30000 }` | in the middle of that game, when its clock reaches `atMs` (30 s here). Leave out `gameId` for every game |
| `{ at: 'after', gameId: 'icy' }` | when that game's round ends, before the winner is revealed. Leave out `gameId` for every game |
| `{ at: 'final' }` | before the final podium |

Automatic triggers fire once per competition and only while the host's **אוטומטי**
switch (in the 🎬 menu) is on. Any entry, automatic or not, can also be played by hand
from the menu at any moment. During a video the host can press **דלג** (key `S`) to skip it.

## Test clips

`opening.*` and `tap_freeze.*` are 4-second test patterns with a beep, so the video
path works before the real videos arrive. Replace them with the real files (same
names) and delete the `.webm` copies when you do, or the player may still pick the test clip.
