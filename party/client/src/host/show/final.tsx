/** FinalScene: drum-roll, third, second, first with the crown, the champion song, then the full ranking. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { clipMs, hasClip, sfx } from '../../kit/audio';
import { soundOffsetMs } from '../../kit/av-sync';
import { hasTrackFile, playTrack, stopTrack } from '../../kit/music';
import { SHOW_SONG_VOLUME } from '../music-config';
import { backdropUrl, crownUrl, podiumUrl, prizeArt } from './art';
import { cardGrid } from './card-grid';
import { PlayerCard, useBoardBox } from './cards';
import { Avatar, CountUp, formatScore, useFrame, useStage } from './common';
import { finaleArt, preloadFinaleArt } from './finale-art';
import { useFunnyLayer } from './funny';
import { cueNarration, isNarratorOn, setNarrationSlot } from './narrator-bus';
import { isShowCalm } from './settings';
import './final.css';

import type { JSX } from 'preact';
import type { PlayerPublic } from '../../../../shared/protocol';
import type { FinalSceneProps } from './types';

interface Ranked {
  readonly player: PlayerPublic;
  readonly rank: number;
}

interface Timeline {
  readonly third: number;
  readonly second: number;
  readonly first: number;
  readonly table: number;
}

const PAGE_MS = 5_500;
const NEVER = Number.POSITIVE_INFINITY;
/** The curtain opens on the podium this long into the drum roll. */
const CURTAIN_OPEN_MS = 650;
/**
 * The owner's drum roll (drumroll.mp3, 14.11: "a 5 seconds drum roll before we reveal the podium,
 * keep the curtains hidden"): it plays first with the curtain closed, and the podium below starts
 * so that the curtain opens the moment it ends. Its length is the file's (DRUMROLL_MS while it is
 * still decoding), at most DRUMROLL_MAX_MS. Without the file the podium starts as it always did.
 */
const DRUMROLL_MS = 4_200;
const DRUMROLL_MAX_MS = 7_000;
/** The toy cannons fire this long after the champion is named (they pop up first), and once more. */
const CANNON_FIRE_MS = [520, 2_300] as const;
/** Where the spotlights' lenses are (design units; final.css puts the lamps there). */
const SPOT_L = { x: 173, y: 140 } as const;
const SPOT_R = { x: 1920 - 173, y: 140 } as const;

/**
 * A spotlight beam's angle (deg, CSS rotate) from its lens to a target, both in design units:
 * the beam hangs straight down at 0 and swings toward the target.
 */
function beamAngle(lensX: number, lensY: number, x: number, y: number): number {
  return (-Math.atan2(x - lensX, Math.max(1, y - lensY)) * 180) / Math.PI;
}

function timelineFor(n: number, shift = 0): Timeline {
  const tl = n >= 3 ? { third: 2_600, second: 4_900, first: 7_600, table: 13_200 } : n === 2 ? { third: NEVER, second: 2_600, first: 5_200, table: NEVER } : { third: NEVER, second: NEVER, first: 2_600, table: NEVER };
  return { third: tl.third + shift, second: tl.second + shift, first: tl.first + shift, table: tl.table + shift };
}

/** How long the podium's own drum roll holds the curtain closed (ms): 0 without drumroll.mp3. */
function drumrollHoldMs(): number {
  if (!hasClip('drumroll')) return 0;
  return Math.min(DRUMROLL_MAX_MS, clipMs('drumroll') ?? DRUMROLL_MS);
}

/** 0 intro, 1 third is up, 2 second is up, 3 the champion, 4 the full table. */
function stepAt(t: number, tl: Timeline): number {
  if (t >= tl.table) return 4;
  if (t >= tl.first) return 3;
  if (t >= tl.second) return 2;
  if (t >= tl.third) return 1;
  return 0;
}

