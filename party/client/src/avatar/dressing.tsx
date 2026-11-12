/**
 * The dressing room: a guest dresses their own Shimi on the phone's waiting screen.
 *
 *   <DressingRoom look={look} name={name} onChange={(l) => send(l)} onDone={(l) => …} compact? />
 *
 * Controlled with a local copy: the room shows its own look at once and reports it with
 * `onChange` about 400 ms after the last change (and at once on "מוכן!", on unmount and when the
 * tab is hidden). A `look` prop that differs from what the room has (and is not one of its own
 * recent reports coming back) replaces the room's look.
 * It fills its container (give it a fixed height; see MIN_HEIGHT below) and never scrolls the page.
 */
import './dressing.css';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { AVATAR_BG_COUNT, AVATAR_MAX_TOWER, defaultLook, encodeLook, randomLook, shakeOff, wornIds } from '../../../shared/avatar';
import { Avatar } from './Avatar';
import { AVATAR_BGS, DOLL, ITEMS, ITEM_IDS, getItem, normalizeLook, tapItem } from './catalog';
import { preloadAvatarAssets } from './compose';
import { clearFx, confetti, flyIn, kaboom, sparks, squashFrames, tumble } from './dressing-fx';
import { boxOnStage, frameStage, stageMode } from './dressing-stage';
import { peekThumb, plateUrl, requestThumb, thumbStats } from './dressing-thumbs';
import { BURST, LINES, buzz, itemLine, pick, sound } from './dressing-voice';
import { layoutLook } from './layout';

import type { JSX } from 'preact';

import type { AvatarLook, AvatarSlot } from '../../../shared/avatar';
import type { AvatarItem } from './catalog';
import type { Flight, Pt, Rect } from './dressing-fx';
import type { StageFrame } from './dressing-stage';
import type { AvatarCrop, PlacedItem } from './layout';
import type { DressingRoomProps } from './room-contract';

export interface DressingRoomFullProps extends DressingRoomProps {
  /** Shorter variant (no top bar, smaller tray) for when the lobby shows the room under its own header. */
  compact?: boolean;
}

/** Smallest container height the room is designed for, in CSS px (normal / compact). */
export const DRESSING_MIN_HEIGHT = { normal: 500, compact: 400 } as const;

export type DressingTab = AvatarSlot | 'BG';
export const DRESSING_TABS: readonly { id: DressingTab; label: string }[] = [
  { id: 'HEAD', label: 'כובעים' },
  { id: 'EYES', label: 'עיניים' },
  { id: 'FACE', label: 'פנים' },
  { id: 'EARS', label: 'אוזניים' },
  { id: 'NECK', label: 'צוואר' },
  { id: 'BG', label: 'רקע' },
];

const CHANGE_DEBOUNCE_MS = 400;
const SAY_GAP_MS = 1100;
const SHUFFLE_STEPS = 6;
const SHUFFLE_STEP_MS = 80;
const DW = DOLL.width;
const DH = DOLL.height;
/** The plate behind his head: a round medallion around the face, in doll px. */
const PLATE = { x: (DOLL.centerX / 100) * DW - 0.6 * DW, y: 0.235 * DH - 0.6 * DW, d: 1.2 * DW };

/** Automation hook: the room's own state, for tests (read-only by convention). */
interface RoomProbe {
  look: string;
  flying: number;
  fx: number;
  thumbs: () => ReturnType<typeof thumbStats>;
  mode: string;
  changes: number;
  lastChange: string | null;
  lastDone: string | null;
}

function slotField(slot: Exclude<AvatarSlot, 'HEAD'>): 'eyes' | 'ears' | 'face' | 'neck' {
  return slot === 'EYES' ? 'eyes' : slot === 'EARS' ? 'ears' : slot === 'FACE' ? 'face' : 'neck';
}

/** The look a tile shows: the item alone on the bare doll. */
function soloLook(it: AvatarItem): AvatarLook {
  const l = defaultLook();
  if (it.slot === 'HEAD') l.head = [it.id];
  else l[slotField(it.slot)] = it.id;
  return l;
}

function lookFiles(look: AvatarLook): string[] {
  return [DOLL.file, ...layoutLook(look).map((p) => p.item.file)];
}

