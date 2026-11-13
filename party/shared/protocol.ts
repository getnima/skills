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
  /** One or two short Hebrew sentences: the long form (the README, the remote). */
  readonly instructions: string;
  /**
   * How to play, ultra concise: two or three steps, each an emoji and a few words. The TV and the
   * phones show these during the intro (in Rubik, big), the same on both.
   */
  readonly howTo: readonly (readonly [icon: string, text: string])[];
  readonly durationMs: number;
  /**
   * Upper bound on a plausible raw score. The server clamps reported scores
   * to [0, maxRaw] (cheap sanity check, friends-only anti-cheat).
   */
  readonly maxRaw: number;
  /**
   * 'score': the round runs its full time and the best raw score wins.
   * 'elimination': one life. The raw score is survival (see the game), a player who is out
   * sends its final at once, and the server ends the round shortly after one is left
   * (ELIMINATION_END_DELAY_MS); `durationMs` is then only the hard cap.
   */
  readonly mode: 'score' | 'elimination';
  /**
   * The last part of the round is a hold: nobody can score any more and every phone shows its own
   * result. A clock shown to people (the TV's) ends this long before `round.endAt`, so it reaches
   * zero when the game is really over. In ms of the production `durationMs`; see clockTailMs().
   */
  readonly holdMs?: number;
}

export const GAMES: Readonly<Record<GameId, GameMeta>> = {
  tap: {
    id: 'tap',
    title: 'שימי טאפ',
    emoji: '👆',
    instructions: '20 שניות של ספאם על שימי, כולם יחד. השעון רץ מהיאללה. כל הקשה נקודה!',
    howTo: [
      ['👆', 'הקישו על שימי, מהר!'],
      ['⏱️', '20 שניות, כולם יחד'],
      ['➕', 'כל הקשה = נקודה'],
    ],
    // One 20 s sprint for everyone, from the round's start, and 3 s of hold for the final frame
    // (the owner, 13.11: "the tv says 10s remaining but is over": it was 8 s to start + a personal
    // 20 s + 2 s, so whoever started at once was done with 10 s left on the TV). The split is TAP
    // in games/tap/pick.ts.
    durationMs: 23_000,
    holdMs: 3_000,
    maxRaw: 300,
    mode: 'score',
  },
  icy: {
    id: 'icy',
    title: 'אייסי שימי',
    emoji: '🧊',
    instructions: 'טפסו כמה שיותר גבוה על מדרגות הקרח. צוברים מהירות – קופצים גבוה יותר. לא ליפול!',
    howTo: [
      ['👈👉', 'מחזיקים צד = רצים'],
      ['⬆️', 'קופצים לבד. מהר = גבוה'],
      ['🏆', 'הכי גבוה מנצח'],
    ],
    // the owner's call (13.11): 45 s, not 75 (a long climb with nothing new to see)
    durationMs: 45_000,
    maxRaw: 100_000,
    mode: 'score',
  },
  flappy: {
    id: 'flappy',
    title: 'פלאפי תבורי',
    emoji: '🐤',
    instructions: 'הקישו כדי לעוף. מי שמתרסק - בחוץ! האחרון שנשאר באוויר מנצח, ולוקח בונוס של 300 נקודות.',
    howTo: [
      ['👆', 'הקשה = עפים למעלה'],
      ['💥', 'נגיעה = בחוץ'],
      ['🏆', 'אחרון באוויר: בונוס 300'],
    ],
    // Hard cap only: the round ends 1.5 s after one player is left (normally 20-50 s).
    durationMs: 90_000,
    // Raw = distance flown in tenths of a course unit (at most ~60 units/s for 90 s).
    maxRaw: 100_000,
    mode: 'elimination',
  },
  plotzel: {
    id: 'plotzel',
    title: 'פלוצל',
    emoji: '💨',
    instructions: 'מגיעים מהמילה שעל המסך ל״פלוץ״. בכל צעד משנים אות אחת, וכל צעד חייב להיות מילה אמיתית. הניקוד: 80% מהירות, 20% כמה שפחות צעדים. אז מהר!',
    howTo: [
      ['🔤', 'משנים אות אחת בכל צעד'],
      ['✅', 'כל צעד = מילה אמיתית'],
      ['💨', 'מגיעים ל״פלוץ״. מהר!'],
    ],
    durationMs: 120_000,
    maxRaw: 30_000,
    mode: 'score',
  },
  ninja: {
    id: 'ninja',
    title: 'נינג׳ה תבורי',
    emoji: '🗡️',
    instructions: 'חתכו את כל מה שעף באוויר – אבל לא את הפצצה עם הפתיל. זה אנחנו!',
    howTo: [
      ['👉', 'מחליקים = חותכים'],
      ['💣', 'לא את הפצצה!'],
      ['🔥', '3 בהחלקה אחת = בונוס'],
    ],
    durationMs: 60_000,
    maxRaw: 20_000,
    mode: 'score',
  },
};

