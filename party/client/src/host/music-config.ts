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

/*
 * The levels below are set for the party's own files (13.11), which are mastered very differently.
 * Measured loudness of each file (ffmpeg ebur128, integrated): lobby -11.8 LUFS (Pump Up The Jam),
 * tap -5.6 (Barbra Streisand, radio edit), icy -19.5 (the Icy Tower tune), flappy -10.7 (Red Right
 * Hand, the owner's second download), plotzel -16.1 (Lobby Music, House Edition), ninja -10.0 (Yamasuki, Yama Yama), victory and
 * final -8.6 (the London fanfare trumpets, then Stayin' Alive). The aim: about -17 LUFS while a game is played, half of that level under the host's
 * explanation, about -21 in the lobby. A level is a plain volume (1 = the file as it is): the
 * files themselves are never re-encoded or processed. Replace a file: measure it and redo its line
 * (level = 10 ^ ((target - measured) / 20), at most 1). A slot with no file keeps the old defaults.
 */
export const MUSIC: Readonly<Record<MusicSlot, SongTuning>> = {
  /** lobby: guests joining and between rounds. Quiet. */
  lobby: { startSec: 0, volume: 0.35, introVolume: 0.35 },
  /** One song per game: from its intro to the end of play. */
  tap: { startSec: 0, volume: 0.27, introVolume: 0.14 },
  icy: { startSec: 0, volume: 1, introVolume: 0.5 },
  flappy: { startSec: 0, volume: 0.48, introVolume: 0.24 },
  plotzel: { startSec: 0, volume: 0.9, introVolume: 0.45 },
  ninja: { startSec: 0, volume: 0.45, introVolume: 0.22 },
  /** round.mp3: the quiet fallback for a game that has no song of its own. */
  round: { startSec: 0, volume: 0.3, introVolume: 0.2 },
};

/**
 * victory and final (the round winner's song, the champion's song): played once, from the start.
 * The level of the party's file: about -13 LUFS, a step above a game's song. Used only when the
 * file is there (the built-in synth tune keeps its own level).
 */
export const SHOW_SONG_VOLUME: Readonly<Record<'victory' | 'final', number>> = { victory: 0.6, final: 0.6 };

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
