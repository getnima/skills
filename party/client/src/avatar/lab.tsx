/**
 * Avatar lab (/avatar-lab.html): every accessory and every look, at every size.
 *   ?view=items   each item alone on the head: 28 / 40 / 64 / 128 / 256 px icons and a 320 px full doll
 *   ?view=slots   all items of a slot side by side at 128 px, the 12 plates, hat towers
 *   ?view=wall    random looks at 28 / 40 / 96 px like a full scoreboard (&n=120, &seed=7)
 *   ?view=proof   the source page's DOM placement next to the compositor, same frame
 *   ?view=room    the dressing room, when client/src/avatar/dressing.tsx exists
 * Extra: &break=<id> points that item's picture at a missing file (404 test).
 */
import './lab.css';

import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { AVATAR_SLOTS, decodeLook, defaultLook, encodeLook, randomLook } from '../../../shared/avatar';
import { Avatar } from './Avatar';
import { AVATAR_BGS, CATALOG_PROBLEMS, DOLL, ITEMS, ITEM_IDS, getItem, itemAr, itemsOfSlot, normalizeLook } from './catalog';
import { avatarBitmap, avatarCacheStats, composeAvatar, preloadAvatarAssets } from './compose';
import { frameLook } from './layout';

import type { ComponentType, JSX } from 'preact';

import type { AvatarLook, AvatarSlot } from '../../../shared/avatar';
import type { AvatarItem } from './catalog';
import type { AvatarCrop } from './layout';
import type { DressingRoomProps } from './room-contract';

const query = new URLSearchParams(location.search);
const VIEWS = ['items', 'slots', 'wall', 'proof', 'room'] as const;
type View = (typeof VIEWS)[number];
const VIEW_NAMES: Record<View, string> = { items: 'פריטים', slots: 'משבצות', wall: 'קיר', proof: 'הוכחה', room: 'חדר הלבשה' };
const view: View = (VIEWS as readonly string[]).includes(query.get('view') ?? '') ? (query.get('view') as View) : 'items';
const seed = Number(query.get('seed') ?? 1) || 1;
const SLOT_NAMES: Record<AvatarSlot, string> = { HEAD: 'ראש', EYES: 'עיניים', EARS: 'אוזניים', FACE: 'פנים', NECK: 'צוואר' };

// 404 test: break one item's picture before anything loads it
const breakId = Number(query.get('break') ?? 0);
if (breakId > 0) {
  const it = getItem(breakId);
  if (it !== undefined) (it as { file: string }).file = '/assets/shimi/__missing__.png';
}

interface LabReport {
  view: View;
  ready: boolean;
  wallMs: number | null;
  /** Part of wallMs until every picture was composed (the rest is painting them into the page). */
  wallComposeMs: number | null;
  wallCount: number;
  cache: ReturnType<typeof avatarCacheStats> | null;
  errors: string[];
}
const report: LabReport = { view, ready: false, wallMs: null, wallComposeMs: null, wallCount: 0, cache: null, errors: [] };
(window as unknown as { __avatarLab: LabReport }).__avatarLab = report;
window.addEventListener('error', (e) => report.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => report.errors.push(`unhandled: ${String(e.reason)}`));

function lookWith(it: AvatarItem, bg: number): AvatarLook {
  const l = defaultLook();
  l.bg = bg;
  if (it.slot === 'HEAD') l.head = [it.id];
  else if (it.slot === 'EYES') l.eyes = it.id;
  else if (it.slot === 'EARS') l.ears = it.id;
  else if (it.slot === 'FACE') l.face = it.id;
  else l.neck = it.id;
  return l;
}

function Cell(props: { look: AvatarLook; size: number; crop?: AvatarCrop; ring?: boolean; label?: string }): JSX.Element {
  return (
    <div class="lab-cell">
      <Avatar look={props.look} size={props.size} crop={props.crop} ring={props.ring} />
      <span>{props.label ?? `${props.size}`}</span>
    </div>
  );
}

