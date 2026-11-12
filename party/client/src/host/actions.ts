/**
 * The host's ACTION MODEL: at every moment, the list of things the host can do
 * right now, computed from the room snapshot and a few TV-local facts. The TV's
 * control strip, its menus and its keyboard shortcuts read this model and run
 * every action through one dispatcher (app.tsx); the phone remote receives the
 * same model over the relay and sends back { id, arg }. So the TV and the
 * remote can never disagree about what a button does.
 *
 * Pure: no DOM, no preact, no sockets (unit tested in tests/unit/host-actions.test.ts).
 */
import { CUTSCENES } from '../../../shared/cutscenes';
import { GAME_IDS, GAMES } from '../../../shared/protocol';

import type { GameId, Phase, RelayData, RoomState } from '../../../shared/protocol';

export const ACTION_IDS = [
  'next', // start the next unplayed game
  'start', // start the game in `arg`
  'continue', // results → lobby
  'podium', // lobby | results → final
  'end-round', // intro / countdown → lobby, playing → results
  'lobby', // results (all played) | final → lobby
  'replay', // TV-local: the ceremony / podium once more
  'reset', // zero the competition
  'kick', // remove the player `arg`
  'cutscene', // play the cutscene `arg`
  'cutscene-skip', // end the cutscene that plays
  'auto-cutscenes', // toggle; arg 'on' | 'off' (or flip)
  'mute', // TV-local toggle
  'calm', // TV-local toggle (fewer jokes on screen)
  'fullscreen', // TV only
  'cutscene-menu', // TV only: the cutscene menu
  'more-menu', // TV only: the ☰ menu
  'sound-check', // TV only (lobby)
  'new-room', // TV only: a fresh room code
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export type ActionKind = 'primary' | 'normal' | 'danger' | 'toggle';

/** One entry of an action's group (a game, a cutscene, a player). */
export interface ActionItem {
  /** What goes back as the action's `arg`. */
  readonly arg: string;
  readonly label: string;
  readonly icon: string;
  readonly mark: 'played' | 'next' | 'away' | null;
  readonly enabled: boolean;
}

export interface ControlAction {
  readonly id: ActionId;
  /** Hebrew. */
  readonly label: string;
  readonly icon: string;
  readonly kind: ActionKind;
  readonly enabled: boolean;
  /** Belongs to the main row right now (the TV's strip, the remote's secondary row). */
  readonly featured: boolean;
  /** Toggles: the current value. */
  readonly on?: boolean;
  /** Asked before it runs. `{item}` is replaced by the chosen item's label. */
  readonly confirm?: string;
  readonly confirmText?: string;
  readonly confirmYes?: string;
  /** How the TV asks: a second press of the same button / key ('arm') or a dialog. */
  readonly confirmStyle?: 'arm' | 'dialog';
  /** Keyboard shortcut on the TV. */
  readonly kbd?: string;
  /** Only on the TV page itself (the remote never shows it). */
  readonly tvOnly?: boolean;
  /** Needs one of `items` as its arg. */
  readonly items?: readonly ActionItem[];
}

export interface ControlModel {
  readonly v: 1;
  /** Changes whenever the screen moves on (room, phase, round, results): a press made on an older key is stale. */
  readonly key: string;
  readonly phase: Phase | null;
  /** What happens next, in one line. */
  readonly hint: string;
  /** The next step (the big button), or null. */
  readonly primary: ActionId | null;
  readonly actions: readonly ControlAction[];
}

export interface ModelInput {
  readonly state: RoomState | null;
  /** Results phase: the winner ceremony is over (the TV's own pacing; replays included). */
  readonly ceremonyDone: boolean;
  readonly muted: boolean;
  readonly calm: boolean;
  readonly fullscreen: boolean;
}

export function nextUnplayed(played: readonly GameId[]): GameId | null {
  return GAME_IDS.find((g) => !played.includes(g)) ?? null;
}

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);
}

export function isActionId(value: unknown): value is ActionId {
  return typeof value === 'string' && (ACTION_IDS as readonly string[]).includes(value);
}

/** The key of a screen: room, phase, round and results. */
export function screenKey(state: RoomState | null): string {
  if (state === null) return 'none';
  return `${state.code}:${state.phase}:${state.round?.index ?? -1}:${state.results?.roundIndex ?? -1}`;
}

const SKIP_CEREMONY = 'לדלג על הטקס?';