function Column(props: { place: 1 | 2 | 3; entry: Ranked | undefined; up: boolean }): JSX.Element | null {
  const { entry, place } = props;
  if (!entry) return null;
  const deco = podiumUrl(place);
  return (
    <div class={`sh-pod sh-pod--${place} ${props.up ? 'is-up' : ''}`}>
      <div class="sh-pod-rise">
        <div class="sh-pod-who">
          {entry.rank === 1 ? <img class="sh-pod-crown" src={crownUrl()} alt="" /> : null}
          <div class="fn-who-pic">
            <Avatar avatar={entry.player.avatar} name={entry.player.name} look={entry.player.look} crop="bust" class={place === 1 ? 'sh-avatar--xl' : 'sh-avatar--lg'} />
            {/* the medal of the place, pinned on the doll's chest */}
            {deco !== null ? (
              <span class="fn-medal" aria-hidden="true">
                <img src={deco} alt="" />
                <b>{entry.rank}</b>
              </span>
            ) : null}
          </div>
          <div class="sh-pod-name" dir="auto">
            <bdi>{entry.player.name}</bdi>
          </div>
          <div class="sh-pod-total" dir="ltr">
            {props.up ? <CountUp value={entry.player.total} from={0} ms={1_200} /> : '0'}
          </div>
        </div>
        <div class="sh-pod-block">
          {deco !== null ? <img class="sh-pod-deco" src={deco} alt="" /> : null}
          <span class="sh-pod-num">{entry.rank}</span>
        </div>
      </div>
    </div>
  );
}

