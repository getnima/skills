/**
 * Every player has a look (the dressed Shimi doll): the room's part of it.
 * Join with and without a look, garbage text, a change, a resume, what is broadcast and how often.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeLook, defaultLook, encodeLook, wornIds } from '../../shared/avatar';
import { GAMES, LOOK_BROADCAST_INTERVAL_MS, MAX_PLAYERS } from '../../shared/protocol';
import { applyLooks } from '../../shared/room-looks';
import { cleanLook, startingLook } from '../../server/looks';
import { Room } from '../../server/room';

import type { RoomState } from '../../shared/protocol';
import type { LooksMessage, RoomSink } from '../../server/room';

const T0 = 1_800_000_000_000;
const BARE = encodeLook(defaultLook());
/** Crown under a party hat, heart glasses, moustache, pink bow, plate 8. */
const FANCY = '1.8.8-17.9.0.11.7';
/** Pirate hat, plate 3. */
const PIRATE = '1.3.3.0.0.0.0';
const SOMBRERO = '1.5.12.0.0.11.0';

interface Harness {
  readonly room: Room;
  readonly states: RoomState[];
  readonly looks: LooksMessage[];
  state(): RoomState;
  join(name: string, look?: unknown): { id: string; secret: string };
  lookOf(id: string): string;
}

function makeRoom(opts: { looksSink?: boolean } = {}): Harness {
  const states: RoomState[] = [];
  const looks: LooksMessage[] = [];
  const sink: RoomSink = {
    state: (s) => states.push(s),
    scores: () => undefined,
    kicked: () => undefined,
    ...(opts.looksSink === false ? {} : { looks: (m: LooksMessage) => looks.push(m) }),
  };
  let n = 0;
  const room = new Room('ABCD', 'host-key', {
    sink,
    cutscenes: [],
    token: () => `tok${++n}`,
    seed: () => 0xdeadbeef,
  });
  room.attachHost('host-conn');
  const h: Harness = {
    room,
    states,
    looks,
    state: () => room.snapshot(),
    join: (name, look) => {
      const res = room.join(`c-${name}`, look === undefined ? { name } : { name, look });
      if (!res.ok) throw new Error(`join failed: ${res.error}`);
      return { id: res.playerId, secret: res.secret };
    },
    lookOf: (id) => {
      const p = room.snapshot().players.find((x) => x.id === id);
      if (p === undefined) throw new Error(`no player ${id}`);
      return p.look;
    },
  };
  return h;
}