/** GameMeta.holdMs of a round that lasts `durationMs` (a test round is shorter: the hold shrinks with it). */
export function clockTailMs(gameId: GameId, durationMs: number): number {
  const meta = GAMES[gameId];
  const hold = meta.holdMs ?? 0;
  if (hold <= 0 || meta.durationMs <= 0) return 0;
  return Math.max(0, Math.round((durationMs * hold) / meta.durationMs));
}

// ───────────────────────────── Timing ─────────────────────────────

/**
 * Instructions screen before the countdown, on the TV and on every phone: with the 3-2-1 the
 * game starts 30 s after the intro opens (the owner: "the instructions are played like 30 seconds
 * until the game starts").
 */
export const INTRO_MS = 27_000;
/**
 * 3-2-1 countdown right before `round.startAt`. Every screen draws it from the server clock (the
 * TV and the phones switch to it at `startAt - COUNTDOWN_MS` by the clock, not when the phase
 * message arrives) and the TV plays its beeps and the start gong scheduled on the audio clock at
 * those exact instants.
 */
export const COUNTDOWN_MS = 3_000;
/** After `round.endAt` the server waits this long for `player:final` before scoring. */
export const FINAL_GRACE_MS = 1_500;
/** After a mid-game cutscene the game stays frozen for a 3-2-1 before it continues. */
export const RESUME_COUNTDOWN_MS = 3_000;
/** A cutscene the TV never reports as finished is ended by the server after this long. */
export const CUTSCENE_MAX_MS = 90_000;
/** Suspense between the start of the results phase and the round winner's reveal. */
export const WINNER_REVEAL_MS = 8_000;
/** Elimination rounds: the round ends this long after one player (or nobody) is left. */
export const ELIMINATION_END_DELAY_MS = 1_500;
/** Elimination rounds: the finale begins this long (of round time) after the server announces it. */
export const FINALE_LEAD_MS = 3_000;
/** Elimination rounds: this many players left starts the finale (fewer when the round started with 4 or fewer, see RoundPublic.finale). */
export const FINALE_PLAYERS = 3;
/** Elimination rounds with 1 or 2 participants: the finale begins at this elapsed round time. */
export const FINALE_SMALL_FIELD_MS = 20_000;
/** Elimination rounds: the finale begins at this elapsed round time at the latest, however many are left. */
export const FINALE_LATEST_MS = 60_000;
/** Clients send `player:score` at most this often while playing. */
export const SCORE_SEND_INTERVAL_MS = 250;
/** Server broadcasts the live `scores` event at most this often. */
export const SCORE_BROADCAST_INTERVAL_MS = 250;
/** A phone in the dressing room sends `player:look` at most this often (always the latest look). */
export const LOOK_SEND_INTERVAL_MS = 250;
/** Server broadcasts the `looks` event (the looks that changed, not the room state) at most this often per room. */
export const LOOK_BROADCAST_INTERVAL_MS = 200;

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
  /**
   * The player's dressed Shimi doll: an encoded look (shared/avatar.ts, `encodeLook`),
   * always valid (the server stores `encodeLook(decodeLook(text))`). Draw it with
   * `<Avatar look={player.look} />` (client/src/avatar). A player who never dressed has
   * a random look the server gave on the first join. A change is announced with the
   * small `looks` event, not with a `state` broadcast.
   */
  readonly look: string;
  readonly connected: boolean;
  /** Cumulative competition points. */
  readonly total: number;
  /**
   * Strict overall rank, 1-based: 1..n with no repeats, never shared. Decided
   * by the server (total, then round wins, then best single round, then the
   * position in the most recent round, then join order). Screens show this
   * rank and never derive one from totals.
   */
  readonly rank: number;
}