export function buildControlModel(input: ModelInput): ControlModel {
  const { state } = input;
  const phase = state?.phase ?? null;
  const cut = state !== null && state.cutscene !== null;
  const played = state?.played ?? [];
  const allPlayed = GAME_IDS.every((g) => played.includes(g));
  const next = nextUnplayed(played);
  const between = phase === 'lobby' || phase === 'results';
  const running = phase === 'intro' || phase === 'countdown' || phase === 'playing';
  const early = phase === 'results' && !input.ceremonyDone;
  const players = state?.players ?? [];
  const canStart = state !== null && between && !cut;

  const games: ActionItem[] = GAME_IDS.map((g) => ({
    arg: g,
    label: GAMES[g].title,
    icon: GAMES[g].emoji,
    mark: played.includes(g) ? 'played' : g === next ? 'next' : null,
    enabled: canStart,
  }));

  const skip = early ? { confirm: SKIP_CEREMONY, confirmStyle: 'arm' as const } : {};
  const actions: ControlAction[] = [];

  actions.push({
    id: 'next',
    label: next !== null ? `המשחק הבא: ${GAMES[next].title}` : 'שיחקנו הכל',
    icon: next !== null ? GAMES[next].emoji : '✓',
    kind: phase === 'lobby' && next !== null ? 'primary' : 'normal',
    enabled: canStart && next !== null,
    featured: false,
    kbd: 'N',
    ...skip,
  });
  actions.push({
    id: 'start',
    label: 'התחלת משחק',
    icon: '▶',
    kind: 'normal',
    enabled: canStart,
    featured: false,
    items: games,
    ...skip,
  });

  const continueLabel = 'המשך ללובי';
  actions.push({
    id: 'continue',
    label: early ? `${continueLabel} (מדלג על הטקס)` : continueLabel,
    icon: early ? '⏭' : '⏩',
    kind: phase === 'results' && !allPlayed ? 'primary' : 'normal',
    enabled: phase === 'results' && !cut,
    featured: false,
    kbd: 'Space',
    ...skip,
  });

  // the podium: the end of the night when every game was played, a decision before that
  const podiumEarlyLobby = phase === 'lobby' && !allPlayed;
  const podiumPrimary = (phase === 'lobby' && allPlayed) || (phase === 'results' && allPlayed);
  actions.push({
    id: 'podium',
    label: podiumPrimary ? (early ? 'פודיום סופי (מדלג על הטקס)' : 'פודיום סופי') : 'לפודיום',
    icon: podiumPrimary && early ? '⏭' : '🏆',
    kind: podiumPrimary ? 'primary' : podiumEarlyLobby ? 'danger' : 'normal',
    enabled: state !== null && between && !cut,
    featured: phase === 'lobby' && played.length > 0 && !allPlayed,
    ...(podiumEarlyLobby ? { confirm: 'עוד לא שיחקנו הכל. לסיים?', confirmStyle: 'arm' as const } : podiumPrimary ? skip : {}),
  });

  actions.push({
    id: 'end-round',
    label: phase === 'playing' ? 'סיים סיבוב עכשיו' : 'בטל סיבוב',
    icon: '⏹',
    kind: 'danger',
    enabled: running,
    featured: running,
    kbd: 'E',
    ...(phase === 'playing' ? { confirm: 'לסיים את הסיבוב?', confirmStyle: 'arm' as const } : {}),
  });

  actions.push({
    id: 'lobby',
    label: phase === 'final' ? 'ללובי' : 'המשך ללובי',
    icon: phase === 'final' ? '🏠' : '⏩',
    kind: 'normal',
    enabled: (phase === 'results' || phase === 'final') && !cut,
    featured: (phase === 'results' && allPlayed) || phase === 'final',
  });

  actions.push({
    id: 'replay',
    label: phase === 'final' ? 'הפודיום שוב' : 'הטקס שוב',
    icon: '🔁',
    kind: 'normal',
    enabled: (phase === 'results' || phase === 'final') && !cut,
    featured: phase === 'results' || phase === 'final',
    kbd: 'R',
  });

  actions.push({
    id: 'reset',
    label: phase === 'final' ? 'תחרות חדשה' : 'איפוס התחרות',
    icon: phase === 'final' ? '🔄' : '♻️',
    kind: phase === 'final' ? 'primary' : 'danger',
    enabled: state !== null,
    featured: phase === 'lobby' && played.length > 0,
    confirm: 'לאפס את התחרות?',
    confirmText: 'כל הנקודות מתאפסות והמשחקים חוזרים להתחלה. השחקנים נשארים בחדר.',
    confirmYes: 'כן, מתחילים מחדש',
    confirmStyle: 'dialog',
  });

  actions.push({
    id: 'kick',
    label: 'הוצאת שחקן',
    icon: '🚪',
    kind: 'danger',
    enabled: players.length > 0,
    featured: false,
    confirm: 'להוציא את {item}?',
    confirmText: 'השחקן יוצא מהחדר ויצטרך להצטרף מחדש.',
    confirmYes: 'להוציא',
    confirmStyle: 'dialog',
    items: players.map((p) => ({ arg: p.id, label: p.name, icon: p.connected ? '🙂' : '💤', mark: p.connected ? null : 'away', enabled: true })),
  });

  actions.push({
    id: 'cutscene',
    label: 'סרטונים',
    icon: '🎬',
    kind: 'normal',
    enabled: state !== null && !cut,
    featured: false,
    items: CUTSCENES.map((c) => ({ arg: c.id, label: c.title, icon: '🎬', mark: null, enabled: state !== null && !cut })),
  });

  actions.push({
    id: 'cutscene-skip',
    label: 'דילוג על הסרטון',
    icon: '⏭',
    kind: cut ? 'primary' : 'normal',
    enabled: cut,
    featured: false,
    kbd: 'S',
  });

  actions.push({
    id: 'auto-cutscenes',
    label: 'סרטונים אוטומטיים',
    icon: '🎞',
    kind: 'toggle',
    on: state?.autoCutscenes ?? true,
    enabled: state !== null,
    featured: false,
  });
  actions.push({ id: 'mute', label: 'השתקת הטלוויזיה', icon: input.muted ? '🔇' : '🔊', kind: 'toggle', on: input.muted, enabled: true, featured: false, kbd: 'M' });
  actions.push({ id: 'calm', label: 'מצב רגוע (פחות בדיחות)', icon: '😌', kind: 'toggle', on: input.calm, enabled: true, featured: false });

  actions.push({ id: 'fullscreen', label: 'מסך מלא', icon: input.fullscreen ? '🗗' : '⛶', kind: 'toggle', on: input.fullscreen, enabled: true, featured: false, kbd: 'F', tvOnly: true });
  actions.push({ id: 'cutscene-menu', label: 'סרטונים', icon: '🎬', kind: 'normal', enabled: state !== null, featured: false, kbd: 'C', tvOnly: true });
  actions.push({ id: 'more-menu', label: 'עוד', icon: '☰', kind: 'normal', enabled: true, featured: false, tvOnly: true });
  actions.push({
    id: 'sound-check',
    label: phase === 'lobby' ? 'בדיקת סאונד' : 'בדיקת סאונד (רק בלובי)',
    icon: '🎵',
    kind: 'normal',
    enabled: phase === 'lobby',
    featured: false,
    tvOnly: true,
  });
  actions.push({
    id: 'new-room',
    label: 'חדר חדש (קוד חדש)',
    icon: '🆕',
    kind: 'danger',
    enabled: true,
    featured: false,
    tvOnly: true,
    confirm: 'לפתוח חדר חדש?',
    confirmText: 'נוצר קוד חדש ו-QR חדש. כל השחקנים יצטרכו לסרוק שוב.',
    confirmYes: 'חדר חדש',
    confirmStyle: 'dialog',
  });

  let primary: ActionId | null = null;
  if (cut) primary = 'cutscene-skip';
  else if (phase === 'lobby') primary = next !== null ? 'next' : 'podium';
  else if (phase === 'results') primary = allPlayed ? 'podium' : 'continue';
  else if (phase === 'final') primary = 'reset';
  else if (running) primary = 'end-round';

  return { v: 1, key: screenKey(state), phase, hint: hintFor(input, next, allPlayed), primary, actions };
}

