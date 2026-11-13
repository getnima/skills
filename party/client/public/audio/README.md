# Song slots

Drop a song into this folder (`client/public/audio/`) under one of the names below.
No code change. Each slot also accepts `.m4a`, `.ogg`, `.wav` or `.webm` (mp3 is the safest).
A missing file is never an error. Every song plays on the TV only (phones play no music).

**Songs are not in git** (`.gitignore`): they are the owner's own files, usually commercial
recordings, and this repository is public. They stay in this folder on the owner's machine and
go to the party's server with `deploy/gce-deploy.sh` (it uploads the folder as it is). A fresh
clone has only `airhorn.mp3` and `gong.mp3`: copy the songs in again before deploying from it.
For the 14.11 party, all from the owner's `~/Documents/music/`: `lobby.webm` (Technotronic, Pump Up
The Jam), `tap.webm` (Duck Sauce, Barbra Streisand, radio edit), `icy.webm` (the Icy Tower tune),
`flappy.webm` (Nick Cave & The Bad Seeds, Red Right Hand), `plotzel.webm` (Lobby Music, House
Edition), `ninja.webm` (Yamasuki, Yama Yama), and `victory.mp3` = `final.mp3`: the London fanfare
trumpets (its 3 s of leading silence cut), then Bee Gees, Stayin' Alive. The `.webm` are the sound
of the owner's video files, copied out as it is (`ffmpeg -i in.webm -vn -c:a copy out.webm`):
nothing is re-encoded. Only the winner's song is an MP3 made here (two files joined into one, and
MP3 because the round winner's PHONE plays it too, and not every phone plays WebM). Levels are set
in `music-config.ts` from the measured loudness of each file.

**Files are picked up when the client is built or the dev server starts.** After adding
or renaming a file: rebuild and redeploy, or restart `npm run dev`. Then check it in the
sound check panel (below).

| file | plays on the TV | suggested length | when it is missing |
| --- | --- | --- | --- |
| `lobby.mp3` | quietly, on a loop, in the lobby while guests join and between rounds | 1 to 3 min | silence |
| `tap.mp3` | שימי טאפ: from its intro (ducked while the host explains) through the 3-2-1 and the whole game (full) | 1 to 2 min, loops if shorter | `round.mp3`, else silence |
| `icy.mp3` | אייסי שימי: same | same | same |
| `flappy.mp3` | פלאפי תבורי: same | same | same |
| `plotzel.mp3` | פלוצל: same | same | same |
| `ninja.mp3` | נינג׳ה תבורי: same | same | same |
| `round.mp3` | the fallback for every game that has no song of its own, quieter | 1 to 2 min, loops | silence |
| `victory.mp3` | the round winner's song: starts when the winner is revealed and runs over the standings | 15 to 40 s (the chorus) | a built-in synth victory tune |
| `final.mp3` | the champion's song on the final podium, when first place is revealed | 30 to 60 s | the built-in synth victory tune |
| `airhorn.mp3` | **in place.** The DJ air horn, once each time the show switches to the next game (the intro screen) | 2.8 s (the owner's sample, leading silence trimmed) | a synthesized air horn |
| `gong.mp3` | **in place.** The gong, when a round starts (with "יאללה!") and when it is over (the results come up); at most 4.5 s, faded | 6.1 s (the owner's sample, trimmed and faded) | a synthesized gong |

How a game's song behaves

- Starts with the game's intro at a ducked level, rises to full over ~0.6 s when play starts.
- A cutscene video pauses it (short fade); when the video ends it continues from the same
  spot, ducked during "ממשיכים 3-2-1", then full again.
- When the round ends (results, or the host cancels / ends it) it fades out over ~0.8 s, so
  the drum-roll and `victory.mp3` play alone. A song longer than the round is simply cut by
  that fade; a shorter one loops.
- Reloading the TV page mid-round brings it back at the spot it would have reached. Browsers
  start sound only after one click or key press on the page (the yellow "לחצו בכל מקום"
  banner); the song then starts at the right spot.
- The 🔊 / 🔇 button (key `M`) mutes everything, songs included. Calm mode does not touch music.

Tuning: `client/src/host/music-config.ts`, one line per slot: `startSec` (where in the file
to begin, e.g. 42 = at 0:42, the chorus), `volume` (full level, 0..1; without a measured file:
games 0.6, lobby 0.4, round 0.3) and `introVolume` (ducked level; games 0.3, round 0.2). `victory` and `final`
always play from the start at full level.

Sound check: on the TV, ☰ → **🎵 בדיקת סאונד** (lobby only) lists every slot with the exact
file name expected, ✓ found (with the real file name) or what plays instead, and a ▶ button
that plays it exactly as the show would (same start and level). One preview at a time;
closing the panel stops it.
