/**
 * What the TV's background music should be doing at a given moment, as a pure
 * function of the room state and the SERVER clock. The hook in music.tsx
 * applies it to the kit; tests/unit/music-plan.test.ts covers it.
 */
import { COUNTDOWN_MS, GAME_IDS, INTRO_MS } from '../../../shared/protocol';
import { roundTime } from '../../../shared/round-clock';
import { MUSIC } from './music-config';

import type { GameId, Phase, RoundPublic } from '../../../shared/protocol';
import type { MusicSlot, SongTuning } from './music-config';

/** Intro + countdown of a round when the TV did not see it begin (a reload): the production timing. */
export const DEFAULT_PRELUDE_MS = INTRO_MS + COUNTDOWN_MS;
/** Never trust a learned prelude longer than this. */
const MAX_PRELUDE_MS = 120_000;

export interface MusicInput {
  readonly phase: Phase | null;
  readonly round: RoundPublic | null;
  /** A cutscene is on the TV. */
  readonly cutscene: boolean;
  /** Server ms. */
  readonly now: number;
  /** Length of this round's intro + countdown (ms), see preludeOf(). */
  readonly preludeMs: number;
  /** The sound check panel is open: the bed stays quiet. */
  readonly soundCheck?: boolean;
  /** An audio file exists for the slot. */
  hasFile(slot: MusicSlot): boolean;
}

export interface MusicPlan {
  /** The track to have (its file name), or null for silence. */
  readonly slot: MusicSlot | null;
  /** Identity of one playing instance: a new key restarts the song. Null with no slot. */
  readonly key: string | null;
  /** 'pause' keeps the song where it is (a video is on). */
  readonly run: 'play' | 'pause';
  /** Level 0..1 to be at. */
  readonly volume: number;
  /** True while ducked (the intro, a 3-2-1). */
  readonly ducked: boolean;
  /** Where the song should be now, seconds from the start of the file (before wrapping a loop). */
  readonly positionSec: number;
  /** Server ms when this plan changes by itself (the end of a 3-2-1), or null. */
  readonly nextAt: number | null;
}

const SILENT: MusicPlan = { slot: null, key: null, run: 'play', volume: 0, ducked: false, positionSec: 0, nextAt: null };

function isGameId(v: string): v is GameId {
  return (GAME_IDS as readonly string[]).includes(v);
}

/** The file a game's round plays: its own song, else round.mp3, else nothing. */
export function resolveGameSlot(gameId: GameId, hasFile: (slot: MusicSlot) => boolean): MusicSlot | null {
  if (hasFile(gameId)) return gameId;
  if (hasFile('round')) return 'round';
  return null;
}

export function tuningOf(slot: MusicSlot): SongTuning {
  return MUSIC[slot];
}

/**
 * The intro + countdown length of a round seen in a snapshot made at
 * `serverNow`: the round clock's distance to the start (it stands still while
 * frozen, so a video during the intro does not change it). Exact only for the
 * first snapshot of the round.
 */
export function preludeOf(round: RoundPublic, serverNow: number): number {
  const lead = -roundTime(round, serverNow).elapsedMs;
  return Math.min(MAX_PRELUDE_MS, Math.max(0, lead));
}

/**
 * The song's position (ms since the intro began, video time excluded) for a
 * round: prelude + round clock. During the 3-2-1 after a video the round clock
 * stands at the freeze point, so this is where the song paused.
 */
export function songElapsedMs(round: RoundPublic, now: number, preludeMs: number): number {
  return Math.max(0, preludeMs + roundTime(round, now).elapsedMs);
}

export function planMusic(input: MusicInput): MusicPlan {
  const { phase, round } = input;
  if (phase === null || input.soundCheck === true) return SILENT;
  if (phase === 'lobby') {
    if (!input.hasFile('lobby')) return SILENT;
    const tune = tuningOf('lobby');
    return {
      slot: 'lobby',
      key: 'lobby',
      run: input.cutscene ? 'pause' : 'play',
      volume: tune.volume,
      ducked: false,
      positionSec: tune.startSec,
      nextAt: null,
    };
  }
  if (phase !== 'intro' && phase !== 'countdown' && phase !== 'playing') return SILENT;
  if (round === null || !isGameId(round.gameId)) return SILENT;
  const slot = resolveGameSlot(round.gameId, input.hasFile);
  if (slot === null) return SILENT;
  const tune = tuningOf(slot);
  const rt = roundTime(round, input.now);
  const frozen = input.cutscene || round.frozenAt !== null;
  // ducked: before the round's start (intro, 3-2-1) and during the 3-2-1 after a video
  let ducked = true;
  let nextAt: number | null = null;
  if (!frozen) {
    if (rt.resumeInMs > 0 && round.resumeAt !== null) nextAt = round.resumeAt;
    else if (rt.elapsedMs >= 0) ducked = false;
    else nextAt = round.startAt;
  }
  return {
    slot,
    key: `${round.index}:${round.seed}:${slot}`,
    run: frozen ? 'pause' : 'play',
    volume: ducked ? tune.introVolume : tune.volume,
    ducked,
    positionSec: tune.startSec + songElapsedMs(round, input.now, input.preludeMs) / 1000,
    nextAt,
  };
}