function hintFor(input: ModelInput, next: GameId | null, allPlayed: boolean): string {
  const { state } = input;
  if (state === null) return 'מתחברים לשרת…';
  if (state.cutscene !== null) return '🎬 סרטון רץ על המסך';
  switch (state.phase) {
    case 'lobby': {
      if (state.players.length === 0) return 'מחכים לשחקנים · הקוד על המסך';
      if (next === null) return 'שיחקנו הכל! הזמן לפודיום';
      return `${state.players.length} בפנים · הבא בתור: ${GAMES[next].title}`;
    }
    case 'intro':
    case 'countdown':
      return '⏳ המשחק מתחיל לבד';
    case 'playing':
      return '⏳ הסיבוב רץ · התוצאות יופיעו לבד';
    case 'results':
      if (!input.ceremonyDone) return '🏆 טקס המנצח רץ…';
      return allPlayed ? 'הטקס נגמר · לפודיום הסופי' : 'הטקס נגמר · ממשיכים ללובי';
    case 'final':
      return '🏆 הפודיום! · תחרות חדשה מאפסת הכל';
    default: {
      const _exhaustive: never = state.phase;
      throw new Error(`Unhandled phase: ${String(_exhaustive)}`);
    }
  }
}

export function findAction(model: ControlModel, id: ActionId): ControlAction | undefined {
  return model.actions.find((a) => a.id === id);
}