export interface RoundPublic {
  /**
   * Id of the round inside the room: 0 for the first round ever started, then
   * +1 for every started round. Never reused - not after a cancelled intro and
   * not after a competition reset - so clients may key per-round memory on it.
   * For display use `number`.
   */
  readonly index: number;
  /** 1-based position of this round in the current competition (what "סיבוב N" shows). */
  readonly number: number;
  readonly gameId: GameId;
  /** Same seed for every player, so every phone gets the same level. */
  readonly seed: number;
  /** Server epoch ms. The intro runs until `startAt - countdownMs`. */
  readonly startAt: number;
  /**
   * How long this round's 3-2-1 is (COUNTDOWN_MS; shorter only under the test timing). Every
   * screen turns the intro into the 3-2-1 at `startAt - countdownMs` by the server clock.
   */
  readonly countdownMs: number;
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
  /**
   * Elimination rounds only (null for score rounds and until it is decided): the finale
   * ("only 3 left") begins when the round's ELAPSED time (roundTime().elapsedMs) reaches
   * `atElapsedMs`. Set once by the server and never changed: at the moment the number of
   * active players drops to the threshold (3; participants - 1 when the round started with
   * 3 or 4), as that moment's elapsed time + FINALE_LEAD_MS; for a round of 1 or 2 at round
   * start, as FINALE_SMALL_FIELD_MS; and at FINALE_LATEST_MS at the latest. Being round
   * time, a cutscene freeze shifts nothing. From then on the game gets harder as a pure
   * function of (seed, elapsed - atElapsedMs), the same on every phone.
   */
  readonly finale: { readonly atElapsedMs: number } | null;
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
  /** The player's look (PlayerPublic.look). Kept current: a later look change updates the row too. */
  readonly look: string;
  /** Raw in-game score of this round. */
  readonly raw: number;
  /** Competition points awarded for this round (0..~1100). */
  readonly points: number;
  /**
   * 1-based strict position within this round: 1..n, never shared. Raw score
   * descending; on the same raw score whoever reached it first is ahead.
   */
  readonly roundRank: number;
  /**
   * Server epoch ms at which this player's score last changed to `raw` (the
   * tie-break between equal raw scores); null for a player who scored nothing.
   */
  readonly reachedAt: number | null;
  /** Cumulative points after this round. */
  readonly total: number;
  /** 1-based strict overall rank after this round (1..n, never shared). */
  readonly rank: number;
  /** Strict overall rank before this round, or null for a first appearance. */
  readonly prevRank: number | null;
}