function prefersReduced(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function devicePx(css: number): number {
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? Math.min(devicePixelRatio, 2.5) : 1;
  return Math.max(32, Math.ceil((css * dpr) / 16) * 16);
}

/* ───────────────────────── tiles ───────────────────────── */

type Register = (el: Element, onSeen: () => void) => () => void;

function useThumb(look: AvatarLook, crop: AvatarCrop, px: number, active: boolean, kind: 'item' | 'look'): { url: string | null; missing: boolean } {
  const key = `${encodeLook(look)}|${crop}|${px}`;
  const [state, setState] = useState<{ key: string; url: string | null; missing: boolean }>(() => ({ key, url: peekThumb(look, crop, px), missing: false }));
  useEffect(() => {
    if (!active) return;
    const now = peekThumb(look, crop, px);
    if (now !== null) {
      setState({ key, url: now, missing: false });
      return;
    }
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const go = (): void => {
      void requestThumb(look, crop, px, lookFiles(look), kind).then((url) => {
        if (!alive) return;
        if (url !== null) setState({ key, url, missing: false });
        else {
          setState((s) => ({ key, url: s.key === key ? s.url : null, missing: true }));
          retry = setTimeout(go, 9000);
        }
      });
    };
    go();
    return () => {
      alive = false;
      if (retry !== undefined) clearTimeout(retry);
    };
  }, [key, active]);
  // a look-thumb keeps its old picture while the new one is made (no flash on the plate tab)
  if (state.key === key) return { url: state.url, missing: state.missing };
  return { url: kind === 'look' ? state.url : null, missing: false };
}

interface TileProps {
  item: AvatarItem;
  worn: boolean;
  level: number;
  towerSize: number;
  px: number;
  register: Register;
  onTap: (id: number, el: HTMLElement) => void;
}

function ItemTile(p: TileProps): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el === null || seen) return;
    return p.register(el, () => setSeen(true));
  }, [seen]);
  const look = useMemo(() => soloLook(p.item), [p.item.id]);
  const crop: AvatarCrop = p.item.slot === 'NECK' ? 'bust' : 'icon';
  const { url, missing } = useThumb(look, crop, p.px, seen, 'item');
  const ink = p.item.colors?.[0] ?? '#FFD21F';
  return (
    <button
      ref={ref}
      type="button"
      class={`dr-tile${p.worn ? ' worn' : ''}${url === null ? ' wait' : ''}${missing ? ' missing' : ''}`}
      data-id={p.item.id}
      aria-pressed={p.worn ? 'true' : 'false'}
      aria-label={p.item.name}
      title={p.item.name}
      style={{ '--tile-ink': ink }}
      onClick={(e) => p.onTap(p.item.id, e.currentTarget)}
    >
      {url !== null ? <img src={url} alt="" draggable={false} /> : <span class="dr-tile-ph" aria-hidden="true" />}
      {p.worn && p.item.slot === 'HEAD' && p.towerSize > 1 && <span class="dr-tile-lvl" aria-hidden="true">{p.level + 1}</span>}
    </button>
  );
}

interface PlateTileProps {
  bg: number;
  on: boolean;
  cut: string | null;
  px: number;
  onTap: (bg: number, el: HTMLElement) => void;
}

function PlateTile(p: PlateTileProps): JSX.Element {
  const plate = useMemo(() => plateUrl(p.bg, p.px), [p.bg, p.px]);
  const bg = AVATAR_BGS[p.bg];
  return (
    <button
      type="button"
      class={`dr-tile dr-plate-tile${p.on ? ' worn' : ''}`}
      data-bg={p.bg}
      aria-pressed={p.on ? 'true' : 'false'}
      aria-label={bg?.name ?? `רקע ${p.bg}`}
      title={bg?.name}
      style={{ backgroundColor: bg?.color, backgroundImage: plate !== '' ? `url(${plate})` : undefined }}
      onClick={(e) => p.onTap(p.bg, e.currentTarget)}
    >
      {p.cut !== null && <img src={p.cut} alt="" draggable={false} />}
    </button>
  );
}

/* ───────────────────────── the room ───────────────────────── */

interface Sizes {
  rw: number;
  rh: number;
  sw: number;
  sh: number;
  sx: number;
  sy: number;
}

interface Speech {
  text: string;
  on: boolean;
  n: number;
}

