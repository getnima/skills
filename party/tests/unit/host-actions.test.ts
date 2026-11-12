/**
 * The host's action model (client/src/host/actions.ts) for every phase, the
 * remote's pure helpers (client/src/remote/logic.ts), and the room's host
 * roles. The states come from a real Room on a manual clock.
 */
import { describe, expect, it } from 'vitest';

import { CUTSCENES } from '../../shared/cutscenes';
import { GAME_IDS, GAMES, MAX_PLAYERS, RELAY_MAX_BYTES, WINNER_REVEAL_MS } from '../../shared/protocol';
import { Room } from '../../server/room';
import {
  buildControlModel,
  checkAction,
  confirmQuestion,
  findAction,
  parseRelay,
  remoteView,
  screenKey,
  toRelay,
} from '../../client/src/host/actions';
import { askFor, bigButton, defaultPick, phaseText, roundClockText, secondaryActions, topFive } from '../../client/src/remote/logic';

import type { CutsceneDef } from '../../shared/cutscenes';
import type { GameId, RoomState } from '../../shared/protocol';
import type { ActionId, ControlModel, ModelInput } from '../../client/src/host/actions';
import type { RoomSink, Scheduler } from '../../server/room';

// ───────────────────────────── a room on a manual clock ─────────────────────────────

interface Timer {
  at: number;
  fn: () => void;
  id: number;
}

function manualScheduler(start = 1_800_000_000_000): Scheduler & { advance(ms: number): void } {
  let now = start;
  let seq = 0;
  let timers: Timer[] = [];
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      seq += 1;
      timers.push({ at: now + Math.max(0, ms), fn, id: seq });
      return seq;
    },
    clearTimeout: (h) => {
      timers = timers.filter((t) => t.id !== h);
    },
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (t === undefined || t.at > end) break;
        timers.shift();
        now = t.at;
        t.fn();
      }
      now = end;
    },
  };
}

const TIMING = { introMs: 1_000, countdownMs: 1_000, durationMs: (): number => 5_000 };
const JOKER: CutsceneDef = { id: 'joker_1', title: 'ג׳וקר 1', file: 'joker_1.mp4', when: { at: 'manual' } };

function makeRoom(): { room: Room; clock: ReturnType<typeof manualScheduler>; broadcasts: RoomState[] } {
  const clock = manualScheduler();
  const broadcasts: RoomState[] = [];
  const sink: RoomSink = { state: (s) => broadcasts.push(s), scores: () => undefined, kicked: () => undefined };
  let n = 0;
  const room = new Room('ABCD', 'key', { sink, scheduler: clock, timing: TIMING, cutscenes: [JOKER], token: () => `t${++n}`, seed: () => 7 });
  room.attachHost('tv', 'screen');
  return { room, clock, broadcasts };
}

function join(room: Room, name: string): string {
  const res = room.join(`c-${name}`, { name });
  if (!res.ok) throw new Error('join failed');
  return res.playerId;
}

/** Plays `gameId` to its results (everybody sends a final). */
function playRound(room: Room, clock: ReturnType<typeof manualScheduler>, gameId: GameId, players: readonly string[]): void {
  expect(room.start(gameId).ok).toBe(true);
  clock.advance(2_000);
  const idx = room.snapshot().round?.index ?? -1;
  players.forEach((p, i) => room.final(p, idx, 10 * (i + 1)));
  clock.advance(5_000 + 2_000);
  expect(room.snapshot().phase).toBe('results');
}

const input = (state: RoomState | null, extra: Partial<ModelInput> = {}): ModelInput => ({ state, ceremonyDone: true, muted: false, calm: false, fullscreen: false, ...extra });
const model = (state: RoomState | null, extra: Partial<ModelInput> = {}): ControlModel => buildControlModel(input(state, extra));
const act = (m: ControlModel, id: ActionId) => {
  const a = findAction(m, id);
  if (a === undefined) throw new Error(`no action ${id}`);
  return a;
};
const featured = (m: ControlModel): string[] => m.actions.filter((a) => a.featured && a.enabled).map((a) => a.id);

