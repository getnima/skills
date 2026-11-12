/**
 * The two party hosts narrating the show on the TV: at the big moments the speaking host pops in
 * from the side in a pose, with a speech bubble, stays three or four seconds and leaves. The script
 * is show/narration.ts (design/narration.he.md for humans).
 *
 * One overlay above every scene (app.tsx mounts it inside the stage). It cues the room's own
 * moments from the room state (the opening, the first guests, each game's intro, GO, the 3-2-1
 * after a cutscene); the scenes cue theirs through show/narrator-bus.ts at the right beat of their
 * own timelines (the last ten seconds, the flappy finale, the results, the podium, goodbye).
 *
 * Rules it keeps:
 * - one at a time: a queue with priorities, and a cue that is no longer true when its turn comes
 *   is dropped; each moment fires once; the variants rotate and never repeat twice in a row;
 * - one mic (show/mic.ts): never together with the commentator's bubble;
 * - nothing while a cutscene plays (or on a portrait screen);
 * - each screen has its own place for the hosts (a "slot", narrator.css), chosen so they never
 *   cover the scoreboard rows, the QR, the room code, the winner's name, the timer or the 3-2-1.
 *   During a round they stand only in the measured empty margin under the timer, or not at all.
 * A missing pose picture falls back to the host's head; prefers-reduced-motion gets a plain fade.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { roundTime } from '../../../shared/round-clock';
import { hostHeadUrl, hostPoseUrl } from './show/art';
import { micAvailable, onMicFree, releaseMic, takeMic } from './show/mic';
import { beatHoldMs, createNarrationQueue, createTakePicker, introMoment, NARRATION } from './show/narration';
import { narrationSlot, onNarrationSlot, registerNarrator, setNarratorSpeaking } from './show/narrator-bus';
import { isShowCalm } from './show/settings';
import './narrator.css';

import type { JSX } from 'preact';
import type { RoomState } from '../../../shared/protocol';
import type { ServerClock } from '../net/connection';
import type { HostId, NarrationCue, NarrationMoment, Pose, Take } from './show/narration';
import type { NarrationSlot, SceneCue } from './show/narrator-bus';

/** A cue waits at most this long for its turn. */
const TTL_MS = 4_500;
/** The exit animation. */
const EXIT_MS = 300;
/** Between the two lines of a banter pair. */
const PAIR_GAP_MS = 120;
/** Between two takes. */
const TAKE_GAP_MS = 900;
/** Calm mode keeps only the big moments. */
const CALM_MIN_PRIORITY = 7;
/** The playing screen's margin under the timer must be at least this tall (design units) for a host to stand in it. */
const SIDE_MIN_H = 150;

/** A measured place for the hosts, in px relative to the narrator's box. */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** From the box's bottom edge to the layer's bottom edge. */
  readonly below: number;
  /** The lobby with nobody in it yet: the bubble may stand at the host's head. */
  readonly roomy?: boolean;
  /** The lobby: the host's height (px), so the figure stays left of the guests' cards. */
  readonly figure?: number;
  /** A round: the host stands in the side column's title block (the flappy finale). */
  readonly inTitle?: boolean;
}

interface Shown {
  readonly key: number;
  readonly moment: NarrationMoment;
  readonly host: HostId;
  readonly pose: Pose;
  readonly text: string;
  readonly name: string | null;
  readonly slot: NarrationSlot;
  readonly box: Box | null;
  readonly leaving: boolean;
}