export function FinalScene(props: FinalSceneProps): JSX.Element {
  const { ref, size } = useStage();
  const funny = useFunnyLayer(4242);
  const ranked = useMemo((): Ranked[] => {
    // The server's strict rank: exactly one player per podium step and one champion.
    return [...props.players].sort((a, b) => a.rank - b.rank).map((player, i) => ({ player, rank: i + 1 }));
  }, [props.players]);
  const n = ranked.length;
  /** The drum roll with the curtain closed (0: none), and how far it moves the podium's timeline. */
  const hold = useMemo(drumrollHoldMs, []);
  const shift = hold > 0 ? hold - CURTAIN_OPEN_MS : 0;
  const curtainAt = CURTAIN_OPEN_MS + shift;
  const tl = timelineFor(n, shift);
  const tlRef = useRef(tl);
  tlRef.current = tl;
  const champion = ranked[0];
  const champName = champion?.player.name ?? '';
  const championRef = useRef(champName);
  championRef.current = champName;

  const clock = useRef(0);
  const [step, setStep] = useState(0);
  const stepRef = useRef(-1);
  /** The sound side of the timeline: the step last heard, and the curtain's whoosh. */
  const heardStep = useRef(-1);
  const heardCurtain = useRef(false);
  /** The short roll that leads from the open curtain to the first place, after the owner's drum roll. */
  const heardLead = useRef(false);
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const activeRef = useRef(props.active);
  activeRef.current = props.active;
  const song = useRef(false);
  const lastBurst = useRef(0);
  /** The hosts' narration: one id per showing (a replay is a new showing), each moment once. */
  const sceneId = useRef(Math.floor(Math.random() * 1e9).toString(36));
  const narrated = useRef(new Set<string>());
  const narrate = (moment: 'podium' | 'champion' | 'goodbye', ttlMs: number, valid: () => boolean, name?: string, holdMs?: number): boolean => {
    if (narrated.current.has(moment)) return true;
    narrated.current.add(moment);
    return cueNarration({ id: `${moment}:${sceneId.current}`, moment, ttlMs, valid, name, holdMs });
  };
  // ── the stage (finale-art.ts): the curtain opens, the spotlights find each place, the trophy rises,
  //    the cannons fire. A missing picture leaves its piece out; calm mode keeps it plain. ──
  const art = finaleArt();
  const prize = prizeArt();
  const calm = isShowCalm();
  const [opened, setOpened] = useState(false);
  const openedRef = useRef(false);
  const fired = useRef(0);
  const [firing, setFiring] = useState(0);
  useEffect(() => preloadFinaleArt([crownUrl(), podiumUrl(1), podiumUrl(2), podiumUrl(3)]), []);

  // the final table: player cards (cards.tsx) as big as its box allows, paging in a big room
  const tableBox = useBoardBox();
  const grid = cardGrid(n, tableBox.w, tableBox.h, { aspect: 1.36, gap: 26 * size.u, maxW: 230 * size.u, minW: 140 * size.u });
  const perPage = tableBox.w > 0 ? grid.perPage : size.portrait ? 6 : 10;
  const pages = Math.max(1, Math.ceil(n / perPage));
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(
    () => () => {
      stopTrack('final', 600);
    },
    [],
  );
  useEffect(() => {
    if (!props.active && song.current) {
      song.current = false;
      stopTrack('final', 500);
    }
  }, [props.active]);

  useFrame((dt) => {
    if (!activeRef.current) return;
    clock.current += dt;
    // the sounds keep the podium's clock; the pictures wait for the speaker's delay (AirPlay,
    // kit/av-sync.ts: 0 without it), so the whoosh, the landings and the song meet their frames
    const ta = clock.current;
    const t = ta - soundOffsetMs();
    const next = stepAt(t, tlRef.current);
    const layer = funny.layer();
    if (!heardCurtain.current && ta >= curtainAt) {
      heardCurtain.current = true;
      if (finaleArt().curtain !== null && !isShowCalm()) sfx.whoosh(1.2);
    }
    const heard = stepAt(ta, tlRef.current);
    if (heard !== heardStep.current) {
      const before = heardStep.current;
      heardStep.current = heard;
      if (heard === 0) {
        if (hold > 0) sfx.podiumDrumroll(hold);
        else sfx.drumroll(2_500);
      }
      if (heard === 1 || heard === 2) {
        sfx.land();
        sfx.fanfare();
        if (heard === 2 || before < 1) sfx.drumroll(tlRef.current.first - ta - 150);
      }
      if (heard === 3) {
        playTrack('final', { fallback: 'victory', volume: hasTrackFile('final') ? SHOW_SONG_VOLUME.final : 1 });
        song.current = true;
        sfx.cheer();
      }
    }
    // after the owner's drum roll: the usual short roll up to the first place, as the curtain opens
    if (hold > 0 && !heardLead.current && ta >= hold) {
      heardLead.current = true;
      const firstAt = Math.min(tlRef.current.third, tlRef.current.second, tlRef.current.first);
      if (heard === 0 && firstAt - ta > 400) sfx.drumroll(firstAt - ta - 150);
    }
    if (!openedRef.current && t >= curtainAt) {
      openedRef.current = true;
      setOpened(true);
    }
    // the toy cannons pop up with the champion and fire twice
    const shot = CANNON_FIRE_MS[fired.current];
    if (next >= 3 && shot !== undefined && t >= tlRef.current.first + shot) {
      fired.current++;
      setFiring(fired.current);
      layer?.cannons(fired.current === 1 ? 150 : 90);
    }
    if (next !== stepRef.current) {
      const prev = stepRef.current;
      stepRef.current = next;
      setStep(next);
      if (next === 0) {
        // with the hosts narrating on the TV, the podium's opening line is theirs
        if (!isNarratorOn() || !narrate('podium', 1_500, () => clock.current < tlRef.current.first - 1_500, undefined, 2_400)) {
          layer?.sayLine('finalIntro', {}, 'happy', { force: true, holdMs: 2_300 });
        }
      }
      if (next === 1 || next === 2) layer?.burst(next === 1 ? 0.72 : 0.28, 0.6, 50);
      if (next === 3) {
        layer?.flash('#ffffff');
        layer?.zoom();
        layer?.rain(90);
        const c = championRef.current;
        // the hosts crown the champion (the name rides as a tag on their bubble); without them, the commentator
        const hosts = c !== '' && isNarratorOn() && narrate('champion', 1_500, () => clock.current < tlRef.current.first + 12_000, c, 2_700);
        if (c !== '' && !hosts) layer?.sayLine('champion', { a: c }, 'shocked', { force: true, crazy: true, holdMs: 5_200 });
      }
      if (next === 4) layer?.hush();
    }
    // goodbye: once the final table has had a look (or, with no table, a while after the champion)
    const byeAt = tlRef.current.table !== NEVER ? tlRef.current.table + 4_500 : tlRef.current.first + 10_000;
    if (next >= 3 && t >= byeAt && t < byeAt + 2_000) narrate('goodbye', 4_000, () => activeRef.current);
    if (next >= 3 && t - lastBurst.current > 2_600 && t < tlRef.current.first + 16_000) {
      lastBurst.current = t;
      layer?.burst(0.15 + ((t / 2_600) % 4) * 0.23, 0.22, 40);
    }
    if (next === 4) {
      const p = Math.floor((t - tlRef.current.table) / PAGE_MS) % pagesRef.current;
      if (p !== pageRef.current) {
        pageRef.current = p;
        setPage(p);
      }
    }
  });

  const bg = backdropUrl();
  const offset = Math.min(page * perPage, Math.max(0, n - perPage));
  const pageRows = ranked.slice(offset, offset + perPage);
  const showTable = step >= 4 && n > 3;
  // where the hosts may stand: the left margin while the podium rises, the top right once the table is in
  useEffect(() => {
    setNarrationSlot('final', showTable ? 'final-top' : 'final-left');
  }, [showTable]);

  // the spotlights aim at whoever just came up, both at the champion; measured from the podium
  // itself (layout sizes, so a column still rising is aimed at where it will stand)
  const lightsRef = useRef<HTMLDivElement | null>(null);
  const [aim, setAim] = useState<{ readonly l: number; readonly r: number } | null>(null);
  useEffect(() => {
    const lights = lightsRef.current;
    const scene = lights?.parentElement ?? null;
    const place = step === 1 ? 3 : step === 2 ? 2 : step === 3 ? 1 : null;
    if (lights === null || scene === null || place === null) {
      setAim(null);
      return;
    }
    const pod = scene.querySelector<HTMLElement>(`.sh-pod--${place}`);
    const rise = pod?.querySelector<HTMLElement>('.sh-pod-rise') ?? null;
    const pic = pod?.querySelector<HTMLElement>('.fn-who-pic') ?? null;
    if (!pod || rise === null || pic === null) {
      setAim(null);
      return;
    }
    const u = size.u || 1;
    const box = scene.getBoundingClientRect();
    const p = pod.getBoundingClientRect();
    const x = (p.left + p.width / 2 - box.left) / u;
    const y = (p.bottom - box.top) / u - rise.offsetHeight / u + (pic.offsetTop + pic.offsetHeight * 0.45) / u;
    setAim({ l: beamAngle(SPOT_L.x, SPOT_L.y, x, y), r: beamAngle(SPOT_R.x, SPOT_R.y, x, y) });
  }, [step, size.w, size.h]);
  return (
    <section
      class={`sh-scene sh-final sh-final--s${step} ${showTable ? 'has-table' : ''} ${n < 3 ? 'is-small' : ''}`}
      dir="rtl"
      ref={ref}
      style={bg !== null ? { backgroundImage: `linear-gradient(rgba(16,35,140,.82), rgba(16,35,140,.9)), url("${bg}")` } : undefined}
    >
      {/* the sun that rises behind the podium when the champion is named */}
      <div class="sh-final-sun" aria-hidden="true" />
      {/* the evening's trophy, with the angel standing in the cup: it rises with the champion */}
      {art.trophy !== null && n > 0 ? (
        <div class={`fn-trophy ${step >= 3 ? 'is-up' : ''} ${showTable ? 'is-away' : ''}`} aria-hidden="true">
          <div class="fn-trophy-glow" />
          {prize.cutout ? <img class="fn-trophy-angel" src={prize.url} alt="" draggable={false} /> : null}
          <img class="fn-trophy-cup" src={art.trophy} alt="" draggable={false} />
        </div>
      ) : null}
      {/* two toy spotlights: they sweep while the drums roll, then find each place */}
      {art.spotlight !== null && n > 0 ? (
        <div
          class={`fn-lights ${opened ? 'is-on' : ''} ${aim !== null ? 'is-aimed' : ''} ${showTable ? 'is-off' : ''}`}
          ref={lightsRef}
          style={aim !== null ? { '--al': `${aim.l.toFixed(1)}deg`, '--ar': `${aim.r.toFixed(1)}deg` } : undefined}
          aria-hidden="true"
        >
          <div class="fn-beam fn-beam--l" />
          <div class="fn-beam fn-beam--r" />
          <img class="fn-spot fn-spot--l" src={art.spotlight} alt="" draggable={false} />
          <img class="fn-spot fn-spot--r" src={art.spotlight} alt="" draggable={false} />
        </div>
      ) : (
        <div ref={lightsRef} hidden />
      )}
      {/* two toy confetti cannons pop up for the champion and fire */}
      {art.cannon !== null && n > 0 ? (
        <div class={`fn-cannons ${step >= 3 && !showTable ? 'is-up' : ''}`} aria-hidden="true">
          <img class="fn-cannon fn-cannon--l" key={`l${firing}`} src={art.cannon} alt="" draggable={false} data-shot={firing} />
          <img class="fn-cannon fn-cannon--r" key={`r${firing}`} src={art.cannon} alt="" draggable={false} data-shot={firing} />
        </div>
      ) : null}
      <header class="sh-final-head">
        {step >= 3 && champion ? (
          <div class="sh-champ" key="champ">
            <div class="sh-champ-kicker">🏆 המקום הראשון · זוכה בשימי אנג׳ל! 🏆</div>
            <div class="sh-champ-name" style={{ fontSize: `calc(${Math.min(size.portrait ? 110 : 190, Math.round((size.portrait ? 590 : 1500) / (Math.max(4, Array.from(champName).length) * 0.6)))} * var(--u))` }}>
              <bdi>{champion.player.name}</bdi>
            </div>
          </div>
        ) : (
          <div class="sh-final-title" key="title">
            {n === 0 ? 'אין שחקנים על הפודיום' : 'הפודיום של הערב'}
            <span class="sh-final-dots">
              <i>.</i>
              <i>.</i>
              <i>.</i>
            </span>
          </div>
        )}
      </header>
      <div class="sh-podium" dir="ltr">
        <Column place={2} entry={ranked[1]} up={step >= 2} />
        <Column place={1} entry={ranked[0]} up={step >= 3} />
        <Column place={3} entry={ranked[2]} up={step >= 1} />
      </div>
      {step >= 3 && champion ? (
        <span class="sh-burst sh-burst--champ" key="cheer">
          <span>וואו!</span>
        </span>
      ) : null}
      {showTable ? (
        <div class="sh-ftable">
          <div class="sh-ftable-head">
            <span>הדירוג הסופי</span>
            {pages > 1 ? (
              <span class="sh-head-sub">
                מקומות {offset + 1}–{offset + pageRows.length} מתוך {n}
              </span>
            ) : null}
          </div>
          <div class="sh-ftable-cards" key={page} ref={tableBox.ref}>
            {tableBox.w > 0
              ? pageRows.map((r, i) => {
                  const at = grid.slot(i);
                  return (
                    <PlayerCard
                      key={r.player.id}
                      name={r.player.name}
                      avatar={r.player.avatar}
                      look={r.player.look}
                      rank={r.rank}
                      cw={grid.cw}
                      u={size.u}
                      x={at.x}
                      y={at.y}
                      class={r.rank === 1 ? 'is-first' : ''}
                      testId="final-card"
                    >
                      <CountUp value={r.player.total} ms={1_000} />
                    </PlayerCard>
                  );
                })
              : null}
          </div>
        </div>
      ) : null}
      {/* the red velvet curtain over the stage at the start: it opens during the drum roll */}
      {art.curtain !== null && !calm ? (
        <div class={`fn-curtains ${opened ? 'is-open' : ''}`} aria-hidden="true">
          <div class="fn-curtain fn-curtain--l">
            <img src={art.curtain} alt="" draggable={false} />
          </div>
          <div class="fn-curtain fn-curtain--r">
            <img src={art.curtain} alt="" draggable={false} />
          </div>
          {art.valance !== null ? <div class="fn-valance" style={{ backgroundImage: `url("${art.valance}")` }} /> : null}
        </div>
      ) : null}
      {funny.node}
    </section>
  );
}