// ───────────────────────────── the model, phase by phase ─────────────────────────────

describe('action model', () => {
  it('has every action exactly once, whatever the phase', () => {
    const ids = model(null).actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(19);
  });

  it('no state yet: nothing to press but the TV tools', () => {
    const m = model(null);
    expect(m.primary).toBeNull();
    expect(m.hint).toContain('מתחברים');
    expect(m.actions.filter((a) => a.enabled).map((a) => a.id).sort()).toEqual(['calm', 'fullscreen', 'more-menu', 'mute', 'new-room']);
  });

  it('lobby, no players: the next game is the primary; nothing to kick', () => {
    const { room } = makeRoom();
    const m = model(room.snapshot());
    expect(m.phase).toBe('lobby');
    expect(m.primary).toBe('next');
    expect(act(m, 'next')).toMatchObject({ kind: 'primary', enabled: true, label: `המשחק הבא: ${GAMES.tap.title}` });
    expect(act(m, 'next').confirm).toBeUndefined();
    expect(m.hint).toContain('מחכים לשחקנים');
    expect(act(m, 'kick').enabled).toBe(false);
    expect(featured(m)).toEqual([]);
    expect(act(m, 'start').items?.map((i) => [i.arg, i.mark])).toEqual(GAME_IDS.map((g) => [g, g === 'tap' ? 'next' : null]));
    expect(act(m, 'sound-check').enabled).toBe(true);
  });

  it('lobby with players: the count in the hint, the players to kick by name', () => {
    const { room } = makeRoom();
    join(room, 'דנה');
    join(room, 'גיא');
    const m = model(room.snapshot());
    expect(m.hint).toContain('2 בפנים');
    expect(m.hint).toContain(GAMES.tap.title);
    const kick = act(m, 'kick');
    expect(kick).toMatchObject({ enabled: true, kind: 'danger', confirmStyle: 'dialog' });
    expect(kick.items?.map((i) => i.label)).toEqual(['דנה', 'גיא']);
    expect(confirmQuestion(kick, kick.items?.[1]?.arg)).toBe('להוציא את גיא?');
  });

  it('intro and countdown: the next step is cancelling the round, without a second press', () => {
    const { room, clock } = makeRoom();
    join(room, 'דנה');
    room.start('icy');
    for (const phase of ['intro', 'countdown'] as const) {
      const m = model(room.snapshot());
      expect(m.phase).toBe(phase);
      expect(m.primary).toBe('end-round');
      expect(act(m, 'end-round')).toMatchObject({ label: 'בטל סיבוב', kind: 'danger', enabled: true, featured: true });
      expect(act(m, 'end-round').confirm).toBeUndefined();
      expect(act(m, 'start').enabled).toBe(false);
      expect(act(m, 'next').enabled).toBe(false);
      expect(m.hint).toContain('מתחיל לבד');
      clock.advance(1_000);
    }
  });

  it('playing: ending early asks first; the rest waits', () => {
    const { room, clock } = makeRoom();
    join(room, 'דנה');
    room.start('tap');
    clock.advance(2_100);
    const m = model(room.snapshot());
    expect(m.phase).toBe('playing');
    expect(m.primary).toBe('end-round');
    expect(act(m, 'end-round')).toMatchObject({ label: 'סיים סיבוב עכשיו', confirm: 'לסיים את הסיבוב?', confirmStyle: 'arm' });
    expect(act(m, 'cutscene').enabled).toBe(true);
    expect(act(m, 'replay').enabled).toBe(false);
    expect(featured(m)).toEqual(['end-round']);
  });

  it('frozen by a cutscene: skipping it is the next step; nothing else starts under the video', () => {
    const { room, clock } = makeRoom();
    join(room, 'דנה');
    room.start('tap');
    clock.advance(2_500);
    room.startCutscene('joker_1');
    const s = room.snapshot();
    expect(s.cutscene).not.toBeNull();
    const m = model(s);
    expect(m.primary).toBe('cutscene-skip');
    expect(act(m, 'cutscene-skip')).toMatchObject({ kind: 'primary', enabled: true });
    expect(act(m, 'cutscene').enabled).toBe(false);
    expect(act(m, 'cutscene').items?.every((i) => !i.enabled)).toBe(true);
    expect(m.hint).toContain('סרטון');
    expect(phaseText(s)).toBe('סרטון');
  });

  it('results before the reveal: continuing skips the ceremony, so it asks; after the reveal it does not', () => {
    const { room, clock } = makeRoom();
    const a = join(room, 'דנה');
    const b = join(room, 'גיא');
    playRound(room, clock, 'tap', [a, b]);
    const s = room.snapshot();
    const early = model(s, { ceremonyDone: false });
    expect(early.primary).toBe('continue');
    expect(act(early, 'continue')).toMatchObject({ confirm: 'לדלג על הטקס?', confirmStyle: 'arm', icon: '⏭' });
    expect(act(early, 'continue').label).toContain('מדלג על הטקס');
    expect(act(early, 'next').confirm).toBe('לדלג על הטקס?');
    expect(act(early, 'start').confirm).toBe('לדלג על הטקס?');
    expect(early.hint).toContain('טקס');
    const late = model(s, { ceremonyDone: true });
    expect(act(late, 'continue').confirm).toBeUndefined();
    expect(act(late, 'continue').label).toBe('המשך ללובי');
    expect(featured(late)).toEqual(['replay']);
    expect(late.key).toBe(early.key);
    expect(act(late, 'start').items?.find((i) => i.arg === 'tap')?.mark).toBe('played');
    expect(act(late, 'start').items?.find((i) => i.arg === 'icy')?.mark).toBe('next');
    expect(WINNER_REVEAL_MS).toBeGreaterThan(0);
  });

  it('between rounds: the early podium asks twice, reset is at hand', () => {
    const { room, clock } = makeRoom();
    const a = join(room, 'דנה');
    playRound(room, clock, 'tap', [a]);
    room.toLobby();
    const m = model(room.snapshot());
    expect(m.primary).toBe('next');
    expect(act(m, 'next').label).toContain(GAMES.icy.title);
    expect(act(m, 'podium')).toMatchObject({ kind: 'danger', featured: true, confirm: 'עוד לא שיחקנו הכל. לסיים?', confirmStyle: 'arm' });
    expect(featured(m)).toEqual(['podium', 'reset']);
    expect(act(m, 'reset')).toMatchObject({ confirm: 'לאפס את התחרות?', confirmStyle: 'dialog' });
  });

  it('all games played: the podium is the plain next step (lobby and results)', () => {
    const { room, clock } = makeRoom();
    const a = join(room, 'דנה');
    for (const g of GAME_IDS) {
      playRound(room, clock, g, [a]);
      if (g !== GAME_IDS[GAME_IDS.length - 1]) room.toLobby();
    }
    const res = model(room.snapshot());
    expect(res.primary).toBe('podium');
    expect(act(res, 'podium')).toMatchObject({ kind: 'primary', label: 'פודיום סופי' });
    expect(act(res, 'podium').confirm).toBeUndefined();
    expect(model(room.snapshot(), { ceremonyDone: false }).actions.find((x) => x.id === 'podium')?.confirm).toBe('לדלג על הטקס?');
    expect(featured(res).sort()).toEqual(['lobby', 'replay']);
    expect(act(res, 'next').enabled).toBe(false);
    room.toLobby();
    const lobby = model(room.snapshot());
    expect(lobby.primary).toBe('podium');
    expect(act(lobby, 'podium').confirm).toBeUndefined();
    expect(lobby.hint).toContain('פודיום');
    expect(act(lobby, 'start').items?.every((i) => i.mark === 'played')).toBe(true);
  });

  it('final: a new competition is the next step (with its dialog), lobby and replay at hand', () => {
    const { room, clock } = makeRoom();
    const a = join(room, 'דנה');
    playRound(room, clock, 'tap', [a]);
    room.toFinal();
    const m = model(room.snapshot());
    expect(m.phase).toBe('final');
    expect(m.primary).toBe('reset');
    expect(act(m, 'reset')).toMatchObject({ kind: 'primary', label: 'תחרות חדשה', confirmStyle: 'dialog' });
    expect(featured(m).sort()).toEqual(['lobby', 'replay']);
    expect(act(m, 'lobby').label).toBe('ללובי');
    expect(m.hint).toContain('פודיום');
  });

  it('toggles carry their value', () => {
    const { room } = makeRoom();
    room.setAutoCutscenes(false);
    const m = model(room.snapshot(), { muted: true, calm: true });
    expect(act(m, 'auto-cutscenes')).toMatchObject({ kind: 'toggle', on: false });
    expect(act(m, 'mute')).toMatchObject({ on: true, icon: '🔇' });
    expect(act(m, 'calm').on).toBe(true);
  });

  it('the key changes with every screen and only then', () => {
    const { room, clock } = makeRoom();
    const k0 = screenKey(room.snapshot());
    join(room, 'דנה');
    expect(screenKey(room.snapshot())).toBe(k0);
    room.start('tap');
    expect(screenKey(room.snapshot())).not.toBe(k0);
    clock.advance(1_000);
    expect(screenKey(room.snapshot())).toContain(':countdown:');
  });
});

