/**
 * Music tuning of the TV, in ONE place. Change a number, rebuild (or restart
 * `npm run dev`), done. The files themselves live in client/public/audio/
 * (see the README there); the ☰ menu → "🎵 בדיקת סאונד" plays each slot with
 * these exact numbers so the levels can be checked on the TV.
 */
import type { GameId } from '../../../shared/protocol';

export interface SongTuning {
  /**
   * Where in the file the song begins, in seconds (0 = the very start).
   * Skip a slow intro: 42 starts the song at 0:42, right at the chorus.
   */
  readonly startSec: number;
  /** Full level while the game is being played, 0..1 (1 = the file as mastered). */
  readonly volume: number;
  /**
   * Ducked level while the host talks: the game's instructions, the 3-2-1
   * before it and the "ממשיכים 3-2-1" after a video. 0..1. The lobby ignores it.
   */
  readonly introVolume: number;
}

/** The background slots the TV plays (victory.mp3 / final.mp3 are played by the show at full level). */
export type MusicSlot = 'lobby' | GameId | 'round';

export const MUSIC: Readonly<Record<MusicSlot, SongTuning>> = {
  /** lobby.mp3: guests joining and between rounds. Quiet. */
  lobby: { startSec: 0, volume: 0.4, introVolume: 0.4 },
  /** One song per game: from its intro to the end of play. */
  tap: { startSec: 0, volume: 0.6, introVolume: 0.3 },
  icy: { startSec: 0, volume: 0.6, introVolume: 0.3 },
  flappy: { startSec: 0, volume: 0.6, introVolume: 0.3 },
  plotzel: { startSec: 0, volume: 0.6, introVolume: 0.3 },
  ninja: { startSec: 0, volume: 0.6, introVolume: 0.3 },
  /** round.mp3: the quiet fallback for a game that has no song of its own. */
  round: { startSec: 0, volume: 0.3, introVolume: 0.2 },
};

/** Fade lengths in ms. */
export const MUSIC_FADES = {
  /** Ducked → full level when play starts (and after the 3-2-1 that follows a video). */
  rampUpMs: 600,
  /** A video starts: the song pauses where it is. */
  pauseMs: 250,
  /** The video ended: the song continues from where it paused. */
  resumeMs: 300,
  /** The round ended (results, or cancelled): out before the drum-roll and the victory song. */
  roundEndMs: 800,
  /** The lobby song leaving the lobby. */
  lobbyEndMs: 900,
} as const satisfies Record<string, number>;