interface Live {
  readonly cue: NarrationCue;
  readonly take: Take;
  beat: number;
  slot: NarrationSlot;
  token: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Narrator test hook (read-only): what has been said, for the browser tests. */
export interface NarratorHooks {
  /** Every beat that went on screen, in order. */
  log(): readonly { readonly moment: NarrationMoment; readonly host: HostId; readonly pose: Pose; readonly text: string; readonly slot: NarrationSlot; readonly at: number }[];
  /** Cues dropped without being said, with the reason. */
  dropped(): readonly { readonly id: string; readonly reason: string }[];
}

declare global {
  interface Window {
    __narrator?: NarratorHooks;
  }
}

/** Where the hosts stand on the current screen, or null when they do not narrate here. */
function slotFor(state: RoomState | null): NarrationSlot | null {
  if (state === null) return null;
  switch (state.phase) {
    case 'lobby':
      // only the first lobby: between rounds it holds the standings, the hosts leave it alone
      return state.played.length === 0 && state.results === null ? 'lobby' : null;
    case 'intro':
    case 'countdown':
      return 'top';
    case 'playing':
      return 'side';
    case 'results':
      return narrationSlot('results') ?? 'aside';
    case 'final':
      return narrationSlot('final') ?? 'final-left';
    default: {
      const _exhaustive: never = state.phase;
      throw new Error(`Unhandled phase: ${String(_exhaustive)}`);
    }
  }
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
}

/**
 * The playing screen: the empty margin under the last thing in the side column (the timer, the
 * "left in the air" card), inside the column. Null when there is none big enough: then nobody
 * stands there (the race and the timer are never covered).
 */
function measureSide(root: HTMLElement, unit: number): Box | null {
  const side = (root.parentElement ?? document).querySelector('.sh-playing .sh-side');
  if (side === null || !visible(side)) return null;
  const s = side.getBoundingClientRect();
  let floor = s.top;
  for (const child of Array.from(side.children)) {
    if (!visible(child)) continue;
    // the timer's hard shadow sits a little under it
    floor = Math.max(floor, child.getBoundingClientRect().bottom + 12 * unit);
  }
  const base = root.getBoundingClientRect();
  const pad = 10 * unit;
  const bottom = s.bottom - pad;
  const box = { left: s.left + pad - base.left, top: floor - base.top, width: s.width - pad * 2, height: bottom - floor, below: base.bottom - bottom };
  return box.height >= SIDE_MIN_H * unit && box.width >= 300 * unit ? box : null;
}

/**
 * The flappy finale only: an elimination round's side column has no empty margin (the "left in
 * the air" card and the timer fill it), so the finale line takes the column's title block (the
 * game's art, name and round number: a label nobody watches during play), above the first thing
 * that is watched. Never the race, the count, the timer or the finale banner.
 */
function measureSideTop(root: HTMLElement, unit: number): Box | null {
  const side = (root.parentElement ?? document).querySelector('.sh-playing .sh-side');
  if (side === null || !visible(side)) return null;
  const s = side.getBoundingClientRect();
  let ceiling = s.bottom;
  for (const sel of ['.sh-left', '.sh-ring']) {
    const el = side.querySelector(sel);
    if (el !== null && visible(el)) ceiling = Math.min(ceiling, el.getBoundingClientRect().top - 8 * unit);
  }
  const base = root.getBoundingClientRect();
  const pad = 10 * unit;
  const top = s.top + pad;
  const box = { left: s.left + pad - base.left, top: top - base.top, width: s.width - pad * 2, height: ceiling - top, below: base.bottom - ceiling, inTitle: true };
  return box.height >= SIDE_MIN_H * unit && box.width >= 300 * unit ? box : null;
}

/**
 * The first lobby: the space between the guests (their lowest card) and the games strip, left of
 * the join panel (QR and room code). The host stands on the games strip at its left end.
 */
function measureLobby(root: HTMLElement, unit: number): Box | null {
  const scope = root.parentElement ?? document;
  const games = scope.querySelector('[data-testid=games]');
  if (games === null || !visible(games)) return null;
  const base = root.getBoundingClientRect();
  const g = games.getBoundingClientRect();
  const join = scope.querySelector('[data-testid=join]');
  const right = join !== null && visible(join) ? join.getBoundingClientRect().left : base.right;
  let top = base.top;
  let left = Number.POSITIVE_INFINITY;
  const chips = Array.from(scope.querySelectorAll('[data-testid=chip]'));
  // a card still popping in is not where it will be: wait until the guests have settled
  if (chips.some((chip) => chip.getAnimations().some((a) => a.playState === 'running'))) return null;
  for (const chip of chips) {
    const r = chip.getBoundingClientRect();
    top = Math.max(top, r.bottom + 6 * unit);
    left = Math.min(left, r.left);
  }
  const height = Math.max(0, g.top - top);
  // the bubble (one line, the name inline) needs about 95 units under the guests' cards
  if (chips.length > 0 && height < 95 * unit) return null;
  // the host stands left of the leftmost card (narrower than 0.56 of its height), or not at all
  const figure = Math.min(430 * unit, chips.length > 0 ? (left - base.left - 40 * unit) / 0.56 : Number.POSITIVE_INFINITY);
  if (figure < 230 * unit) return null;
  return { left: 0, top: top - base.top, width: Math.max(0, right - base.left - 16), height, below: base.bottom - g.top, roomy: chips.length === 0, figure };
}

function stageUnit(el: HTMLElement): { unit: number; portrait: boolean } {
  const w = el.clientWidth;
  const h = el.clientHeight;
  return { unit: Math.max(0.05, Math.min(w / 1920, h / 1080)), portrait: h > w * 1.05 };
}

export function Narrator(props: { readonly state: RoomState | null; readonly clock: ServerClock }): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [, setSlotTick] = useState(0);
  const stateRef = useRef(props.state);
  stateRef.current = props.state;
  const clockRef = useRef(props.clock);
  clockRef.current = props.clock;

