# Song slots

Drop a song into this folder (`client/public/audio/`) under one of the names below
and reload the TV page. No code change. Each slot accepts `.mp3`, `.m4a` or `.ogg`
(mp3 is the safest). A missing file is not an error.

| file | plays on the TV | suggested length | when it is missing |
| --- | --- | --- | --- |
| `victory.mp3` | **the round winner's song**: starts the moment the round winner is revealed (the Shimi angel prize ceremony) and runs over the standings that follow | 15 to 40 s (the chorus) | a built-in synth victory tune plays instead |
| `final.mp3` | the champion's song on the final podium, when first place is revealed | 30 to 60 s | the built-in synth victory tune |
| `lobby.mp3` | quietly, on a loop, in the lobby while guests join and between rounds | 1 to 3 min, loops | silence |
| `round.mp3` | quietly, on a loop, from a game's intro until the round ends | 1 to 2 min, loops | silence |

Notes

- **The built-in synth tune plays until `victory.mp3` is added.** Once the file is
  there it replaces the synth everywhere a round is won.
- `lobby` and `round` fade out on every change of screen, and every song stops while a
  cutscene video plays. `victory` and `final` are played by the show scenes themselves.
- The 🔊 / 🔇 button (key `M`) on the host's control strip mutes everything, songs included.
- Browsers start sound only after one click or key press on the page: the TV shows a
  yellow "לחצו בכל מקום" banner until then.
- Loud masters are fine: the lobby and round beds play at about a third of full volume.