describe('checkAction (every press, the remote\'s included)', () => {
  it('refuses a disabled action, a stale press on a phase-moving action, and an unknown item', () => {
    const { room } = makeRoom();
    const p = join(room, 'דנה');
    const m = model(room.snapshot());
    expect(checkAction(m, 'next', undefined, m.key)).toEqual({ ok: true });
    expect(checkAction(m, 'next', undefined, 'old:key')).toEqual({ ok: false, text: 'המסך כבר התקדם. נסו שוב' });
    expect(checkAction(m, 'mute', undefined, 'old:key')).toEqual({ ok: true });
    expect(checkAction(m, 'end-round', undefined, m.key).ok).toBe(false);
    expect(checkAction(m, 'kick', p, m.key).ok).toBe(true);
    expect(checkAction(m, 'kick', 'nobody', m.key).ok).toBe(false);
    expect(checkAction(m, 'start', 'icy', m.key).ok).toBe(true);
    expect(checkAction(m, 'start', 'chess', m.key).ok).toBe(false);
    expect(checkAction(m, 'cutscene', CUTSCENES[0]?.id, m.key).ok).toBe(true);
  });
});

describe('relay messages', () => {
  it('a model round-trips; junk is ignored', () => {
    const { room } = makeRoom();
    const m = remoteView(model(room.snapshot()));
    expect(m.actions.some((a) => a.tvOnly === true)).toBe(false);
    expect(m.actions.map((a) => a.id)).not.toContain('new-room');
    const back = parseRelay(JSON.parse(JSON.stringify(toRelay({ t: 'model', model: m }))));
    expect(back).toEqual({ t: 'model', model: m });
    expect(parseRelay({ t: 'run', rid: 'r', req: 1, id: 'next', key: 'k', confirmed: true })).toEqual({ t: 'run', rid: 'r', req: 1, id: 'next', key: 'k', confirmed: true });
    expect(parseRelay({ t: 'run', rid: 'r', req: 1, id: 'format-disk', key: 'k' })).toBeNull();
    expect(parseRelay({ t: 'model', model: { v: 2 } })).toBeNull();
    for (const junk of [null, 1, 'x', [], {}, { t: 'nope' }]) expect(parseRelay(junk)).toBeNull();
  });

  it('a full room (60 players with long names) still fits the relay limit', () => {
    const { room } = makeRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) join(room, `שחקן ארוך ${i}`.slice(0, 14));
    const bytes = Buffer.byteLength(JSON.stringify(toRelay({ t: 'model', model: remoteView(model(room.snapshot())) })), 'utf8');
    expect(bytes).toBeLessThan(RELAY_MAX_BYTES);
  });
});