/** The question for `action` with `arg` filled in (the item's label), or null when it asks nothing. */
export function confirmQuestion(action: ControlAction, arg?: string): string | null {
  if (action.confirm === undefined) return null;
  const item = arg !== undefined ? action.items?.find((i) => i.arg === arg) : undefined;
  return action.confirm.replace('{item}', item?.label ?? '');
}

/** Actions whose press is refused when it was made on an older screen (the double-tap guard of the remote). */
const STALE_SENSITIVE: ReadonlySet<ActionId> = new Set<ActionId>(['next', 'start', 'continue', 'podium', 'end-round', 'lobby', 'replay', 'reset']);

export type ActionCheck = { readonly ok: true } | { readonly ok: false; readonly text: string };

/**
 * May a press of `id` with `arg`, made while the presser saw the screen `key`,
 * run now? The TV checks every press from a remote with this; its own
 * buttons and keys pass `key` = the current key.
 */
export function checkAction(model: ControlModel, id: ActionId, arg: string | undefined, key: string | undefined): ActionCheck {
  const action = findAction(model, id);
  if (action === undefined || !action.enabled) return { ok: false, text: 'אי אפשר את זה עכשיו' };
  if (key !== undefined && key !== model.key && STALE_SENSITIVE.has(id)) return { ok: false, text: 'המסך כבר התקדם. נסו שוב' };
  if (action.items !== undefined) {
    const item = action.items.find((i) => i.arg === arg);
    if (item === undefined || !item.enabled) return { ok: false, text: 'לא נמצא. נסו שוב' };
  }
  return { ok: true };
}

// ───────────────────────────── relay messages ─────────────────────────────

/** TV → remotes and remotes → TV, inside `host:relay` / `relay`. */
export type RelayMsg =
  | { readonly t: 'model'; readonly model: ControlModel }
  | { readonly t: 'hello' }
  | { readonly t: 'run'; readonly rid: string; readonly req: number; readonly id: ActionId; readonly arg?: string; readonly key: string; readonly confirmed: boolean }
  | { readonly t: 'result'; readonly rid: string; readonly req: number; readonly ok: boolean; readonly text: string };

export function toRelay(msg: RelayMsg): RelayData {
  return msg as unknown as RelayData;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isModel(v: unknown): v is ControlModel {
  return isRecord(v) && v.v === 1 && typeof v.key === 'string' && typeof v.hint === 'string' && Array.isArray(v.actions);
}

/** A relay payload as a RelayMsg, or null (anything else is ignored). */
export function parseRelay(data: unknown): RelayMsg | null {
  if (!isRecord(data)) return null;
  switch (data.t) {
    case 'model':
      return isModel(data.model) ? { t: 'model', model: data.model } : null;
    case 'hello':
      return { t: 'hello' };
    case 'run':
      if (typeof data.rid !== 'string' || typeof data.req !== 'number' || !isActionId(data.id) || typeof data.key !== 'string') return null;
      return {
        t: 'run',
        rid: data.rid,
        req: data.req,
        id: data.id,
        ...(typeof data.arg === 'string' ? { arg: data.arg } : {}),
        key: data.key,
        confirmed: data.confirmed === true,
      };
    case 'result':
      if (typeof data.rid !== 'string' || typeof data.req !== 'number' || typeof data.ok !== 'boolean') return null;
      return { t: 'result', rid: data.rid, req: data.req, ok: data.ok, text: typeof data.text === 'string' ? data.text : '' };
    default:
      return null;
  }
}

/** The model as the remote gets it: no TV-only actions. */
export function remoteView(model: ControlModel): ControlModel {
  return { ...model, actions: model.actions.filter((a) => a.tvOnly !== true) };
}
