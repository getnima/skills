import type { GameMeta, PlayerPublic, RoundResults } from '../../../../shared/protocol';
import type { RoundClockSample } from '../../games/types';

/**
 * The TV "show": the scenes the whole room watches. Each scene is a Preact
 * component that fills its parent (100% x 100%; the host shell sizes the
 * parent and keeps its own control strip outside it) and animates itself from
 * the props it is given. Scenes never talk to the network.
 * Implemented in ./index.tsx.
 */

/** Live race during a round. */
export interface PlayingSceneProps {
  readonly game: GameMeta;
  readonly roundIndex: number;
  /** Everyone in the room; rows are shown for players that have a score entry. */
  readonly players: readonly PlayerPublic[];
  /** Latest live raw scores (playerId → raw). A new Map instance per update. */
  readonly scores: ReadonlyMap<string, number>;
  /** Polled every frame for the big timer; `frozen` while a cutscene plays. */
  clock(): RoundClockSample;
  readonly durationMs: number;
}

/**
 * After a round: the ranking builds up from last place and lands on the
 * round WINNER exactly at `results.revealAt` (server time), then the winner
 * ceremony (prize + victory song), then the overall standings.
 */
export interface ResultsSceneProps {
  readonly game: GameMeta;
  readonly results: RoundResults;
  /** Server-synced epoch ms, to pace the reveal toward `results.revealAt`. */
  now(): number;
  /** False while a cutscene covers the scene: hold everything until true. */
  readonly active: boolean;
}

/** Final podium: third, second, first, then the full table. */
export interface FinalSceneProps {
  readonly players: readonly PlayerPublic[];
  readonly results: RoundResults | null;
  readonly active: boolean;
}

/** Compact cumulative leaderboard, shown in the lobby between rounds. */
export interface StandingsPanelProps {
  readonly players: readonly PlayerPublic[];
  readonly results: RoundResults | null;
}