describe('remote helpers', () => {
  it('the big button is the primary; a picked game turns it into "start that game" (with the ceremony question when early)', () => {
    const { room, clock } = makeRoom();
    const a = join(room, 'דנה');
    const lobby = model(room.snapshot());
    expect(bigButton(lobby, null)).toMatchObject({ id: 'next', ask: null, kind: 'primary' });
    expect(defaultPick(lobby)).toBe('tap');
    expect(bigButton(lobby, 'ninja')).toMatchObject({ id: 'start', arg: 'ninja', label: `התחלת ${GAMES.ninja.title}`, ask: null });
    playRound(room, clock, 'tap', [a]);
    const early = model(room.snapshot(), { ceremonyDone: false });
    expect(defaultPick(early)).toBeNull();
    expect(bigButton(early, null)).toMatchObject({ id: 'continue', ask: 'לדלג על הטקס?' });
    expect(bigButton(early, 'icy')).toMatchObject({ id: 'start', arg: 'icy', ask: 'לדלג על הטקס?' });
  });

  it('danger always asks on the phone; the round\'s big button is ending it', () => {
    const { room, clock } = makeRoom();
    join(room, 'דנה');
    room.start('tap');
    const intro = model(room.snapshot());
    expect(bigButton(intro, null)).toMatchObject({ id: 'end-round', kind: 'danger', ask: 'בטוח?' });
    clock.advance(2_100);
    const playing = model(room.snapshot());
    expect(bigButton(playing, 'icy')).toMatchObject({ id: 'end-round', ask: 'לסיים את הסיבוב?' });
    expect(askFor(act(playing, 'kick'), act(playing, 'kick').items?.[0]?.arg)).toBe('להוציא את דנה?');
    expect(secondaryActions(playing, bigButton(playing, null)).map((x) => x.id)).toEqual([]);
    expect(roundClockText(room.snapshot(), clock.now())).toMatch(/^נשארו \d:\d\d$/);
  });

  it('the top five follow the live order of the scores broadcast', () => {
    const { room } = makeRoom();
    const ids = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'].map((n) => join(room, n));
    const s = room.snapshot();
    const scores = ids.map((id, i) => [id, 100 - i * 10] as const).reverse();
    const top = topFive(s, scores);
    expect(top.map((r) => [r.place, r.name])).toEqual([
      [1, 'ו'],
      [2, 'ה'],
      [3, 'ד'],
      [4, 'ג'],
      [5, 'ב'],
    ]);
    expect(topFive(s, [['ghost', 5]])).toEqual([]);
  });
});

