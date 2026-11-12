// The TV's sound / picture delay (AirPlay): the adjustments the remote and the TV's keys send,
// how the two delays add up for a timed sound, the 3-2-1's cue plan, and the actions.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const sync = await import('../../client/src/kit/av-sync');
const { planCountdownCues } = await import('../../client/src/host/intro');
const { beatDigit } = await import('../../client/src/host/av-sync-screen');
const { buildControlModel, remoteView, checkAction } = await import('../../client/src/host/actions');

describe('A/V sync adjustments', () => {
  beforeEach(() => {
    sync.adjustAvSync('reset');
  });

  it('starts at zero and follows the browser (none in node) until set by hand', () => {
    expect(sync.avSync()).toEqual({ soundMs: 0, soundSet: false, pictureMs: 0 });
    expect(sync.soundLeadMs()).toBe(0);
  });

  it('nudges, sets and clamps', () => {
    expect(sync.adjustAvSync('sound:=2000')).toBe(true);
    expect(sync.adjustAvSync('sound:+20')).toBe(true);
    expect(sync.adjustAvSync('sound:-200')).toBe(true);
    expect(sync.avSync()).toMatchObject({ soundMs: 1820, soundSet: true });
    sync.adjustAvSync('sound:+9999');
    expect(sync.avSync().soundMs).toBe(sync.SOUND_MAX_MS);
    sync.adjustAvSync('picture:-50');
    expect(sync.avSync().pictureMs).toBe(0);
    sync.adjustAvSync('picture:+150');
    expect(sync.avSync().pictureMs).toBe(150);
  });

  it('a timed sound leaves early by the sound offset plus the picture delay (each tuned on its own)', () => {
    sync.adjustAvSync('sound:=1800');
    sync.adjustAvSync('picture:=200');
    expect(sync.soundOffsetMs()).toBe(1800);
    expect(sync.pictureLeadMs()).toBe(200);
    expect(sync.soundLeadMs()).toBe(2000);
  });

  it('refuses anything it does not understand and changes nothing', () => {
    sync.adjustAvSync('sound:=500');
    for (const bad of ['', 'sound', 'sound:20', 'sound:+', 'volume:+20', 'sound:+20000', 'picture:*3', 'sound:+2e3']) expect(sync.adjustAvSync(bad), bad).toBe(false);
    expect(sync.avSync().soundMs).toBe(500);
  });

  it('keeps the values on this TV (localStorage), and auto goes back to the browser', () => {
    sync.adjustAvSync('sound:=1500');
    expect(JSON.parse(store.get('party.avsync.v1') ?? '{}')).toMatchObject({ soundMs: 1500, soundSet: true });
    sync.adjustAvSync('sound:auto');
    expect(sync.avSync().soundSet).toBe(false);
  });

  it('the picture clock runs ahead by the picture delay only', () => {
    const base = { now: () => 10_000, sync: async () => undefined, hint: () => undefined, synced: true };
    const pic = sync.pictureClock(base);
    sync.adjustAvSync('picture:=120');
    expect(pic.now()).toBe(10_120);
    expect(pic.synced).toBe(true);
  });
});

describe('the 3-2-1 cue plan', () => {
  it('a beep on 3 and 2, the high one on 1, then the end cue on the start', () => {
    expect(planCountdownCues(30_000, 3_000, 'gong')).toEqual([
      { at: 27_000, kind: 'beep' },
      { at: 28_000, kind: 'beep' },
      { at: 29_000, kind: 'beepHigh' },
      { at: 30_000, kind: 'gong' },
    ]);
  });

  it('under the short test countdown only the seconds it shows', () => {
    expect(planCountdownCues(10_000, 1_500, 'go')).toEqual([
      { at: 9_000, kind: 'beepHigh' },
      { at: 10_000, kind: 'go' },
    ]);
  });

  it("the sync screen's disc counts 1..4 on the server's seconds", () => {
    expect([0, 999, 1_000, 2_500, 3_999, 4_000].map(beatDigit)).toEqual([1, 1, 2, 3, 4, 1]);
    expect(beatDigit(-1)).toBe(4);
  });
});

describe('the sync actions', () => {
  const lobby = { phase: 'lobby', cutscene: null, players: [], played: [], results: null, round: null, code: 'ABCD' } as unknown as Parameters<typeof buildControlModel>[0]['state'];
  const base = { state: lobby, ceremonyDone: true, muted: false, calm: false, fullscreen: false };

  it('the sync screen opens from the remote too, and its nudges only while it is open', () => {
    const closed = buildControlModel({ ...base, sync: { open: false, soundMs: 0, auto: true, pictureMs: 0 } });
    expect(checkAction(closed, 'av-sync', 'on', closed.key).ok).toBe(true);
    expect(checkAction(closed, 'av-adjust', 'sound:+20', closed.key).ok).toBe(false);
    expect(remoteView(closed).actions.some((a) => a.id === 'av-sync')).toBe(true);
    const open = buildControlModel({ ...base, sync: { open: true, soundMs: 1800, auto: false, pictureMs: 120 } });
    expect(checkAction(open, 'av-adjust', 'sound:+20', open.key).ok).toBe(true);
    expect(open.sync).toEqual({ open: true, soundMs: 1800, auto: false, pictureMs: 120 });
    expect(open.hint).toContain('סנכרון');
  });

  it('not during a round (its beeps would talk over the intro)', () => {
    const playing = { ...(lobby as object), phase: 'playing' } as typeof lobby;
    const m = buildControlModel({ ...base, state: playing, sync: { open: false, soundMs: 0, auto: true, pictureMs: 0 } });
    expect(checkAction(m, 'av-sync', 'on', m.key).ok).toBe(false);
  });
});