/** A look string is in its stored form when cleaning it changes nothing. */
function isStored(look: unknown): boolean {
  return typeof look === 'string' && cleanLook(look) === look;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cleanLook / startingLook', () => {
  it('keeps a valid look and gives its canonical text', () => {
    expect(cleanLook(FANCY)).toBe(FANCY);
    expect(cleanLook(BARE)).toBe(BARE);
    expect(cleanLook('1.3.0.0.0.0.0')).toBe('1.3.0.0.0.0.0');
    // leading zeros, a hat tower that is too tall, an id in the wrong slot, a plate that does not exist
    expect(cleanLook('1.03.8.0.0.0.0')).toBe('1.3.8.0.0.0.0');
    expect(cleanLook('1.3.8-17-1-2.9.0.11.7')).toBe('1.3.8-17-1.9.0.11.7');
    expect(cleanLook('1.3.8.11.0.0.0')).toBe('1.3.8.0.0.0.0');
    expect(cleanLook('1.99.8.0.0.0.0')).toBe('1.0.8.0.0.0.0');
    // half-broken text: what is valid in it survives, the rest is dropped
    expect(cleanLook('1.-1.-8.0.0.0.0')).toBe('1.0.8.0.0.0.0');
    expect(cleanLook('1.3.8-abc-17.zz.0.0.7')).toBe('1.3.8-17.0.0.0.7');
  });

  it('refuses everything that is not a look', () => {
    const garbage: unknown[] = [
      undefined,
      null,
      0,
      17,
      true,
      {},
      [],
      ['1.0.0.0.0.0.0'],
      { head: [8] },
      '',
      ' ',
      'hello',
      '<script>alert(1)</script>',
      '1.0.0.0.0.0',
      '1.0.0.0.0.0.0.0',
      '2.0.8.0.0.0.0',
      '1.0.9999.0.0.0.0',
      '1.0.0.0.0.0.0 ',
      '1.0.8.0.0.0.0'.repeat(20),
      'x'.repeat(100_000),
      '1.0.8;DROP.0.0.0.0',
    ];
    for (const g of garbage) expect(cleanLook(g), JSON.stringify(g)?.slice(0, 40)).toBeNull();
  });

  it('whatever comes out is at most 48 characters of [0-9.-] and decodes to itself', () => {
    for (const text of [FANCY, PIRATE, SOMBRERO, BARE, '1.11.101-102-103.201.301.225.325']) {
      const clean = cleanLook(text);
      expect(clean).not.toBeNull();
      expect(clean).toMatch(/^[0-9.-]{13,48}$/);
      expect(encodeLook(decodeLook(clean))).toBe(clean);
    }
  });

  it('startingLook: deterministic, valid, dressed, and not what somebody in the room already wears', () => {
    const a = startingLook('player-1', []);
    expect(startingLook('player-1', [])).toBe(a);
    expect(isStored(a)).toBe(true);
    expect(wornIds(decodeLook(a)).length).toBeGreaterThanOrEqual(2);
    // the same id in a room where that doll is taken gets another one
    const b = startingLook('player-1', [a]);
    expect(b).not.toBe(a);
    expect(wornIds(decodeLook(b)).join()).not.toBe(wornIds(decodeLook(a)).join());
    expect(startingLook('player-1', [a])).toBe(b);
    // 60 guests: all valid, and (nearly) all different dolls
    const taken: string[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) taken.push(startingLook(`tok${i * 2 + 1}`, taken));
    for (const l of taken) expect(isStored(l)).toBe(true);
    const dolls = new Set(taken.map((l) => wornIds(decodeLook(l)).join('-')));
    expect(dolls.size).toBeGreaterThanOrEqual(MAX_PLAYERS - 2);
  });
});

describe('joining', () => {
  it('a player who joins without a look gets a valid doll of their own', () => {
    const h = makeRoom();
    const a = h.join('דנה');
    const b = h.join('יוסי');
    const c = h.join('מיכל');
    const looks = [a, b, c].map((p) => h.lookOf(p.id));
    for (const l of looks) {
      expect(isStored(l)).toBe(true);
      expect(l).not.toBe(BARE);
    }
    expect(new Set(looks).size).toBe(3);
    // the join ack and the broadcast both carry it
    expect(h.states.at(-1)?.players.map((p) => p.look)).toEqual(looks);
  });

  it('the starting doll depends on the player id only: the same join in a new room gives the same doll', () => {
    const one = makeRoom();
    const two = makeRoom();
    const a = one.join('דנה');
    const b = two.join('אחרת');
    expect(a.id).toBe(b.id);
    expect(one.lookOf(a.id)).toBe(two.lookOf(b.id));
  });

  it('a player who joins with a look keeps it (cleaned)', () => {
    const h = makeRoom();
    const a = h.join('דנה', FANCY);
    expect(h.lookOf(a.id)).toBe(FANCY);
    const b = h.join('יוסי', '1.03.8-17-1-2.9.0.11.7');
    expect(h.lookOf(b.id)).toBe('1.3.8-17-1.9.0.11.7');
    // the bare doll is a look too, when it is what the guest chose
    const c = h.join('מיכל', BARE);
    expect(h.lookOf(c.id)).toBe(BARE);
    // two guests may wear the same thing on purpose
    const d = h.join('אבי', FANCY);
    expect(h.lookOf(d.id)).toBe(FANCY);
  });

  it('garbage look text on join never throws and never gets stored: the player gets a doll as if none was sent', () => {
    const garbage: unknown[] = [null, 42, {}, [], 'hello', '', '1.0.0', '9.9.9.9.9.9.9', 'x'.repeat(50_000), { toString: () => FANCY }];
    garbage.forEach((g, i) => {
      const h = makeRoom();
      const res = h.room.join('c1', { name: `אורח ${i}`, look: g });
      expect(res.ok).toBe(true);
      const plain = makeRoom();
      plain.join('אורח');
      const got = h.state().players[0]?.look;
      expect(isStored(got)).toBe(true);
      expect(got).toBe(plain.state().players[0]?.look);
    });
  });

  it('a resume (same playerId + secret) keeps the look the server has, whatever the join carries', () => {
    const h = makeRoom();
    const a = h.join('דנה', FANCY);
    h.room.disconnect('c-דנה');
    expect(h.lookOf(a.id)).toBe(FANCY);
    // reload without a look
    let res = h.room.join('c2', { name: 'דנה', playerId: a.id, secret: a.secret });
    expect(res.ok && res.playerId === a.id).toBe(true);
    expect(h.lookOf(a.id)).toBe(FANCY);
    // reload with another look, with garbage
    res = h.room.join('c3', { name: 'דנה', playerId: a.id, secret: a.secret, look: PIRATE });
    expect(res.ok && res.playerId === a.id).toBe(true);
    expect(h.lookOf(a.id)).toBe(FANCY);
    res = h.room.join('c4', { name: 'דנה', playerId: a.id, secret: a.secret, look: 'garbage' });
    expect(res.ok).toBe(true);
    expect(h.lookOf(a.id)).toBe(FANCY);
    expect(res.ok ? res.state.players[0]?.look : null).toBe(FANCY);
    expect(h.state().players).toHaveLength(1);
  });

  it('a resume of a player who never dressed keeps the doll the server gave', () => {
    const h = makeRoom();
    const a = h.join('דנה');
    const given = h.lookOf(a.id);
    h.join('יוסי');
    h.room.disconnect('c-דנה');
    const res = h.room.join('c9', { name: 'דנה', playerId: a.id, secret: a.secret });
    expect(res.ok).toBe(true);
    expect(h.lookOf(a.id)).toBe(given);
  });

  it('a double join on the same socket is the same player with the same look', () => {
    const h = makeRoom();
    const first = h.room.join('c1', { name: 'דנה', look: FANCY });
    const again = h.room.join('c1', { name: 'דנה', look: PIRATE });
    expect(first.ok && again.ok && first.playerId === again.playerId).toBe(true);
    expect(h.state().players).toHaveLength(1);
    expect(h.state().players[0]?.look).toBe(FANCY);
  });
});

