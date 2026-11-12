/**
 * The phone remote's pure parts: what the big button does, the top five,
 * the labels of the status header. No DOM, no sockets (unit tested).
 */
import { GAMES } from '../../../shared/protocol';
import { roundTime } from '../../../shared/round-clock';
import { confirmQuestion, findAction } from '../host/actions';

import type { GameId, Phase, RoomState } from '../../../shared/protocol';
import type { ActionId, ActionKind, ControlAction, ControlModel } from '../host/actions';

export const PHASE_TEXT: Readonly<Record<Phase, string>> = {
  lobby: 'לובי',
  intro: 'הסבר',
  countdown: 'ספירה',
  playing: 'משחק',
  results: 'תוצאות',
  final: 'פודיום',
};

export function phaseText(state: RoomState | null): string {
  if (state === null) return '…';
  if (state.cutscene !== null) return 'סרטון';
  return PHASE_TEXT[state.phase];
}

/** "1:05" / "0:09". */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The round clock line of the header, or null outside a round. */
export function roundClockText(state: RoomState | null, serverNow: number): string | null {
  const r = state?.round;
  if (state === null || r === null || r === undefined) return null;
  const rt = roundTime(r, serverNow);
  if (state.phase === 'intro' || state.phase === 'countdown') return `מתחיל בעוד ${clockText(-rt.elapsedMs)}`;
  if (state.phase === 'playing') return rt.frozen && state.cutscene !== null ? `⏸ ${clockText(rt.leftMs)}` : `נשארו ${clockText(rt.leftMs)}`;
  return null;
}

export interface TopRow {
  readonly place: number;
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly connected: boolean;
  /** Elimination round: this one is out (false for everyone still in the air, and in other games). */
  readonly out: boolean;
}

/**
 * The first five of the live `scores` broadcast (already in the strict live order). In an
 * elimination round (`outIds` given) the ones still in the air come first and the raw number
 * means nothing to the owner: the rows say who is in and who is out, like the TV.
 */
export function topFive(state: RoomState | null, scores: ReadonlyArray<readonly [string, number]>, outIds: readonly string[] | null = null): TopRow[] {
  if (state === null) return [];
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const isOut = new Set(outIds ?? []);
  const ordered = outIds === null ? scores : [...scores.filter(([id]) => !isOut.has(id)), ...scores.filter(([id]) => isOut.has(id))];
  const rows: TopRow[] = [];
  for (const [id, score] of ordered) {
    const p = byId.get(id);
    if (p === undefined) continue;
    rows.push({ place: rows.length + 1, id, name: p.name, score, connected: p.connected, out: isOut.has(id) });
    if (rows.length === 5) break;
  }
  return rows;
}

/** The live top's count line: "N באוויר" in an elimination round, else who is connected. */
export function liveCountText(state: RoomState | null, active: number | null): string {
  const gameId = state?.round?.gameId;
  if (gameId !== undefined && GAMES[gameId].mode === 'elimination' && active !== null && state?.phase === 'playing') {
    return `${active} באוויר`;
  }
  const { online, total } = connectedCount(state);
  return `${online} מתוך ${total} מחוברים`;
}

export function connectedCount(state: RoomState | null): { readonly online: number; readonly total: number } {
  const players = state?.players ?? [];
  return { online: players.filter((p) => p.connected).length, total: players.length };
}

/** What the big button does right now. */
export interface BigButton {
  readonly id: ActionId;
  readonly arg?: string;
  readonly label: string;
  readonly icon: string;
  readonly kind: ActionKind;
  readonly enabled: boolean;
  /** Ask "sure?" first (a confirm question, or any danger action). */
  readonly ask: string | null;
  readonly askText?: string;
  readonly askYes?: string;
}

/** Danger actions always ask on the phone; others ask when the model gives a question. */
export function askFor(action: ControlAction, arg?: string): string | null {
  const q = confirmQuestion(action, arg);
  if (q !== null) return q;
  return action.kind === 'danger' ? 'בטוח?' : null;
}

/**
 * The big button: the model's primary, unless the host picked a game in the
 * picker (then: start that game). Picking never starts anything by itself.
 */
export function bigButton(model: ControlModel, selected: GameId | null): BigButton | null {
  const start = findAction(model, 'start');
  if (selected !== null && start !== undefined && start.enabled) {
    const g = GAMES[selected];
    return {
      id: 'start',
      arg: selected,
      label: `התחלת ${g.title}`,
      icon: g.emoji,
      kind: 'primary',
      enabled: true,
      ask: confirmQuestion(start, selected),
    };
  }
  if (model.primary === null) return null;
  const a = findAction(model, model.primary);
  if (a === undefined) return null;
  return {
    id: a.id,
    label: a.label,
    icon: a.icon,
    kind: a.kind,
    enabled: a.enabled,
    ask: askFor(a),
    ...(a.confirmText !== undefined ? { askText: a.confirmText } : {}),
    ...(a.confirmYes !== undefined ? { askYes: a.confirmYes } : {}),
  };
}

/** The game tile that is lit when nothing was picked: the next one, in the lobby. */
export function defaultPick(model: ControlModel): GameId | null {
  if (model.phase !== 'lobby') return null;
  const item = findAction(model, 'start')?.items?.find((i) => i.mark === 'next');
  return item !== undefined ? (item.arg as GameId) : null;
}

/** The secondary row: the model's featured actions that are not the big button. */
export function secondaryActions(model: ControlModel, big: BigButton | null): ControlAction[] {
  return model.actions.filter((a) => a.featured && a.enabled && a.tvOnly !== true && a.id !== big?.id).slice(0, 3);
}

/** A remote instance id: tells this phone's results from another remote's. */
export function makeRid(): string {
  return Math.random().toString(36).slice(2, 10);
}