export function DressingRoom(props: DressingRoomFullProps): JSX.Element {
  const propsRef = useRef(props);
  propsRef.current = props;
  const name = (props.name ?? '').trim();

  const [look, setLookState] = useState<AvatarLook>(() => normalizeLook(props.look));
  const lookRef = useRef(look);
  const [tab, setTab] = useState<DressingTab>('HEAD');
  const [shuffle, setShuffle] = useState<AvatarLook | null>(null);
  const [, setFlyVer] = useState(0);
  const [sizes, setSizes] = useState<Sizes>({ rw: 0, rh: 0, sw: 0, sh: 0, sx: 0, sy: 0 });
  const [speech, setSpeech] = useState<Speech>({ text: '', on: false, n: 0 });
  const [reduced, setReduced] = useState(prefersReduced);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);
  const springRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const sayRef = useRef<HTMLSpanElement>(null);

  const flights = useRef(new Map<number, Flight>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recent = useRef<string[]>([encodeLook(look)]);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const probe = useRef<RoomProbe>({
    look: encodeLook(look),
    flying: 0,
    fx: 0,
    thumbs: thumbStats,
    mode: '',
    changes: 0,
    lastChange: null,
    lastDone: null,
  });

  const later = (fn: () => void, ms: number): void => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };

  /* ── reporting ── */
  const emit = (): void => {
    if (emitTimer.current !== null) {
      clearTimeout(emitTimer.current);
      emitTimer.current = null;
    }
    const l = lookRef.current;
    const key = encodeLook(l);
    if (recent.current[recent.current.length - 1] === key && probe.current.changes > 0) return;
    recent.current.push(key);
    if (recent.current.length > 5) recent.current.shift();
    probe.current.changes++;
    probe.current.lastChange = key;
    try {
      propsRef.current.onChange(normalizeLook(l));
    } catch (err) {
      console.warn('[dressing] onChange threw', err);
    }
  };
  const pendingEmit = (): boolean => emitTimer.current !== null;
  const scheduleEmit = (): void => {
    if (emitTimer.current !== null) clearTimeout(emitTimer.current);
    emitTimer.current = setTimeout(emit, CHANGE_DEBOUNCE_MS);
  };

  const commit = (next: AvatarLook): void => {
    lookRef.current = next;
    probe.current.look = encodeLook(next);
    setLookState(next);
    // a flight whose item is no longer worn goes away at once: never a ghost on the doll
    const worn = new Set(wornIds(next));
    for (const [id, f] of flights.current) {
      if (!worn.has(id)) {
        flights.current.delete(id);
        f.cancel();
      }
    }
    probe.current.flying = flights.current.size;
    scheduleEmit();
  };

  /* ── a look from outside ── */
  const propKey = encodeLook(normalizeLook(props.look));
  useEffect(() => {
    if (propKey === encodeLook(lookRef.current)) return;
    if (recent.current.includes(propKey) && pendingEmit()) return; // our own report coming back while the guest keeps dressing
    if (recent.current.includes(propKey) && recent.current[recent.current.length - 1] !== propKey) return; // a stale echo
    if (emitTimer.current !== null) {
      clearTimeout(emitTimer.current);
      emitTimer.current = null;
    }
    for (const f of flights.current.values()) f.cancel();
    flights.current.clear();
    setShuffle(null);
    const ext = normalizeLook(props.look);
    lookRef.current = ext;
    probe.current.look = propKey;
    recent.current.push(propKey);
    if (recent.current.length > 5) recent.current.shift();
    setLookState(ext);
  }, [propKey]);

  /* ── sizes ── */
  useLayoutEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (root === null || stage === null) return;
    const measure = (): void => {
      const next: Sizes = { rw: root.clientWidth, rh: root.clientHeight, sw: stage.clientWidth, sh: stage.clientHeight, sx: stage.offsetLeft, sy: stage.offsetTop };
      setSizes((s) => (s.rw === next.rw && s.rh === next.rh && s.sw === next.sw && s.sh === next.sh && s.sx === next.sx && s.sy === next.sy ? s : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      addEventListener('resize', measure);
      return () => removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  /* ── motion preference, tab visibility, mobile lock-down, unmount ── */
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    const onMq = (): void => setReduced(mq?.matches ?? false);
    try {
      mq = matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener?.('change', onMq);
    } catch {
      mq = null;
    }
    const onVis = (): void => {
      const h = document.visibilityState === 'hidden';
      hiddenRef.current = h;
      setHidden(h);
      if (h) {
        // land everything now, quietly, and stop every effect; report what the guest has
        for (const f of flights.current.values()) f.finish();
        flights.current.clear();
        clearFx(fxRef.current);
        stopSpring();
        setShuffle(null);
        if (pendingEmit()) emit();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const root = rootRef.current;
    const stop = (e: Event): void => e.preventDefault();
    root?.addEventListener('gesturestart', stop);
    root?.addEventListener('dblclick', stop);
    root?.addEventListener('contextmenu', stop);
    const hello = setTimeout(() => say(LINES.hello(name)), 700);
    // the pictures for the shuffle and the thumbnails, once the room is on screen
    const pre = setTimeout(() => void preloadAvatarAssets(), 1200);
    (window as unknown as { __dressingRoom?: RoomProbe }).__dressingRoom = probe.current;
    return () => {
      mq?.removeEventListener?.('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
      root?.removeEventListener('gesturestart', stop);
      root?.removeEventListener('dblclick', stop);
      root?.removeEventListener('contextmenu', stop);
      clearTimeout(hello);
      clearTimeout(pre);
      for (const t of timers.current) clearTimeout(t);
      timers.current.clear();
      for (const f of flights.current.values()) f.cancel();
      flights.current.clear();
      clearFx(fxRef.current);
      stopSpring();
      stopTyping();
      if (pendingEmit()) emit();
    };
  }, []);

  /* ── the bobblehead springs (the source page's SP), a rAF loop that sleeps when still ── */
  const sp = useRef({ hA: 0, hV: 0, bA: 0, bV: 0, cq: 0, cv: 0, raf: 0, last: 0 });
  const stopSpring = (): void => {
    const s = sp.current;
    if (s.raf !== 0) cancelAnimationFrame(s.raf);
    s.raf = 0;
    s.hA = s.hV = s.bA = s.bV = s.cq = s.cv = 0;
    if (springRef.current !== null) springRef.current.style.transform = '';
    if (headRef.current !== null) headRef.current.style.transform = '';
  };
  const step = (now: number): void => {
    const s = sp.current;
    const dt = Math.min(0.05, s.last !== 0 ? (now - s.last) / 1000 : 0.016);
    s.last = now;
    const hAcc = -95 * s.hA - 3.6 * s.hV;
    s.hV += hAcc * dt;
    s.hA = Math.max(-0.11, Math.min(0.11, s.hA + s.hV * dt));
    const bAcc = -120 * s.bA - 9 * s.bV;
    s.bV += bAcc * dt;
    s.bA = Math.max(-0.07, Math.min(0.07, s.bA + s.bV * dt));
    const cAcc = -240 * s.cq - 13 * s.cv;
    s.cv += cAcc * dt;
    s.cq = Math.max(-0.07, Math.min(0.1, s.cq + s.cv * dt));
    if (springRef.current !== null) springRef.current.style.transform = `rotate(${s.bA.toFixed(4)}rad) scale(${(1 + s.cq * 0.5).toFixed(4)},${(1 - s.cq).toFixed(4)})`;
    if (headRef.current !== null) headRef.current.style.transform = `rotate(${s.hA.toFixed(4)}rad)`;
    const still = Math.abs(s.hA) + Math.abs(s.hV) + Math.abs(s.bA) + Math.abs(s.bV) + Math.abs(s.cq) + Math.abs(s.cv) < 0.002;
    if (still) {
      stopSpring();
      return;
    }
    s.raf = requestAnimationFrame(step);
  };
  const wobble = (w = 0.5, big = false): void => {
    if (reducedRef.current || hiddenRef.current) return;
    const s = sp.current;
    const dir = Math.random() < 0.5 ? -1 : 1;
    s.hV += dir * (1.1 + w * 2.6) * (big ? 1.35 : 1);
    s.bV += -dir * (0.25 + w * 0.55);
    s.cv += (0.5 + w * 1.4) * (big ? 1.3 : 1);
    if (s.raf === 0) {
      s.last = 0;
      s.raf = requestAnimationFrame(step);
    }
  };

  /* ── speech ── */
  const sayState = useRef({ last: -1e9, pending: null as ReturnType<typeof setTimeout> | null, quiet: null as ReturnType<typeof setTimeout> | null, type: null as ReturnType<typeof setInterval> | null });
  const stopTyping = (): void => {
    const s = sayState.current;
    if (s.type !== null) clearInterval(s.type);
    if (s.pending !== null) clearTimeout(s.pending);
    if (s.quiet !== null) clearTimeout(s.quiet);
    s.type = s.pending = s.quiet = null;
  };
  const say = (text: string, now = false): void => {
    if (text === '') return;
    const s = sayState.current;
    const t = performance.now();
    if (s.pending !== null) {
      clearTimeout(s.pending);
      s.pending = null;
    }
    if (!now && t - s.last < SAY_GAP_MS) {
      // rate limit: only the latest line waits for its turn
      s.pending = setTimeout(() => {
        s.pending = null;
        say(text, true);
      }, SAY_GAP_MS - (t - s.last));
      return;
    }
    s.last = t;
    if (s.type !== null) clearInterval(s.type);
    if (s.quiet !== null) clearTimeout(s.quiet);
    setSpeech((v) => ({ text, on: true, n: v.n + 1 }));
    s.quiet = setTimeout(() => setSpeech((v) => ({ ...v, on: false })), 1700 + text.length * 45);
    const el = sayRef.current;
    if (el === null) return;
    if (reducedRef.current || hiddenRef.current) {
      el.textContent = text;
      return;
    }
    let i = 0;
    el.textContent = '';
    s.type = setInterval(() => {
      i = Math.min(text.length, i + 2);
      if (sayRef.current !== null) sayRef.current.textContent = text.slice(0, i);
      if (i >= text.length && s.type !== null) {
        clearInterval(s.type);
        s.type = null;
      }
    }, 24);
  };

  /* ── geometry ── */
  const compact = props.compact === true || (sizes.rh > 0 && sizes.rh < 540);
  const tall = !compact && sizes.rh >= 1000;
  const padTop = compact ? 14 : 12;
  const padBottom = sizes.rw > 0 && sizes.rw < 350 ? 62 : 72;
  const mode = stageMode(sizes.sw, sizes.sh, padTop, padBottom);
  probe.current.mode = mode;
  const shown = shuffle ?? look;
  const frame: StageFrame = frameStage(sizes.sw, sizes.sh, shown, mode, padTop, padBottom);
  const placed = useMemo(() => layoutLook(shown), [encodeLook(shown)]);

  /** An item's final box in room px for a look (where a flight lands). */
  const roomBox = (l: AvatarLook, id: number): Rect | null => {
    const f = frameStage(sizes.sw, sizes.sh, l, mode, padTop, padBottom);
    const p = layoutLook(l).find((q) => q.item.id === id);
    if (p === undefined) return null;
    const b = boxOnStage(f, p);
    return { x: b.x + sizes.sx, y: b.y + sizes.sy, w: b.w, h: b.h };
  };
  const roomPt = (l: AvatarLook, xy: readonly [number, number]): Pt => {
    const f = frameStage(sizes.sw, sizes.sh, l, mode, padTop, padBottom);
    return { x: sizes.sx + f.x + (xy[0] / 100) * DW * f.s, y: sizes.sy + f.y + (xy[1] / 100) * DH * f.s };
  };
  const dollRect = (l: AvatarLook): Rect => {
    const f = frameStage(sizes.sw, sizes.sh, l, mode, padTop, padBottom);
    return { x: sizes.sx + f.x, y: sizes.sy + f.y, w: DW * f.s, h: DH * f.s };
  };
  const tileCenter = (el: HTMLElement | null): Pt | null => {
    const root = rootRef.current;
    if (el === null || root === null) return null;
    const a = el.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    return { x: a.left - r.left + a.width / 2, y: a.top - r.top + a.height / 2 };
  };
  const live = (): boolean => !reducedRef.current && !hiddenRef.current && fxRef.current !== null;

  /* ── effects of one change ── */
  const landFx = (l: AvatarLook, it: AvatarItem, stacked: boolean): void => {
    const layer = fxRef.current;
    sound.land(it.snd);
    buzz.bump();
    if (layer === null || !live()) return;
    const img = rigRef.current?.querySelector<HTMLElement>(`[data-item="${it.id}"]`);
    if (img !== null && img !== undefined && typeof img.animate === 'function') {
      img.animate(squashFrames(it.fly), { duration: it.fly === 'lob' ? 440 : 360, easing: 'ease-out' });
    }
    const box = roomBox(l, it.id);
    const contact = it.contact !== undefined ? roomPt(l, it.contact) : box !== null ? { x: box.x + box.w / 2, y: box.y + box.h * 0.8 } : null;
    if (contact !== null) sparks(layer, contact, (box?.w ?? 80) * 0.7, it.colors ?? []);
    const R = dollRect(l);
    const k = Math.max(0.6, Math.min(1, R.w / 220));
    if (stacked && box !== null) kaboom(layer, { x: box.x + box.w / 2 + (Math.random() < 0.5 ? -1 : 1) * box.w * 0.55, y: box.y + box.h * 0.2 }, { text: BURST.stack, color: '#FF7EB6', k: k * 0.9 });
    else if (box !== null) {
      const side = Math.random() < 0.5 ? -1 : 1;
      kaboom(layer, { x: side > 0 ? box.x + box.w + 24 * k : box.x - 24 * k, y: box.y + 8 }, { text: pick(BURST.land), color: it.burst, k: k * 0.85, rot: side * (6 + Math.random() * 8) });
    }
    wobble(it.weight ?? 0.5, (it.weight ?? 0) > 0.8);
  };

  const launch = (l: AvatarLook, it: AvatarItem, from: Pt | null, stacked: boolean): void => {
    const layer = fxRef.current;
    const to = roomBox(l, it.id);
    if (layer === null || to === null || !live()) {
      landFx(l, it, stacked);
      return;
    }
    flights.current.get(it.id)?.cancel();
    const f = flyIn({
      layer,
      id: it.id,
      src: it.file,
      to,
      from,
      fly: it.fly,
      doll: dollRect(l),
      onLand: () => {
        if (flights.current.get(it.id) === f) flights.current.delete(it.id);
        probe.current.flying = flights.current.size;
        setFlyVer((v) => v + 1);
        if (!hiddenRef.current) landFx(lookRef.current, it, stacked);
      },
    });
    flights.current.set(it.id, f);
    probe.current.flying = flights.current.size;
    sound.whoosh();
  };

  const flick = (l: AvatarLook, ids: readonly number[], stagger: number): void => {
    const layer = fxRef.current;
    if (layer === null || !live()) return;
    const order = [...ids].reverse(); // the top of the tower leaves first
    order.forEach((id, i) => {
      const it = getItem(id);
      const box = roomBox(l, id);
      if (it === undefined || box === null) return;
      tumble(layer, it.file, box, i % 2 === 0 ? (Math.random() < 0.5 ? -1 : 1) : 1, it.power ?? 1, i * stagger);
    });
  };

  /* ── actions ── */
  const stopShuffle = (): void => {
    if (shuffleTimer.current !== null) clearInterval(shuffleTimer.current);
    shuffleTimer.current = null;
    setShuffle(null);
  };
  const shuffleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const onTapItem = (id: number, el: HTMLElement | null): void => {
    const it = getItem(id);
    if (it === undefined) return;
    stopShuffle();
    const prev = lookRef.current;
    const next = tapItem(prev, id);
    const before = new Set(wornIds(prev));
    const after = new Set(wornIds(next));
    const removed = [...before].filter((x) => !after.has(x) && !flights.current.has(x));
    const added = [...after].filter((x) => !before.has(x));
    flick(prev, removed, 0);
    commit(next);
    buzz.tap();
    if (added.includes(id)) {
      const stacked = it.slot === 'HEAD' && next.head.length > 1 && next.head[next.head.length - 1] === id;
      launch(next, it, tileCenter(el), stacked);
      const replacedTop = it.slot === 'HEAD' && prev.head.length >= AVATAR_MAX_TOWER && next.head.length === prev.head.length;
      if (replacedTop) say(pick(LINES.towerFull));
      else if (stacked) say(LINES.tower[next.head.length] ?? itemLine(it));
      else say(itemLine(it));
      if (stacked) sound.stack(next.head.length);
    } else {
      sound.off();
      say(pick(id === 7 ? LINES.bowOff : LINES.flick));
      const layer = fxRef.current;
      if (layer !== null && live()) {
        const box = roomBox(prev, id);
        if (box !== null) kaboom(layer, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, { text: pick(BURST.off), color: '#4F6CFF', k: 0.75 });
      }
      wobble(0.4);
    }
  };

  const onTapPlate = (bg: number): void => {
    stopShuffle();
    const prev = lookRef.current;
    if (prev.bg === bg) {
      sound.pop(0.9);
      wobble(0.2);
      return;
    }
    commit({ ...prev, head: [...prev.head], bg });
    buzz.tap();
    sound.pop(1.1 + bg * 0.03);
    say(pick(LINES.bg));
    wobble(0.3);
  };

  const onShake = (): void => {
    stopShuffle();
    const prev = lookRef.current;
    const ids = wornIds(prev).filter((x) => !flights.current.has(x));
    const had = wornIds(prev).length > 0;
    flick(prev, ids, 70);
    commit(shakeOff(prev));
    buzz.bump();
    sound.shake();
    const layer = fxRef.current;
    if (layer !== null && live()) {
      const R = dollRect(prev);
      kaboom(layer, { x: R.x + R.w * 0.2, y: R.y + R.h * 0.18 }, { text: BURST.shake, color: '#4F6CFF', big: true, k: Math.max(0.6, Math.min(1, R.w / 240)), rot: -12 });
    }
    wobble(0.8, true);
    later(() => wobble(0.6), 160);
    say(pick(had ? LINES.shake : LINES.shakeEmpty), true);
  };

  const onRandom = (): void => {
    stopShuffle();
    const prev = lookRef.current;
    let next = prev;
    for (let i = 0; i < 8; i++) {
      const cand = normalizeLook(randomLook((Math.random() * 2 ** 31) >>> 0, ITEM_IDS));
      next = cand;
      if (encodeLook(cand) !== encodeLook(prev) && wornIds(cand).length > 0) break;
    }
    for (const f of flights.current.values()) f.cancel();
    flights.current.clear();
    commit(next);
    buzz.tap();
    const finale = (): void => {
      setShuffle(null);
      shuffleTimer.current = null;
      sound.pop(1.4);
      const layer = fxRef.current;
      if (layer !== null && live()) {
        const R = dollRect(next);
        kaboom(layer, { x: R.x + R.w * 0.5, y: R.y + R.h * 0.12 }, { text: BURST.random, color: '#FF7EB6', big: true, k: Math.max(0.6, Math.min(1, R.w / 240)), rot: -6 });
        for (const id of wornIds(next)) {
          const img = rigRef.current?.querySelector<HTMLElement>(`[data-item="${id}"]`);
          const it = getItem(id);
          if (img !== null && img !== undefined && typeof img.animate === 'function' && it !== undefined) img.animate(squashFrames(it.fly), { duration: 380, easing: 'ease-out' });
        }
      }
      wobble(0.9, true);
      say(pick(LINES.random), true);
    };
    if (!live()) {
      finale();
      return;
    }
    let n = 0;
    shuffleTimer.current = setInterval(() => {
      n++;
      if (n >= SHUFFLE_STEPS) {
        if (shuffleTimer.current !== null) clearInterval(shuffleTimer.current);
        finale();
        return;
      }
      setShuffle(normalizeLook(randomLook((Math.random() * 2 ** 31) >>> 0, ITEM_IDS)));
      sound.tap(1 + n * 0.12);
      wobble(0.25);
    }, SHUFFLE_STEP_MS);
  };

  const onDone = (): void => {
    stopShuffle();
    for (const f of flights.current.values()) f.finish();
    flights.current.clear();
    emit();
    const l = normalizeLook(lookRef.current);
    probe.current.lastDone = encodeLook(l);
    sound.done();
    buzz.done();
    const layer = fxRef.current;
    if (layer !== null && live()) {
      const R = dollRect(l);
      kaboom(layer, { x: R.x + R.w * 0.5, y: R.y + R.h * 0.3 }, { text: BURST.done, color: '#F2361B', big: true, k: Math.max(0.6, Math.min(1, R.w / 240)), rot: -8 });
      confetti(layer, ['#F2361B', '#FFD21F', '#4F6CFF', '#FF7EB6', '#FFFFFF']);
    }
    wobble(1, true);
    say(pick(LINES.done), true);
    try {
      propsRef.current.onDone?.(l);
    } catch (err) {
      console.warn('[dressing] onDone threw', err);
    }
  };

  /* ── shelf: lazy thumbnails via one IntersectionObserver ── */
  const ioRef = useRef<IntersectionObserver | null>(null);
  const seenCb = useRef(new Map<Element, () => void>());
  useEffect(() => {
    const shelf = shelfRef.current;
    if (shelf === null || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const cb = seenCb.current.get(e.target);
          seenCb.current.delete(e.target);
          io.unobserve(e.target);
          cb?.();
        }
      },
      { root: shelf, rootMargin: '0px 90px' },
    );
    ioRef.current = io;
    for (const el of seenCb.current.keys()) io.observe(el);
    return () => {
      io.disconnect();
      ioRef.current = null;
    };
  }, []);
  const register: Register = (el, onSeen) => {
    if (typeof IntersectionObserver === 'undefined') {
      onSeen();
      return () => undefined;
    }
    seenCb.current.set(el, onSeen);
    ioRef.current?.observe(el);
    return () => {
      seenCb.current.delete(el);
      ioRef.current?.unobserve(el);
    };
  };

  // edge fades only where there is more to scroll (RTL: scrollLeft runs from 0 to negative)
  const [fade, setFade] = useState({ s: false, e: false });
  const paintFade = (): void => {
    const el = shelfRef.current;
    if (el === null) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    const next = { s: max > 2 && pos > 2, e: max > 2 && pos < max - 2 };
    setFade((f) => (f.s === next.s && f.e === next.e ? f : next));
  };
  useLayoutEffect(() => {
    const el = shelfRef.current;
    if (el !== null) {
      el.scrollLeft = 0;
      // bring what is worn on this shelf into view (the plate, the bottom hat)
      const on = el.querySelector<HTMLElement>('.dr-tile.worn');
      if (on !== null) {
        const r = on.getBoundingClientRect();
        const sr = el.getBoundingClientRect();
        if (r.left < sr.left + 8 || r.right > sr.right - 8) el.scrollLeft += r.left + r.width / 2 - (sr.left + sr.width / 2);
      }
    }
    paintFade();
  }, [tab, sizes.rw]);

  const pickTab = (t: DressingTab): void => {
    if (t === tab) return;
    setTab(t);
    sound.tap(1.2);
    buzz.tap();
  };

  /* ── render ── */
  const itemsBySlot = useMemo(() => {
    const m: Record<AvatarSlot, AvatarItem[]> = { HEAD: [], EYES: [], EARS: [], FACE: [], NECK: [] };
    for (const it of ITEMS) m[it.slot].push(it);
    return m;
  }, [ITEMS.length]);

  const tilePx = compact ? 54 : sizes.rw > 0 && sizes.rw < 350 ? 56 : 62;
  const px = devicePx(tilePx);
  const worn = new Set(wornIds(look));
  const tabItems = tab === 'BG' ? [] : itemsBySlot[tab];
  const cutLook = useMemo(() => ({ ...look, head: [...look.head], bg: 0 }), [encodeLook(look)]);
  const cut = useThumb(cutLook, 'icon', px, tab === 'BG', 'look').url;

  const headLayers = placed.filter((p) => p.layer !== 'NECK');
  const neckLayers = placed.filter((p) => p.layer === 'NECK');
  const itemImg = (p: PlacedItem): JSX.Element => (
    <img
      key={`${p.item.id}`}
      class={`dr-it l-${p.layer.toLowerCase()}`}
      data-item={p.item.id}
      src={p.item.file}
      alt=""
      draggable={false}
      style={{
        left: `${p.x}px`,
        top: `${p.y}px`,
        width: `${p.w}px`,
        height: `${p.h}px`,
        visibility: flights.current.has(p.item.id) && shuffle === null ? 'hidden' : undefined,
        transformOrigin: p.item.contact !== undefined ? `${(((p.item.contact[0] / 100) * DW - p.x) / p.w) * 100}% ${(((p.item.contact[1] / 100) * DH - p.y) / p.h) * 100}%` : '50% 80%',
      }}
    />
  );

  const counts: Record<DressingTab, number> = {
    HEAD: look.head.length,
    EYES: look.eyes !== null ? 1 : 0,
    FACE: look.face !== null ? 1 : 0,
    EARS: look.ears !== null ? 1 : 0,
    NECK: look.neck !== null ? 1 : 0,
    BG: 0,
  };
  const ready = sizes.sw > 0 && sizes.sh > 0;
  // the speech box sits under his chin, or at the top (over the hats) when the chin is too low
  const faceBottom = frame.y + 0.475 * DH * frame.s;
  const speechAtTop = mode === 'bust' && sizes.sh - faceBottom < (sizes.rw < 350 ? 54 : 60);
  const icon = <Avatar look={look} size={compact ? 40 : 44} ring label={name !== '' ? `הלוגו של ${name}` : 'הלוגו שלך'} />;

  return (
    <div
      ref={rootRef}
      class={`dr${compact ? ' dr-compact' : ''}${tall ? ' dr-tall' : ''}${reduced ? ' dr-reduced' : ''}${hidden ? ' dr-paused' : ''} dr-${mode}`}
      dir="rtl"
      lang="he"
    >
      {!compact && (
        <header class="dr-bar">
          <span class="dr-live">
            <i aria-hidden="true" />
            חדר הלבשה
          </span>
          <span class="dr-chip" title="ככה תופיעו בטבלה בטלוויזיה">
            {icon}
            <span class="dr-chip-t">
              <b>הלוגו שלך</b>
              <small>ככה בטבלה</small>
            </span>
          </span>
        </header>
      )}

      <div ref={stageRef} class="dr-stage">
        <div class="dr-rays" aria-hidden="true" />
        <div class="dr-glow" aria-hidden="true" />
        <div class="dr-dots" aria-hidden="true" />
        {mode === 'full' && ready && (
          <div
            class="dr-disc"
            aria-hidden="true"
            style={{ left: `${sizes.sw / 2 - frame.discW / 2}px`, top: `${frame.floorY - frame.discH * 0.32}px`, width: `${frame.discW}px`, height: `${frame.discH}px` }}
          >
            <div class="side" />
            <div class="top" />
          </div>
        )}
        {mode === 'full' && ready && (
          <div
            class="dr-shadow"
            aria-hidden="true"
            style={{ left: `${sizes.sw / 2 - frame.discW * 0.36}px`, top: `${frame.floorY - frame.discH * 0.18}px`, width: `${frame.discW * 0.72}px`, height: `${frame.discH * 0.36}px` }}
          />
        )}
        {ready && (
          <div
            ref={rigRef}
            class="dr-rig"
            style={{ width: `${DW}px`, height: `${DH}px`, transform: `translate(${frame.x.toFixed(1)}px,${frame.y.toFixed(1)}px) scale(${frame.s.toFixed(4)})`, '--inv': (1 / frame.s).toFixed(3) }}
            aria-hidden="true"
          >
            <div
              class="dr-plate"
              style={{
                left: `${PLATE.x}px`,
                top: `${PLATE.y}px`,
                width: `${PLATE.d}px`,
                height: `${PLATE.d}px`,
                backgroundColor: AVATAR_BGS[look.bg]?.color,
                backgroundImage: `url(${plateUrl(look.bg, 256)})`,
              }}
            />
            <div ref={springRef} class="dr-spring">
              <img class="dr-d dr-d-body" src={DOLL.file} alt="" draggable={false} />
              <div ref={headRef} class="dr-head">
                <div class="dr-head-idle">
                  <img class="dr-d dr-d-head" src={DOLL.file} alt="" draggable={false} />
                  {headLayers.map(itemImg)}
                </div>
              </div>
              {neckLayers.map(itemImg)}
            </div>
          </div>
        )}
        <span class="dr-name" title={name}>
          {name !== '' ? name : 'אני'}
        </span>
        {compact && <span class="dr-chip dr-chip-float">{icon}</span>}
        <div class={`dr-say${speech.on ? '' : ' quiet'}${speechAtTop ? ' top' : ''}`} aria-hidden="true">
          <div class="dr-say-tag">
            <b>{name !== '' ? name : 'שימי'}</b>
            <small>בשידור חי</small>
          </div>
          <p class="dr-say-text">
            <span ref={sayRef} />
          </p>
        </div>
        <p class="dr-sr" aria-live="polite">
          {speech.text}
        </p>
      </div>

      <div class="dr-tray">
        <div class="dr-tabs" role="tablist" aria-label="מדפים">
          {DRESSING_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              class={`dr-tab${t.id === tab ? ' on' : ''}`}
              aria-selected={t.id === tab ? 'true' : 'false'}
              data-tab={t.id}
              onClick={() => pickTab(t.id)}
            >
              {t.label}
              {counts[t.id] > 0 && <span class="dr-tab-n">{t.id === 'HEAD' ? counts[t.id] : ''}</span>}
            </button>
          ))}
        </div>
        <div ref={shelfRef} class={`dr-shelf${fade.s ? ' fs' : ''}${fade.e ? ' fe' : ''}`} role="tabpanel" onScroll={paintFade} style={{ '--tile': `${tilePx}px` }}>
          {tab === 'BG'
            ? Array.from({ length: AVATAR_BG_COUNT }, (_, bg) => <PlateTile key={`bg${bg}`} bg={bg} on={look.bg === bg} cut={cut} px={px} onTap={onTapPlate} />)
            : tabItems.map((it) => (
                <ItemTile
                  key={it.id}
                  item={it}
                  worn={worn.has(it.id)}
                  level={look.head.indexOf(it.id)}
                  towerSize={look.head.length}
                  px={px}
                  register={register}
                  onTap={onTapItem}
                />
              ))}
          {tab !== 'BG' && tabItems.length === 0 && <span class="dr-empty">עוד אין כאן פריטים</span>}
        </div>
        <div class="dr-acts">
          <button type="button" class="dr-btn dr-shake" onClick={onShake}>
            ניעור
          </button>
          <button type="button" class="dr-btn dr-rand" onClick={onRandom}>
            הפתע אותי
          </button>
          <button type="button" class="dr-btn dr-done" onClick={onDone}>
            מוכן!
          </button>
        </div>
      </div>

      <div ref={fxRef} class="dr-fx" aria-hidden="true" />
    </div>
  );
}

export default DressingRoom;