function ItemsView(): JSX.Element {
  return (
    <div class="lab-items">
      {ITEMS.map((it) => {
        const look = lookWith(it, it.id % AVATAR_BGS.length);
        return (
          <section class="lab-card" key={it.id} data-item={it.id}>
            <h2>
              <span class="lab-tag id">#{it.id}</span>
              {it.name}
              <span class="lab-tag">{SLOT_NAMES[it.slot]}</span>
              <small>{encodeLook(look)}</small>
            </h2>
            <div class="lab-row">
              <Cell look={look} size={28} />
              <Cell look={look} size={40} />
              <Cell look={look} size={64} ring />
              <Cell look={look} size={128} ring />
              <Cell look={look} size={256} />
              <Cell look={look} size={320} crop="full" label="full 320" />
            </div>
          </section>
        );
      })}
    </div>
  );
}

const TOWERS: readonly (readonly number[])[] = [
  [2, 10], [8, 17], [12, 4], [1, 3], [14, 8], [16, 2], [10, 10],
  [2, 10, 17], [8, 3, 4], [12, 16, 17], [14, 10, 8], [1, 2, 8], [17, 4, 10], [3, 12, 14],
];

function SlotsView(): JSX.Element {
  return (
    <>
      {AVATAR_SLOTS.map((slot) => (
        <section class="lab-card" key={slot} data-slot={slot}>
          <h2>
            {SLOT_NAMES[slot]} <span class="lab-tag id">{slot}</span>
          </h2>
          <div class="lab-row">
            {itemsOfSlot(slot).map((it) => (
              <div class="lab-cell" key={it.id}>
                <Avatar look={lookWith(it, 4)} size={128} ring />
                <b>{it.name}</b>
                <span>#{it.id}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section class="lab-card" data-slot="BG">
        <h2>רקעים</h2>
        <div class="lab-row">
          {AVATAR_BGS.map((bg) => (
            <div class="lab-cell" key={bg.id}>
              <Avatar look={{ ...defaultLook(), bg: bg.id, head: bg.id % 3 === 1 ? [10] : [], eyes: bg.id % 4 === 2 ? 9 : null }} size={128} ring />
              <b>{bg.name}</b>
              <span>bg {bg.id}</span>
            </div>
          ))}
        </div>
        <div class="lab-row" style={{ marginTop: '12px' }}>
          {AVATAR_BGS.map((bg) => (
            <Cell key={bg.id} look={{ ...defaultLook(), bg: bg.id, head: [4] }} size={40} label={`bg ${bg.id}`} />
          ))}
        </div>
      </section>
      <section class="lab-card" data-slot="TOWER">
        <h2>מגדלי כובעים</h2>
        <div class="lab-row">
          {TOWERS.map((head, i) => {
            const look = normalizeLook({ ...defaultLook(), head: [...head], bg: i % AVATAR_BGS.length });
            return (
              <div class="lab-cell" key={i}>
                <div class="lab-row" style={{ gap: '6px' }}>
                  <Avatar look={look} size={128} ring />
                  <Avatar look={look} size={40} />
                  <Avatar look={look} size={28} />
                </div>
                <span>{encodeLook(look)}</span>
              </div>
            );
          })}
        </div>
        <div class="lab-row" style={{ marginTop: '12px' }}>
          {[TOWERS[7], TOWERS[9], TOWERS[4]].map((head, i) => {
            const look = normalizeLook({ ...defaultLook(), head: [...(head ?? [])], neck: i === 0 ? 7 : 15, eyes: 5, bg: 8 + i });
            return (
              <div class="lab-row" key={i} style={{ gap: '6px' }}>
                <Cell look={look} size={200} crop="bust" label="bust 200" />
                <Cell look={look} size={200} crop="full" label="full 200" />
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function WallView(): JSX.Element {
  const n = Math.max(1, Math.min(400, Number(query.get('n') ?? 120) || 120));
  const [looks] = useState(() => Array.from({ length: n }, (_, i) => randomLook(seed * 1000 + i, ITEM_IDS)));
  const [ms, setMs] = useState<number | null>(null);
  const [go, setGo] = useState(false);

  useEffect(() => {
    let alive = true;
    void preloadAvatarAssets().then(async () => {
      if (!alive) return;
      // two frames of quiet so the timing below measures composing, not loading
      await new Promise((r) => setTimeout(r, 300));
      const t0 = performance.now();
      setGo(true);
      await Promise.all(looks.flatMap((l) => [avatarBitmap(l, 40), avatarBitmap(l, 96)]));
      report.wallComposeMs = performance.now() - t0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const dt = performance.now() - t0;
      report.wallMs = dt;
      report.wallCount = n;
      report.cache = avatarCacheStats();
      if (alive) setMs(dt);
      // the 28 px row (the TV lobby at 60 players) comes after the measurement: the brief's wall is 40 + 96
      await Promise.all(looks.map((l) => avatarBitmap(l, 28)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      report.ready = true;
    });
    return () => {
      alive = false;
    };
  }, []);

  const stats = ms !== null ? avatarCacheStats() : null;
  return (
    <>
      <section class="lab-card">
        <h2>
          קיר של {n} <small>seed {seed}</small>
        </h2>
        <p class="lab-note" id="wall-stat" style={{ direction: 'ltr' }}>
          {ms === null
            ? 'composing…'
            : `${n} looks x 2 sizes (40, 96) in ${ms.toFixed(0)} ms · cache ${stats?.bitmaps} pictures, ${((stats?.bitmapBytes ?? 0) / 1024).toFixed(0)} KB`}
        </p>
        <div class="lab-wall tv" data-wall="28" style={{ minHeight: '28px' }}>
          {ms !== null && looks.map((l, i) => <Avatar key={i} look={l} size={28} />)}
        </div>
      </section>
      <section class="lab-card">
        <h2>40</h2>
        <div class="lab-wall tv" data-wall="40">
          {go && looks.map((l, i) => <Avatar key={i} look={l} size={40} />)}
        </div>
      </section>
      <section class="lab-card">
        <h2>96</h2>
        <div class="lab-wall" data-wall="96">
          {go && looks.map((l, i) => <Avatar key={i} look={l} size={96} ring />)}
        </div>
      </section>
    </>
  );
}

/* ───────── proof: the source page's placement (plain DOM, % of the doll box) next to the compositor ───────── */

const PROOF = 240;

/** The owner's page puts a worn item at left/top/width/height = place % of the doll box (overlayImg). */
function SourceDoll(props: { look: AvatarLook; crop: AvatarCrop }): JSX.Element {
  const look = props.look;
  const frame = frameLook(look, props.crop);
  const k = PROOF / frame.w;
  const W = DOLL.width * k;
  const H = DOLL.height * k;
  const worn = [look.ears, look.face, look.eyes, look.head[0] ?? null]
    .map((id) => (id === null ? undefined : getItem(id)))
    .filter((it): it is AvatarItem => it !== undefined);
  const neck = look.neck === null ? undefined : getItem(look.neck);
  // the tower exactly as the source computes it (hatDims + towerBaseTarget + the chain at rest), in px of this box
  const tower: JSX.Element[] = [];
  const base = look.head[0] === undefined ? undefined : getItem(look.head[0]);
  if (base !== undefined && base.tw !== undefined) {
    const p = base.place;
    const hh = (p[3] / 100) * H;
    const ax = ((p[0] + p[2] / 2) / 100) * W;
    let ay = (p[1] / 100) * H + (base.tw.crown + base.tw.sink) * hh;
    look.head.slice(1).forEach((id, level) => {
      const it = getItem(id);
      if (it === undefined || it.tw === undefined) return;
      const w = (it.place[2] / 100) * W * Math.pow(0.93, level + 1);
      const h = w * itemAr(it);
      tower.push(<img key={`t${level}`} src={it.file} alt="" style={{ left: `${ax - w / 2}px`, top: `${ay - it.tw.bottom * h}px`, width: `${w}px`, height: `${h}px` }} />);
      ay -= (it.tw.bottom - it.tw.crown - it.tw.sink) * h;
    });
  }
  const pct = (it: AvatarItem): Record<string, string> => ({
    left: `${it.place[0]}%`, top: `${it.place[1]}%`, width: `${it.place[2]}%`, height: `${it.place[3]}%`,
  });
  return (
    <div class="src-box" data-proof="src" style={{ width: `${PROOF}px`, height: `${PROOF}px` }}>
      <div class="src-doll" style={{ left: `${-frame.x * k}px`, top: `${-frame.y * k}px`, width: `${W}px`, height: `${H}px` }}>
        <img src={DOLL.file} alt="" style={{ inset: 0, width: '100%', height: '100%' }} />
        {worn.map((it) => <img key={it.id} src={it.file} alt="" style={pct(it)} />)}
        {tower}
        {neck !== undefined && <img src={neck.file} alt="" style={pct(neck)} />}
      </div>
    </div>
  );
}

function ComposedCanvas(props: { look: AvatarLook; crop: AvatarCrop }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    void preloadAvatarAssets().then(() => {
      const c = ref.current;
      if (c === null) return;
      const made = composeAvatar(props.look, { size: PROOF, crop: props.crop, plate: false, outline: false });
      c.getContext('2d')?.drawImage(made, 0, 0);
      c.dataset.done = '1';
    });
  }, []);
  return <canvas ref={ref} width={PROOF} height={PROOF} data-proof="ours" style={{ width: `${PROOF}px`, height: `${PROOF}px` }} />;
}

function ProofView(): JSX.Element {
  const cases: { name: string; look: AvatarLook; crop: AvatarCrop }[] = [
    ...ITEMS.map((it) => ({ name: `#${it.id} ${it.name}`, look: lookWith(it, 0), crop: (it.slot === 'NECK' ? 'bust' : 'icon') as AvatarCrop })),
    ...ITEMS.filter((it) => it.id <= 17).map((it) => ({ name: `#${it.id} full`, look: lookWith(it, 0), crop: 'full' as AvatarCrop })),
    ...TOWERS.map((head) => ({ name: `tower ${head.join('-')}`, look: normalizeLook({ ...defaultLook(), head: [...head] }), crop: 'icon' as AvatarCrop })),
    { name: 'everything', look: normalizeLook({ head: [8, 17], eyes: 9, ears: 6, face: 11, neck: 7, bg: 0 }), crop: 'bust' },
    { name: 'everything 2', look: normalizeLook({ head: [12], eyes: 5, ears: 13, face: 11, neck: 15, bg: 0 }), crop: 'full' },
  ];
  useEffect(() => {
    void preloadAvatarAssets().then(() => setTimeout(() => (report.ready = true), 400));
  }, []);
  return (
    <section class="lab-card">
      <h2>המקור (DOM) מול הקומפוזיטור</h2>
      <p class="lab-note">בכל זוג: משמאל ההנחה של דף המקור (תמונות ב-% מקופסת הבובה), מימין composeAvatar באותה מסגרת.</p>
      <div class="lab-row">
        {cases.map((c, i) => (
          <div class="lab-cell" key={i} data-case={c.name}>
            <div class="proof-pair">
              <SourceDoll look={c.look} crop={c.crop} />
              <ComposedCanvas look={c.look} crop={c.crop} />
            </div>
            <span>{c.name} · {c.crop}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────── room: the teammate's dressing room, when it exists ───────── */

// a glob never fails the build when the file is missing: it is simply an empty map
const roomModules = import.meta.glob('./dressing.tsx') as Record<string, () => Promise<Record<string, unknown>>>;

function RoomView(): JSX.Element {
  const [Room, setRoom] = useState<ComponentType<DressingRoomProps> | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'broken' | 'ok'>('loading');
  const [look, setLook] = useState<AvatarLook>(() => normalizeLook(query.get('look') !== null ? decodeLook(query.get('look')) : randomLook(seed, ITEM_IDS)));
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const load = roomModules['./dressing.tsx'];
    if (load === undefined) {
      setState('missing');
      report.ready = true;
      return;
    }
    load()
      .then((m) => {
        const C = (m.DressingRoom ?? m.default) as ComponentType<DressingRoomProps> | undefined;
        if (typeof C !== 'function') {
          setState('broken');
        } else {
          setRoom(() => C);
          setState('ok');
        }
      })
      .catch((err: unknown) => {
        report.errors.push(`dressing.tsx: ${String(err)}`);
        setState('broken');
      })
      .finally(() => (report.ready = true));
  }, []);

  return (
    <>
      <section class="lab-card">
        <h2>חדר ההלבשה</h2>
        <div class="lab-row" style={{ alignItems: 'center' }}>
          <Avatar look={look} size={28} />
          <Avatar look={look} size={40} />
          <Avatar look={look} size={64} ring />
          <Avatar look={look} size={128} ring />
          <span class="lab-code" id="room-look">{encodeLook(look)}</span>
          {done !== null && <span class="lab-tag">onDone: {done}</span>}
        </div>
      </section>
      <div class="lab-room" id="room">
        {state === 'ok' && Room !== null ? (
          <Room look={look} onChange={(l) => setLook(normalizeLook(l))} onDone={(l) => setDone(encodeLook(l))} name="אורח לדוגמה" />
        ) : (
          <div class="lab-empty">
            {state === 'loading' ? 'טוען…' : state === 'missing' ? 'חדר ההלבשה עוד לא נבנה (dressing.tsx)' : 'dressing.tsx לא מייצא DressingRoom'}
          </div>
        )}
      </div>
    </>
  );
}

function Lab(): JSX.Element {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((v) => v + 1), 1000);
    if (view === 'items' || view === 'slots') {
      void preloadAvatarAssets().then(() => setTimeout(() => {
        const wait = (): void => {
          if (avatarCacheStats().pending === 0) report.ready = true;
          else setTimeout(wait, 100);
        };
        wait();
      }, 300));
    }
    return () => clearInterval(t);
  }, []);
  const s = avatarCacheStats();
  const link = (v: View): string => {
    const q = new URLSearchParams(location.search);
    q.set('view', v);
    return `?${q.toString()}`;
  };
  return (
    <>
      <header class="lab-bar">
        <h1 class="lab-title">מעבדת אווטארים</h1>
        <nav class="lab-nav">
          {VIEWS.map((v) => (
            <a key={v} class={`lab-chip${v === view ? ' on' : ''}`} href={link(v)}>{VIEW_NAMES[v]}</a>
          ))}
        </nav>
        <span class="lab-stat">
          {ITEMS.length} items · cache {s.bitmaps} / {(s.bitmapBytes / 1024).toFixed(0)} KB · pending {s.pending}
          {CATALOG_PROBLEMS.length > 0 ? ` · ${CATALOG_PROBLEMS.length} CATALOG PROBLEMS` : ''}
        </span>
      </header>
      <main class="lab-main">
        {CATALOG_PROBLEMS.length > 0 && (
          <section class="lab-card">
            <h2>בעיות בקטלוג</h2>
            {CATALOG_PROBLEMS.map((p, i) => <p class="lab-note" key={i} style={{ direction: 'ltr' }}>{p}</p>)}
          </section>
        )}
        {view === 'items' && <ItemsView />}
        {view === 'slots' && <SlotsView />}
        {view === 'wall' && <WallView />}
        {view === 'proof' && <ProofView />}
        {view === 'room' && <RoomView />}
      </main>
    </>
  );
}

const root = document.getElementById('app');
if (root !== null) render(<Lab />, root);

