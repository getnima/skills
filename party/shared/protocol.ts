/**
 * Wire contract between the server, the phone client and the TV host dashboard.
 * This file is the single source of truth: server and client both import it.
 * Transport: socket.io (event names in `C2S` / `S2C`).
 */

export const PROTOCOL_VERSION = 1;

// ───────────────────────────── Games ─────────────────────────────

export const GAME_IDS = ['tap', 'icy', 'flappy', 'plotzel', 'ninja'] as const;
export type GameId = (typeof GAME_IDS)[number];

export interface GameMeta {
  readonly id: GameId;
  /** Hebrew title shown on the TV and on phones. */
  readonly title: string;
  readonly emoji: string;
  /** One or two short Hebrew sentences shown during the intro phase. */
  readonly instructions: string;
  readonly durationMs: number;
  /**
   * Upper bound on a plausible raw score. The server clamps reported scores
   * to [0, maxRaw] (cheap sanity check, friends-only anti-cheat).
   */
  readonly maxRaw: number;
}

export const GAMES: Readonly<Record<GameId, GameMeta>> = {
  tap: {
    id: 'tap',
    title: 'שימי טאפ',
    emoji: '👆',
    instructions: 'לחצו על הפרצוף של שימי כמה שיותר מהר! כשהוא מחטט באף זה שווה הרבה יותר.',
    durationMs: 60_000,
    maxRaw: 5_000,
  },
  icy: {
    id: 'icy',
    title: 'אייסי שימי',
    emoji: '🧊',
    instructions: 'טפסו כמה שיותר גבוה על מדרגות הקרח. צוברים מהירות – קופצים גבוה יותר. לא ליפול!',
    durationMs: 75_000,
    maxRaw: 100_000,
  },
  flappy: {
    id: 'flappy',
    title: 'פלאפי תבורי',
    emoji: '🐤',
    instructions: 'הקישו על המסך כדי לעוף ועברו בין המכשולים. הריצה הכי טובה שלכם נחשבת.',
    durationMs: 60_000,
    maxRaw: 500,
  },
  plotzel: {
    id: 'plotzel',
    title: 'פלוצל',
    emoji: '💨',
    instructions: 'מגיעים מהמילה שעל המסך ל״פלוץ״. בכל צעד משנים אות אחת, וכל צעד חייב להיות מילה אמיתית. כמה שיותר מילים, בכמה שפחות צעדים!',
    durationMs: 120_000,
    maxRaw: 12_000,
  },
  ninja: {
    id: 'ninja',
    title: 'נינג׳ה תבורי',
    emoji: '🗡️',
    instructions: 'חתכו את כל מה שעף באוויר – אבל לא את הפצצה עם הפתיל. זה אנחנו!',
    durationMs: 60_000,
    maxRaw: 20_000,
  },
};

// ───────────────────────────── Timing ─────────────────────────────

/** Instructions screen before the countdown. */
export const INTRO_MS = 7_000;
/** 3-2-1 countdown right before `round.startAt`. */
export const COUNTDOWN_MS = 3_000;
/** After `round.endAt` the server waits this long for `player:final` before scoring. */
export const FINAL_GRACE_MS = 1_500;
/** After a mid-game cutscene the game stays frozen for a 3-2-1 before it continues. */
export const RESUME_COUNTDOWN_MS = 3_000;
/** A cutscene the TV never reports as finished is ended by the server after this long. */
export const CUTSCENE_MAX_MS = 90_000;
/** Suspense between the start of the results phase and the round winner's reveal. */
export const WINNER_REVEAL_MS = 8_000;
/** Clients send `player:score` at most this often while playing. */
export const SCORE_SEND_INTERVAL_MS = 250;
/** Server broadcasts the live `scores` event at most this often. */
export const SCORE_BROADCAST_INTERVAL_MS = 250;

export const MAX_PLAYERS = 60;
export const NAME_MAX_LEN = 14;
export const ROOM_CODE_LEN = 4;
/** A room with no sockets attached is dropped after this long. */
export const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;

// ───────────────────────────── State ─────────────────────────────

export type Phase =
  | 'lobby' // players join; between rounds the lobby also shows standings
  | 'intro' // game title + instructions (INTRO_MS)
  | 'countdown' // 3-2-1 (COUNTDOWN_MS), ends exactly at round.startAt
  | 'playing' // round.startAt .. round.endAt
  | 'results' // round results + overall standings
  | 'final'; // podium

export interface PlayerPublic {
  readonly id: string;
  readonly name: string;
  /** Index into the client's avatar palette (stable per player). */
  readonly avatar: number;
  readonly connected: boolean;
  /** Cumulative competition points. */
  readonly total: number;
}

export interface RoundPublic {
  /** 0-based index of the round within this competition. */
  readonly index: number;
  readonly gameId: GameId;
  /** Same seed for every player, so every phone gets the same level. */
  readonly seed: number;
  /** Server epoch ms. The intro runs until `startAt - COUNTDOWN_MS`. */
  readonly startAt: number;
  readonly endAt: number;
  /**
   * Set while the round clock is frozen (a cutscene is playing): the round's
   * time stands still at this server ms. On resume the server shifts
   * `startAt` / `endAt` forward by the frozen duration and clears it.
   */
  readonly frozenAt: number | null;
  /**
   * After a freeze during `playing`: the game stays frozen until this server
   * ms (3-2-1 "continuing"), with `startAt` / `endAt` already shifted so the
   * round continues exactly where it stopped. Null otherwise.
   * Always read round time through `roundTime()` in shared/round-clock.ts.
   */
  readonly resumeAt: number | null;
}