  // ── the engine: plain objects in a ref, driven by timers (renders only draw what it says) ──
  const engine = useRef<{
    queue: ReturnType<typeof createNarrationQueue>;
    picker: ReturnType<typeof createTakePicker>;
    live: Live | null;
    nextAt: number;
    pumpTimer: ReturnType<typeof setTimeout> | null;
    unMic: (() => void) | null;
    key: number;
    log: { moment: NarrationMoment; host: HostId; pose: Pose; text: string; slot: NarrationSlot; at: number }[];
    dropped: { id: string; reason: string }[];
    disposed: boolean;
  } | null>(null);
  if (engine.current === null) {
    const dropped: { id: string; reason: string }[] = [];
    engine.current = {
      queue: createNarrationQueue(4, (cue, reason) => dropped.push({ id: cue.id, reason })),
      picker: createTakePicker(Math.random),
      live: null,
      nextAt: 0,
      pumpTimer: null,
      unMic: null,
      key: 0,
      log: [],
      dropped,
      disposed: false,
    };
  }
  const e = engine.current;

  const blocked = (): boolean => {
    const s = stateRef.current;
    const root = rootRef.current;
    if (s === null || s.cutscene !== null || root === null) return true;
    return stageUnit(root).portrait;
  };

  const schedule = (ms: number): void => {
    if (e.disposed) return;
    if (e.pumpTimer !== null) clearTimeout(e.pumpTimer);
    e.pumpTimer = setTimeout(() => {
      e.pumpTimer = null;
      pumpRef.current();
    }, Math.max(0, ms));
  };

  /** Where the beat goes now, with its measured box; null: nowhere to stand on this screen. */
  const place = (moment: NarrationMoment): { slot: NarrationSlot; box: Box | null } | null => {
    const root = rootRef.current;
    const slot = slotFor(stateRef.current);
    if (root === null || slot === null) return null;
    const { unit } = stageUnit(root);
    if (slot === 'side') {
      const box = measureSide(root, unit) ?? (moment === 'finale' ? measureSideTop(root, unit) : null);
      return box === null ? null : { slot, box };
    }
    if (slot === 'lobby') {
      const box = measureLobby(root, unit);
      return box === null ? null : { slot, box };
    }
    return { slot, box: null };
  };