export interface RoundResults {
  /** `RoundPublic.index` of the round these results belong to. */
  readonly roundIndex: number;
  /** `RoundPublic.number` of that round (1-based, for display). */
  readonly roundNumber: number;
  readonly gameId: GameId;
  /** Sorted by `rank` (overall), which is strict: 1..n. */
  readonly rows: readonly ResultRow[];
  /**
   * The winner of THIS round: exactly ONE id (the player with roundRank 1)
   * whenever anybody scored, empty when nobody did. Never two: equal raw
   * scores are decided by who reached the score first. The round winner gets
   * the prize, so the TV runs a winner ceremony with the victory song.
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
  /**
   * How many phone remotes (`remote:attach`) are attached to this room right
   * now. The TV hides its own controls while this is above 0. Nothing else
   * about remotes is ever part of the state.
   */
  readonly remotes: number;
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
  | 'KICKED'
  /** remote:attach: the password is wrong (or missing). */
  | 'BAD_PASSWORD'
  /** remote:attach: too many wrong passwords; `retryMs` says how long to wait. */
  | 'THROTTLED'
  /** remote:attach without a code: more than one room has a TV connected; pick one of `rooms`. */
  | 'CHOOSE_ROOM';

// ───────────────────────────── Remote (the host's phone) ─────────────────────────────

/** Which kind of host socket: the TV page ('screen', host:create) or a phone remote ('remote', remote:attach). */
export type HostRole = 'screen' | 'remote';

export type RelayJson = string | number | boolean | null | readonly RelayJson[] | { readonly [key: string]: RelayJson };
/** What the hosts of one room tell each other (the TV's control model, a remote's button press). A small JSON object. */
export type RelayData = { readonly [key: string]: RelayJson };

/** The server refuses a relay payload larger than this (JSON bytes). */
export const RELAY_MAX_BYTES = 16 * 1024;
/** ...and more than this many relays per second from one socket. */
export const RELAY_MAX_PER_SECOND = 20;

/** remote:attach failed. `rooms` lists the rooms with a TV (CHOOSE_ROOM / ROOM_NOT_FOUND after a right password, else empty). */
export interface RemoteAttachFailure {
  readonly ok: false;
  readonly error: ErrorCode;
  readonly message: string;
  readonly rooms: readonly string[];
  /** THROTTLED: ms until the next try is accepted; null otherwise. */
  readonly retryMs: number | null;
}

export type RemoteAttachAck = { readonly ok: true; readonly code: string; readonly state: RoomState; readonly rooms: readonly string[] } | RemoteAttachFailure;

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
   * Attach this socket as a HOST of a room with role 'remote' (the owner's phone).
   * The password is checked only by the server (constant time, guesses throttled).
   * Without `code`: the room whose TV is connected; CHOOSE_ROOM when several are,
   * ROOM_NOT_FOUND when none is. Every host:* event then works from this socket.
   */
  'remote:attach': (req: { password: string; code?: string }, ack: (res: RemoteAttachAck) => void) => void;
  /**
   * Host sockets only: forwarded to the OTHER host sockets of the same room as
   * S2C `relay`. `data` is a small JSON object (RELAY_MAX_BYTES), at most
   * RELAY_MAX_PER_SECOND per socket.
   */
  'host:relay': (req: { data: RelayData }, ack: (res: Ack<{}>) => void) => void;

  /**
   * Join a room, or resume as the same player after a refresh/reconnect when
   * `playerId` + `secret` match (name is then updated if provided).
   * Joining is allowed in any phase; a mid-round joiner plays from the next round.
   * `look` (an encoded look, shared/avatar.ts) is used for a NEW player only: without it,
   * or when it is not a look, the server gives a random doll. A resume keeps the look the
   * server has (the phone sends a newer one with `player:look`).
   */
  'player:join': (
    req: { code: string; name: string; playerId?: string; secret?: string; look?: string },
    ack: (res: Ack<{ playerId: string; secret: string; state: RoomState }>) => void,
  ) => void;
  /**
   * This player's doll changed in the dressing room. Accepted in every phase. The server
   * stores `encodeLook(decodeLook(look))` and answers with it; text that is not a look is
   * refused (BAD_REQUEST) and the look stays. Everyone else hears it through `looks`.
   * Phones send it at most every LOOK_SEND_INTERVAL_MS.
   */
  'player:look': (req: { look: string }, ack: (res: Ack<{ look: string }>) => void) => void;
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
  /**
   * Live raw scores of the running round, as [playerId, score] pairs, sent to
   * every socket in the room (the TV and every phone). Guaranteed order: the
   * strict round order applied to the live values (score descending, then the
   * server time that value was reached ascending, then join order), i.e. the
   * same order the results use. A player's live place is its index + 1, and
   * the last message of a round is in the order of the results' `roundRank`.
   * Lists every participant of the round, including those still on 0.
   * `active`: participants still playing (connected, or disconnected for less than the 5 s
   * grace, and no final sent). `out`: ids of the participants whose final is in (in an
   * elimination round: who is out). Both are sent for every game.
   */
  scores: (msg: { round: number; scores: ReadonlyArray<readonly [string, number]>; active: number; out: readonly string[] }) => void;
  /**
   * Looks that changed, as [playerId, look] pairs, to every socket in the room: patch
   * `PlayerPublic.look` (and `ResultRow.look`) of those players (`applyLooks` in
   * shared/room-looks.ts). Sent at most every LOOK_BROADCAST_INTERVAL_MS per room, however
   * many guests are dressing. Every `state` carries all looks, so a missed message heals itself.
   */
  looks: (msg: { looks: ReadonlyArray<readonly [string, string]> }) => void;
  /** This player was removed by the host. */
  kicked: () => void;
  /** Host sockets only: what another host socket of the same room sent with `host:relay`. */
  relay: (msg: { from: HostRole; data: RelayData }) => void;
}