describe('room host roles', () => {
  it('remotes counts remote connections only and is broadcast on change', () => {
    const { room, broadcasts } = makeRoom();
    expect(room.snapshot().remotes).toBe(0);
    room.attachHost('r1', 'remote');
    expect(room.snapshot().remotes).toBe(1);
    expect(broadcasts.at(-1)?.remotes).toBe(1);
    room.attachHost('r2', 'remote');
    room.attachHost('r2', 'remote');
    expect(room.snapshot().remotes).toBe(2);
    expect(room.isHostConn('r1')).toBe(true);
    expect(room.hostRoleOf('r1')).toBe('remote');
    expect(room.hostRoleOf('tv')).toBe('screen');
    room.disconnect('r1');
    expect(broadcasts.at(-1)?.remotes).toBe(1);
    room.disconnect('r2');
    expect(room.snapshot().remotes).toBe(0);
    expect(room.hostConnIds()).toEqual(['tv']);
  });

  it('automatic cutscenes need a TV page: a remote alone does not count', () => {
    const clock = manualScheduler();
    const auto: CutsceneDef = { id: 'pre', title: 'לפני', file: 'pre.mp4', when: { at: 'before', gameId: 'tap' } };
    const room = new Room('WXYZ', 'k', { sink: { state: () => undefined, scores: () => undefined, kicked: () => undefined }, scheduler: clock, timing: TIMING, cutscenes: [auto], token: () => 'x', seed: () => 1 });
    room.attachHost('r', 'remote');
    expect(room.screenConnected).toBe(false);
    room.start('tap');
    expect(room.snapshot().cutscene).toBeNull();
    room.endRound();
    room.attachHost('tv', 'screen');
    expect(room.screenConnected).toBe(true);
    room.start('tap');
    expect(room.snapshot().cutscene?.id).toBe('pre');
  });
});