  const finish = (gap: number): void => {
    const live = e.live;
    if (live === null) return;
    if (live.timer !== null) clearTimeout(live.timer);
    releaseMic(live.token);
    e.live = null;
    setNarratorSpeaking(null);
    setShown(null);
    e.nextAt = performance.now() + gap;
    schedule(gap);
  };

  /** The current beat leaves; then the next beat of the take, or the take is over. */
  const leave = (abort: boolean): void => {
    const live = e.live;
    if (live === null) return;
    if (live.timer !== null) clearTimeout(live.timer);
    setShown((cur) => (cur !== null ? { ...cur, leaving: true } : cur));
    live.timer = setTimeout(() => {
      live.timer = null;
      if (abort || live.beat + 1 >= live.take.length) {
        finish(TAKE_GAP_MS);
        return;
      }
      live.beat++;
      setShown(null);
      live.timer = setTimeout(() => {
        live.timer = null;
        showBeat();
      }, PAIR_GAP_MS);
    }, EXIT_MS);
  };

  const showBeat = (): void => {
    const live = e.live;
    if (live === null) return;
    const beat = live.take[live.beat];
    const where = place(live.cue.moment);
    if (beat === undefined || where === null || blocked() || (live.cue.valid !== undefined && !live.cue.valid())) {
      if (beat !== undefined) e.dropped.push({ id: `${live.cue.id}#${live.beat}`, reason: where === null ? 'no place' : 'gone' });
      finish(0);
      return;
    }
    live.slot = where.slot;
    e.key++;
    setNarratorSpeaking(beat.host);
    // the first guests: the tag names whoever came in last, at the moment it is said
    const players = stateRef.current?.players ?? [];
    const name = live.cue.moment === 'arrive' ? (players[players.length - 1]?.name ?? null) : (live.cue.name ?? null);
    setShown({ key: e.key, moment: live.cue.moment, host: beat.host, pose: beat.pose, text: beat.text, name, slot: where.slot, box: where.box, leaving: false });
    e.log.push({ moment: live.cue.moment, host: beat.host, pose: beat.pose, text: beat.text, slot: where.slot, at: Date.now() });
    live.timer = setTimeout(() => {
      live.timer = null;
      leave(false);
    }, live.cue.holdMs ?? beatHoldMs(beat.text));
  };

  const pump = (): void => {
    if (e.disposed || e.live !== null) return;
    const now = performance.now();
    if (now < e.nextAt) {
      schedule(e.nextAt - now);
      return;
    }
    e.queue.prune(now);
    if (e.queue.size() === 0) return;
    if (blocked()) {
      schedule(250);
      return;
    }
    // the commentator is saying a ceremony line: wait for it
    if (!micAvailable('narrator')) {
      if (e.unMic === null) {
        e.unMic = onMicFree(() => {
          e.unMic = null;
          schedule(150);
        });
      }
      schedule(500);
      return;
    }
    const first = e.queue.peek(now);
    if (first === null) return;
    const priority = first.priority ?? NARRATION[first.moment].priority;
    if (isShowCalm() && priority < CALM_MIN_PRIORITY) {
      e.queue.next(now);
      e.dropped.push({ id: first.id, reason: 'calm' });
      schedule(0);
      return;
    }
    // nowhere to stand on this screen right now (no margin in a round, no room under the guests):
    // the cue waits, until the screen makes room or its time is up
    if (place(first.moment) === null) {
      schedule(500);
      return;
    }
    const cue = e.queue.next(now);
    if (cue === null) return;
    const picked = e.picker.pick(cue.moment);
    if (picked === null || picked.take.length === 0) {
      schedule(0);
      return;
    }
    const token = takeMic('narrator');
    if (token === null) {
      schedule(300);
      return;
    }
    e.live = { cue, take: picked.take, beat: 0, slot: 'top', token, timer: null };
    showBeat();
  };
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  const offer = (cue: SceneCue): void => {
    const now = performance.now();
    if (e.queue.offer({ ...cue, at: now }, now)) schedule(0);
  };
  const offerRef = useRef(offer);
  offerRef.current = offer;