/** A cutscene is playing on the TV; every phone is frozen and told to watch. */
export interface CutsceneState {
  /** `id` of an entry in CUTSCENES (shared/cutscenes.ts). */
  readonly id: string;
  /** Server epoch ms. */
  readonly startedAt: number;
}

export interface ResultRow {
  readonly playerId: string;
  readonly name: string;
  readonly avatar: number;
  /** Raw in-game score of this round. */
  readonly raw: number;
  /** Competition points awarded for this round (0..~1100). */
  readonly points: number;
  /** 1-based rank within this round (ties share a rank). */
  readonly roundRank: number;
  /** Cumulative points after this round. */
  readonly total: number;
  /** 1-based overall rank after this round (ties share a rank). */
  readonly rank: number;
  /** Overall rank before this round, or null for a first appearance. */
  readonly prevRank: number | null;
}

export interface RoundResults {
  readonly roundIndex: number;
  readonly gameId: GameId;
  /** Sorted by `rank` (overall), then name. */
  readonly rows: readonly ResultRow[];
  /**
   * Winner(s) of THIS round: every player with roundRank 1 and raw > 0
   * (several on a tie, none when nobody scored). The round winner gets the
   * prize, so the TV runs a winner ceremony with the victory song.
   */
  readonly winnerIds: readonly string[];
  /**
   * Server epoch ms at which the TV reveals the round winner. The TV paces
   * its ranking reveal to land on it; phones hide the personal result until
   * then so nobody is spoiled. Set to now + WINNER_REVEAL_MS when the results
   * phase begins; a cutscene that plays before it pushes it back by the
   * cutscene's length.
   */
  readonly revealAt: number;
}

/** Full room snapshot. Broadcast to everyone in the room on every change. */
export interface RoomState {
  readonly code: string;
  readonly phase: Phase;
  readonly players: readonly PlayerPublic[];
  /** Set from `intro` through `results`; null in `lobby` and `final`. */
  readonly round: RoundPublic | null;
  /** Games already played in this competition, in order. */
  readonly played: readonly GameId[];
  /** Results of the last finished round (kept through lobby/final), or null. */
  readonly results: RoundResults | null;
  /**
   * Non-null while a cutscene plays. Orthogonal to `phase`: the phase stays
   * what it was and its clock is frozen (see RoundPublic.frozenAt).
   */
  readonly cutscene: CutsceneState | null;
  /** Host switch: whether cutscenes with an automatic trigger fire. */
  readonly autoCutscenes: boolean;
  /** Server epoch ms when this snapshot was made. */
  readonly serverNow: number;
}

// ───────────────────────────── Events ─────────────────────────────

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: ErrorCode; message: string };

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'BAD_NAME'
  | 'NOT_HOST'
  | 'BAD_PHASE'
  | 'BAD_REQUEST'
  | 'KICKED';

/** Client → server. Every event except `player:score` takes an ack callback. */
export interface C2S {
  /**
   * Create a room, or re-attach to one after a TV refresh when `code` +
   * `hostKey` match. A stale pair creates a fresh room.
   */
  'host:create': (
    req: { code?: string; hostKey?: string },
    ack: (res: Ack<{ code: string; hostKey: string; state: RoomState }>) => void,
  ) => void;
  /** lobby | results → intro. */
  'host:start': (req: { gameId: GameId }, ack: (res: Ack<{}>) => void) => void;
  /** Force the running round to end now (intro/countdown → back to lobby, playing → results). */
  'host:endRound': (req: {}, ack: (res: Ack<{}>) => void) => void;
  /** results | final → lobby. */
  'host:lobby': (req: {}, ack: (res: Ack<{}>) => void) => void;
  /** lobby | results → final podium. */
  'host:final': (req: {}, ack: (res: Ack<{}>) => void) => void;
  /** Zero all totals, clear played games and results, → lobby. Players stay. */
  'host:reset': (req: {}, ack: (res: Ack<{}>) => void) => void;
  'host:kick': (req: { playerId: string }, ack: (res: Ack<{}>) => void) => void;
  /** Play a cutscene now, in any phase (freezes a running round). BAD_PHASE if one is already playing. */
  'host:cutscene': (req: { id: string }, ack: (res: Ack<{}>) => void) => void;
  /** The TV finished playing the current cutscene (or the host skipped it). */
  'host:cutsceneEnd': (req: {}, ack: (res: Ack<{}>) => void) => void;
  'host:setAutoCutscenes': (req: { enabled: boolean }, ack: (res: Ack<{}>) => void) => void;

  /**
   * Join a room, or resume as the same player after a refresh/reconnect when
   * `playerId` + `secret` match (name is then updated if provided).
   * Joining is allowed in any phase; a mid-round joiner plays from the next round.
   */
  'player:join': (
    req: { code: string; name: string; playerId?: string; secret?: string },
    ack: (res: Ack<{ playerId: string; secret: string; state: RoomState }>) => void,
  ) => void;
  /** Live score while playing. Fire-and-forget, throttled by the client. */
  'player:score': (req: { round: number; score: number }) => void;
  /** Final score, sent once when the client's round ends. Wins over `player:score`. */
  'player:final': (req: { round: number; score: number }, ack: (res: Ack<{}>) => void) => void;

  /** Clock sync: client sends its own timestamp, server answers with its clock. */
  'time:ping': (clientT: number, ack: (res: { clientT: number; serverNow: number }) => void) => void;
}

/** Server → client. */
export interface S2C {
  state: (state: RoomState) => void;
  /** Live raw scores of the running round, as [playerId, score] pairs. */
  scores: (msg: { round: number; scores: ReadonlyArray<readonly [string, number]> }) => void;
  /** This player was removed by the host. */
  kicked: () => void;
}