describe('changing the look', () => {
  it('stores the cleaned look, answers with it, and tells the room with a `looks` message (no state broadcast)', () => {
    const h = makeRoom();
    const a = h.join('דנה');
    const b = h.join('יוסי');
    const statesBefore = h.states.length;
    const res = h.room.setLook(a.id, '1.03.8-17-1-2.9.0.11.7');
    expect(res).toEqual({ ok: true, look: '1.3.8-17-1.9.0.11.7' });
    // stored at once (a snapshot taken now already has it)...
    expect(h.lookOf(a.id)).toBe('1.3.8-17-1.9.0.11.7');
    // ...and announced right away (nothing was sent in the last interval)
    vi.advanceTimersByTime(0);
    expect(h.looks).toEqual([{ looks: [[a.id, '1.3.8-17-1.9.0.11.7']] }]);
    expect(h.states.length).toBe(statesBefore);
    expect(h.lookOf(b.id)).not.toBe('1.3.8-17-1.9.0.11.7');
  });

  it('garbage is refused, the look stays, nothing is broadcast', () => {
    const h = makeRoom();
    const a = h.join('דנה', FANCY);
    const statesBefore = h.states.length;
    for (const g of [undefined, null, 5, {}, [], '', 'nope', '1.0.0', '7.0.0.0.0.0.0', 'x'.repeat(10_000)]) {
      const res = h.room.setLook(a.id, g);
      expect(res).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    }
    vi.advanceTimersByTime(5_000);
    expect(h.lookOf(a.id)).toBe(FANCY);
    expect(h.looks).toEqual([]);
    expect(h.states.length).toBe(statesBefore);
  });

  it('an unknown player is refused', () => {
    const h = makeRoom();
    h.join('דנה');
    expect(h.room.setLook('nobody', FANCY)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    vi.advanceTimersByTime(1_000);
    expect(h.looks).toEqual([]);
  });

  it('sending the look the server already has is fine and makes no noise', () => {
    const h = makeRoom();
    const a = h.join('דנה', FANCY);
    expect(h.room.setLook(a.id, FANCY)).toEqual({ ok: true, look: FANCY });
    vi.advanceTimersByTime(1_000);
    expect(h.looks).toEqual([]);
  });

  it('a look can be changed in every phase, and never disturbs the round', () => {
    const h = makeRoom();
    const a = h.join('דנה');
    const b = h.join('יוסי');
    const looks = [PIRATE, FANCY, SOMBRERO, BARE, '1.2.10.5.0.0.15', '1.9.14.0.13.0.0'];
    let i = 0;
    const change = (): void => {
      const look = looks[i++ % looks.length] as string;
      expect(h.room.setLook(a.id, look)).toEqual({ ok: true, look });
      expect(h.lookOf(a.id)).toBe(look);
    };
    expect(h.state().phase).toBe('lobby');
    change();
    expect(h.room.start('tap').ok).toBe(true);
    expect(h.state().phase).toBe('intro');
    change();
    const round = h.state().round;
    if (round === null) throw new Error('no round');
    vi.advanceTimersByTime(round.startAt - Date.now() - 500);
    expect(h.state().phase).toBe('countdown');
    change();
    vi.advanceTimersByTime(500);
    expect(h.state().phase).toBe('playing');
    change();
    h.room.score(a.id, round.index, 30);
    h.room.score(b.id, round.index, 50);
    vi.advanceTimersByTime(GAMES.tap.durationMs + 5_000);
    expect(h.state().phase).toBe('results');
    // the round is exactly what it would have been: same clock, both scored
    expect(h.state().round?.startAt).toBe(round.startAt);
    expect(h.state().results?.rows.map((r) => r.raw).sort()).toEqual([30, 50]);
    change();
    expect(h.room.toFinal().ok).toBe(true);
    expect(h.state().phase).toBe('final');
    change();
  });

  it('the results rows carry the look and follow a later change', () => {
    const h = makeRoom();
    const a = h.join('דנה', FANCY);
    const b = h.join('יוסי', PIRATE);
    h.room.start('tap');
    const round = h.state().round;
    if (round === null) throw new Error('no round');
    vi.advanceTimersByTime(round.startAt - Date.now());
    h.room.score(a.id, round.index, 10);
    vi.advanceTimersByTime(GAMES.tap.durationMs + 5_000);
    const rows = h.state().results?.rows ?? [];
    expect(rows.find((r) => r.playerId === a.id)?.look).toBe(FANCY);
    expect(rows.find((r) => r.playerId === b.id)?.look).toBe(PIRATE);
    h.looks.length = 0;
    h.room.setLook(b.id, SOMBRERO);
    vi.advanceTimersByTime(LOOK_BROADCAST_INTERVAL_MS);
    expect(h.state().results?.rows.find((r) => r.playerId === b.id)?.look).toBe(SOMBRERO);
    expect(h.state().results?.rows.find((r) => r.playerId === a.id)?.look).toBe(FANCY);
    expect(h.looks).toEqual([{ looks: [[b.id, SOMBRERO]] }]);
    // everything else in the results is untouched
    const after = h.state().results?.rows ?? [];
    expect(after.map((r) => [r.playerId, r.raw, r.points, r.rank])).toEqual(rows.map((r) => [r.playerId, r.raw, r.points, r.rank]));
  });
});

describe('what the room hears, and how often', () => {
  it('20 guests changing at the same moment: one small message with the 20 looks', () => {
    const h = makeRoom();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(h.join(`אורח ${i}`).id);
    const statesBefore = h.states.length;
    ids.forEach((id, i) => h.room.setLook(id, `1.${i % 12}.${(i % 4) + 1}.0.0.0.0`));
    vi.advanceTimersByTime(LOOK_BROADCAST_INTERVAL_MS);
    expect(h.looks).toHaveLength(1);
    expect(h.looks[0]?.looks).toHaveLength(20);
    expect(new Map(h.looks[0]?.looks).get(ids[7] as string)).toBe('1.7.4.0.0.0.0');
    expect(h.states.length).toBe(statesBefore);
  });

  it('20 guests tapping for 3 seconds: at most one message per interval, only what changed, the last one is right', () => {
    const h = makeRoom();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(h.join(`אורח ${i}`).id);
    const statesBefore = h.states.length;
    const last = new Map<string, string>();
    const times: number[] = [];
    let seen = 0;
    const hats = [1, 2, 3, 4, 8, 10, 12, 14, 16, 17];
    for (let t = 0; t < 3_000; t += 10) {
      // every 10 ms three of the guests change something
      for (let k = 0; k < 3; k++) {
        const who = (t / 10 + k * 7) % 20;
        const look = `1.${(t / 10 + k) % 12}.${hats[(t / 10 + who) % hats.length]}.0.0.0.0`;
        expect(h.room.setLook(ids[who] as string, look).ok).toBe(true);
        last.set(ids[who] as string, look);
      }
      vi.advanceTimersByTime(10);
      if (h.looks.length !== seen) {
        seen = h.looks.length;
        times.push(Date.now());
      }
    }
    vi.advanceTimersByTime(LOOK_BROADCAST_INTERVAL_MS * 2);
    // 3 s of taps: about 15 messages, never more than one per interval
    expect(h.looks.length).toBeLessThanOrEqual(Math.ceil(3_000 / LOOK_BROADCAST_INTERVAL_MS) + 2);
    expect(h.looks.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(LOOK_BROADCAST_INTERVAL_MS - 10);
    // no whole-state broadcast because of looks
    expect(h.states.length).toBe(statesBefore);
    // a message lists a player at most once, and only players that changed
    for (const m of h.looks) {
      expect(new Set(m.looks.map(([id]) => id)).size).toBe(m.looks.length);
      expect(m.looks.length).toBeLessThanOrEqual(20);
    }
    // replaying the messages gives exactly the final looks, which is what the server holds
    const replay = new Map<string, string>();
    for (const m of h.looks) for (const [id, look] of m.looks) replay.set(id, look);
    for (const [id, look] of last) {
      expect(replay.get(id)).toBe(look);
      expect(h.lookOf(id)).toBe(look);
    }
  });

  it('a look change reaches the room well under a second, also right after another one', () => {
    const h = makeRoom();
    const a = h.join('דנה');
    const b = h.join('יוסי');
    h.room.setLook(a.id, PIRATE);
    vi.advanceTimersByTime(1);
    expect(h.looks).toHaveLength(1);
    // 30 ms later the other guest changes: it waits for the rest of the interval, not longer
    vi.advanceTimersByTime(30);
    h.room.setLook(b.id, FANCY);
    vi.advanceTimersByTime(LOOK_BROADCAST_INTERVAL_MS - 40);
    expect(h.looks).toHaveLength(1);
    vi.advanceTimersByTime(40);
    expect(h.looks).toHaveLength(2);
    expect(h.looks[1]).toEqual({ looks: [[b.id, FANCY]] });
  });

  it('a state broadcast carries every look, and what it carried is not sent again', () => {
    const h = makeRoom();
    const a = h.join('דנה');
    h.room.setLook(a.id, PIRATE);
    vi.advanceTimersByTime(1);
    h.looks.length = 0;
    // a change waits for its turn...
    h.room.setLook(a.id, FANCY);
    // ...and before it goes out somebody joins: the state has the new look
    const b = h.join('יוסי', SOMBRERO);
    const state = h.states.at(-1);
    expect(state?.players.find((p) => p.id === a.id)?.look).toBe(FANCY);
    expect(state?.players.find((p) => p.id === b.id)?.look).toBe(SOMBRERO);
    vi.advanceTimersByTime(LOOK_BROADCAST_INTERVAL_MS * 3);
    expect(h.looks).toEqual([]);
  });

  it('every snapshot has a valid look for every player', () => {
    const h = makeRoom();
    for (let i = 0; i < 12; i++) h.join(`אורח ${i}`, i % 3 === 0 ? FANCY : i % 3 === 1 ? 'junk' : undefined);
    for (const s of [h.state(), ...h.states.slice(-3)]) {
      for (const p of s.players) expect(isStored(p.look)).toBe(true);
    }
  });

  it('a player who is kicked before the message goes out is not in it', () => {
    const h = makeRoom();
    const a = h.join('דנה');
    const b = h.join('יוסי');
    h.room.setLook(a.id, PIRATE);
    vi.advanceTimersByTime(1);
    h.looks.length = 0;
    h.room.setLook(a.id, FANCY);
    h.room.setLook(b.id, SOMBRERO);
    h.room.kick(a.id);
    vi.advanceTimersByTime(LOOK_BROADCAST_INTERVAL_MS * 2);
    // the kick's own state broadcast carried b's look: nothing more to say
    expect(h.states.at(-1)?.players.map((p) => [p.id, p.look])).toEqual([[b.id, SOMBRERO]]);
    expect(h.looks).toEqual([]);
  });

  it('a sink that does not know `looks` gets a state instead, as rarely', () => {
    const h = makeRoom({ looksSink: false });
    const a = h.join('דנה');
    const before = h.states.length;
    for (let t = 0; t < 1_000; t += 20) {
      h.room.setLook(a.id, `1.${(t / 20) % 12}.8.0.0.0.0`);
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersByTime(LOOK_BROADCAST_INTERVAL_MS * 2);
    const extra = h.states.length - before;
    expect(extra).toBeGreaterThanOrEqual(3);
    expect(extra).toBeLessThanOrEqual(Math.ceil(1_000 / LOOK_BROADCAST_INTERVAL_MS) + 2);
    expect(h.states.at(-1)?.players[0]?.look).toBe(h.lookOf(a.id));
  });

  it('nothing is sent after the room is destroyed', () => {
    const h = makeRoom();
    const a = h.join('דנה');
    h.room.setLook(a.id, PIRATE);
    vi.advanceTimersByTime(1);
    h.looks.length = 0;
    h.room.setLook(a.id, FANCY);
    h.room.destroy();
    vi.advanceTimersByTime(5_000);
    expect(h.looks).toEqual([]);
  });

  it('a competition reset keeps the looks', () => {
    const h = makeRoom();
    const a = h.join('דנה', FANCY);
    h.room.reset();
    expect(h.lookOf(a.id)).toBe(FANCY);
  });
});

describe('applyLooks (the client side of the `looks` message)', () => {
  function stateOf(h: Harness): RoomState {
    return h.state();
  }

  it('patches the players and the results rows, and nothing else', () => {
    const h = makeRoom();
    const a = h.join('דנה', FANCY);
    const b = h.join('יוסי', PIRATE);
    h.room.start('tap');
    const round = h.state().round;
    if (round === null) throw new Error('no round');
    vi.advanceTimersByTime(round.startAt - Date.now());
    h.room.score(a.id, round.index, 10);
    vi.advanceTimersByTime(GAMES.tap.durationMs + 5_000);
    const before = stateOf(h);
    const after = applyLooks(before, [[b.id, SOMBRERO]]);
    expect(after).not.toBe(before);
    expect(after.players.find((p) => p.id === b.id)?.look).toBe(SOMBRERO);
    expect(after.results?.rows.find((r) => r.playerId === b.id)?.look).toBe(SOMBRERO);
    // untouched players and rows keep their identity (no re-render for them)
    expect(after.players.find((p) => p.id === a.id)).toBe(before.players.find((p) => p.id === a.id));
    expect(after.results?.rows.find((r) => r.playerId === a.id)).toBe(before.results?.rows.find((r) => r.playerId === a.id));
    expect(after.round).toBe(before.round);
    expect({ ...after, players: [], results: null }).toEqual({ ...before, players: [], results: null });
    // the input is not changed
    expect(before.players.find((p) => p.id === b.id)?.look).toBe(PIRATE);
    // and it is what the server itself would send next
    h.room.setLook(b.id, SOMBRERO);
    expect({ ...after, serverNow: 0 }).toEqual({ ...h.state(), serverNow: 0 });
  });

  it('returns the same object when nothing changes', () => {
    const h = makeRoom();
    const a = h.join('דנה', FANCY);
    const s = stateOf(h);
    expect(applyLooks(s, [[a.id, FANCY]])).toBe(s);
    expect(applyLooks(s, [['nobody', PIRATE]])).toBe(s);
    expect(applyLooks(s, [])).toBe(s);
  });

  it('ignores a malformed message', () => {
    const h = makeRoom();
    const a = h.join('דנה', FANCY);
    const s = stateOf(h);
    for (const bad of [undefined, null, 7, 'x', {}, [null], [[a.id]], [[a.id, 5]], [[5, PIRATE]], [{ id: a.id, look: PIRATE }]]) {
      expect(applyLooks(s, bad)).toBe(s);
    }
    // one bad pair does not hide a good one
    expect(applyLooks(s, [[a.id, 5], [a.id, PIRATE]]).players[0]?.look).toBe(PIRATE);
  });
});