  // ── mount: listen to the scenes, expose the test hook, clean up ──
  useEffect(() => {
    const unregister = registerNarrator((cue) => offerRef.current(cue));
    const unSlot = onNarrationSlot(() => setSlotTick((n) => n + 1));
    window.__narrator = { log: () => [...e.log], dropped: () => [...e.dropped] };
    return () => {
      e.disposed = true;
      unregister();
      unSlot();
      if (e.pumpTimer !== null) clearTimeout(e.pumpTimer);
      e.unMic?.();
      const live = e.live;
      if (live !== null) {
        if (live.timer !== null) clearTimeout(live.timer);
        releaseMic(live.token);
      }
      setNarratorSpeaking(null);
    };
  }, []);

  /** Cues offered a little later (a guest's card pops in first); cleared on unmount. */
  const later = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      for (const t of later.current) clearTimeout(t);
    },
    [],
  );
  const offerLater = (cue: SceneCue, ms: number): void => {
    const t = setTimeout(() => {
      later.current.delete(t);
      offerRef.current(cue);
    }, ms);
    later.current.add(t);
  };

  // ── the room's own moments, from the state ──
  const s = props.state;
  const code = s?.code ?? '';
  const phase = s?.phase ?? null;
  const round = s?.round ?? null;
  const cutscene = s?.cutscene ?? null;
  const firstLobby = s !== null && s.phase === 'lobby' && s.played.length === 0 && s.results === null;
  const guests = s?.players.length ?? 0;
  /** This TV saw the room empty (so "the first guests" really are the first ones, not a refresh). */
  const sawEmpty = useRef<string | null>(null);

  useEffect(() => {
    if (!firstLobby || cutscene !== null) return;
    const stillFirst = (): boolean => {
      const st = stateRef.current;
      return st !== null && st.code === code && st.phase === 'lobby' && st.played.length === 0 && st.results === null;
    };
    if (guests === 0) {
      sawEmpty.current = code;
      offer({ id: `opening:${code}`, moment: 'opening', ttlMs: 8_000, valid: () => stillFirst() && (stateRef.current?.players.length ?? 0) <= 2 });
    } else if (sawEmpty.current === code) {
      // after the first card has popped in and the lobby has laid itself out again
      // (with one or two guests the cards fill the lobby down to the games: it waits for room, up to 25 s)
      offerLater({ id: `arrive:${code}`, moment: 'arrive', ttlMs: 25_000, valid: stillFirst }, 1_100);
    }
  }, [firstLobby, guests > 0, code, cutscene !== null]);

  const roundIndex = round?.index ?? -1;
  const resumeAt = round?.resumeAt ?? null;
  useEffect(() => {
    if (s === null || round === null || cutscene !== null) return;
    const sameRound = (...phases: readonly string[]): boolean => {
      const st = stateRef.current;
      return st !== null && st.round !== null && st.round.index === round.index && phases.includes(st.phase);
    };
    if (phase === 'intro') {
      offer({ id: `intro:${round.index}`, moment: introMoment(round.gameId), ttlMs: 5_000, valid: () => sameRound('intro', 'countdown') });
    }
    if (phase === 'playing') {
      const rt = roundTime(round, clockRef.current.now());
      if (rt.resumeInMs > 0) {
        // the 3-2-1 after a cutscene
        offer({ id: `resume:${round.index}:${resumeAt ?? 0}`, moment: 'resume', ttlMs: 4_000, valid: () => sameRound('playing') });
      } else if (rt.elapsedMs < 2_000 && !rt.frozen) {
        offer({
          id: `go:${round.index}`,
          moment: 'go',
          ttlMs: 3_000,
          valid: () => {
            const st = stateRef.current;
            return sameRound('playing') && st?.round != null && roundTime(st.round, clockRef.current.now()).elapsedMs < 6_000;
          },
        });
      }
    }
  }, [phase, roundIndex, resumeAt, cutscene !== null]);

  // a cutscene starts, the screen changes or turns portrait: the host on screen leaves at once
  const slotNow = slotFor(s);
  const live = e.live;
  useEffect(() => {
    if (live === null) return;
    if (cutscene !== null) leave(true);
    else if (slotNow !== live.slot) leave(false);
  }, [cutscene !== null, slotNow]);
  useEffect(() => {
    if (cutscene === null) schedule(300);
  }, [cutscene !== null]);
  // a guest comes in (or leaves) under a host in the lobby: the cards move, the host steps off
  useEffect(() => {
    if (live !== null && live.slot === 'lobby') leave(false);
  }, [guests]);
  useEffect(() => {
    const root = rootRef.current;
    if (root === null || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const { unit, portrait } = stageUnit(root);
      root.style.setProperty('--nu', `${unit}px`);
      root.classList.toggle('is-portrait', portrait);
      if (portrait && e.live !== null) leave(true);
    });
    ro.observe(root);
    const { unit } = stageUnit(root);
    root.style.setProperty('--nu', `${unit}px`);
    return () => ro.disconnect();
  }, []);

  return (
    <div class="nr-layer" ref={rootRef} aria-live="polite" data-testid="narrator-layer">
      {shown !== null ? <Speaker shown={shown} /> : null}
    </div>
  );
}

