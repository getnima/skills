/**
 * The round winner's song (victory.mp3) is started by the results scene, which also stops it
 * when it leaves the screen. Between games it plays on in the lobby instead (the owner, 13.11):
 * the TV's music hook (host/music.tsx) says so here while it renders, which is before the results
 * scene is taken down, and from then on the song is the hook's to level and to stop.
 */
let carried = false;

export function carryVictorySong(on: boolean): void {
  carried = on;
}

export function victorySongCarried(): boolean {
  return carried;
}