/** The owner's multi-word exclamations never break across two lines of a bubble. */
function keepTogether(text: string): string {
  return text.replace(/בן פורת יוסף/g, 'בן\u00a0פורת\u00a0יוסף').replace(/דוז פואה/g, 'דוז\u00a0פואה');
}

/** One host on screen: the pose (or the head when the picture is missing) and the bubble. */
function Speaker(props: { readonly shown: Shown }): JSX.Element {
  const { shown } = props;
  const pose = hostPoseUrl(shown.host, shown.pose);
  const head = hostHeadUrl(shown.host);
  const [broken, setBroken] = useState(false);
  const url = pose !== null && !broken ? pose : head;
  const isHead = url !== null && url === head;
  const style: Record<string, string> = {};
  if (shown.box !== null) {
    style['--bx'] = `${shown.box.left.toFixed(1)}px`;
    style['--by'] = `${shown.box.top.toFixed(1)}px`;
    style['--bw'] = `${shown.box.width.toFixed(1)}px`;
    style['--bh'] = `${shown.box.height.toFixed(1)}px`;
    style['--bb'] = `${shown.box.below.toFixed(1)}px`;
    if (shown.box.figure !== undefined) style['--fig'] = `${shown.box.figure.toFixed(1)}px`;
  }
  return (
    <div
      key={shown.key}
      class={`nr nr--${shown.slot} nr--${shown.host} ${shown.leaving ? 'is-leaving' : ''} ${isHead ? 'is-head' : ''} ${shown.box?.roomy === true ? 'is-roomy' : ''} ${shown.box?.inTitle === true ? 'is-title' : ''}`}
      style={style}
      data-testid="narrator"
      data-moment={shown.moment}
      data-host={shown.host}
      data-pose={shown.pose}
      data-slot={shown.slot}
    >
      <div class="nr-fig">{url !== null ? <img class="nr-pic" src={url} alt="" draggable={false} onError={() => setBroken(true)} /> : null}</div>
      <div class="nr-bubble" dir="rtl">
        {shown.name !== null ? (
          <span class="nr-name" dir="auto">
            <bdi>{shown.name}</bdi>
          </span>
        ) : null}
        <span class="nr-text">{keepTogether(shown.text)}</span>
      </div>
    </div>
  );
}
