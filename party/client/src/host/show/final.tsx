/** FinalScene: drum-roll, third, second, first with the crown, the champion song, then the full ranking. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { sfx } from '../../kit/audio';
import { playTrack, stopTrack } from '../../kit/music';
import { backdropUrl, crownUrl, podiumUrl } from './art';
import { Avatar, CountUp, formatScore, useFrame, useStage } from './common';
import { useFunnyLayer } from './funny';

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

function timelineFor(n: number): Timeline {
  if (n >= 3) return { third: 2_600, second: 4_900, first: 7_600, table: 13_200 };
  if (n === 2) return { third: NEVER, second: 2_600, first: 5_200, table: NEVER };
  return { third: NEVER, second: NEVER, first: 2_600, table: NEVER };
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
          <Avatar avatar={entry.player.avatar} name={entry.player.name} look={entry.player.look} crop="bust" class={place === 1 ? 'sh-avatar--xl' : 'sh-avatar--lg'} />
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
  const tl = timelineFor(n);
  const tlRef = useRef(tl);
  tlRef.current = tl;
  const champion = ranked[0];
  const champName = champion?.player.name ?? '';
  const championRef = useRef(champName);
  championRef.current = champName;

  const clock = useRef(0);
  const [step, setStep] = useState(0);
  const stepRef = useRef(-1);
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const activeRef = useRef(props.active);
  activeRef.current = props.active;
  const song = useRef(false);
  const lastBurst = useRef(0);
  const perPage = size.portrait ? 6 : 10;
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
    const t = clock.current;
    const next = stepAt(t, tlRef.current);
    const layer = funny.layer();
    if (next !== stepRef.current) {
      const prev = stepRef.current;
      stepRef.current = next;
      setStep(next);
      if (next === 0) {
        sfx.drumroll(tlRef.current.third === NEVER ? (tlRef.current.second === NEVER ? 2_500 : 2_500) : 2_500);
        layer?.sayLine('finalIntro', {}, 'happy', { force: true, holdMs: 2_300 });
      }
      if (next === 1 || next === 2) {
        sfx.land();
        sfx.fanfare();
        layer?.burst(next === 1 ? 0.72 : 0.28, 0.6, 50);
        if (next === 2 || prev < 1) sfx.drumroll(tlRef.current.first - t - 150);
      }
      if (next === 3) {
        playTrack('final', { fallback: 'victory' });
        song.current = true;
        sfx.cheer();
        layer?.flash('#ffffff');
        layer?.zoom();
        layer?.cannons(130);
        layer?.rain(90);
        const c = championRef.current;
        if (c !== '') layer?.sayLine('champion', { a: c }, 'shocked', { force: true, crazy: true, holdMs: 5_200 });
      }
      if (next === 4) layer?.hush();
    }
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
  return (
    <section
      class={`sh-scene sh-final sh-final--s${step} ${showTable ? 'has-table' : ''} ${n < 3 ? 'is-small' : ''}`}
      dir="rtl"
      ref={ref}
      style={bg !== null ? { backgroundImage: `linear-gradient(rgba(16,35,140,.82), rgba(16,35,140,.9)), url("${bg}")` } : undefined}
    >
      {/* the sun that rises behind the podium when the champion is named */}
      <div class="sh-final-sun" aria-hidden="true" />
      <header class="sh-final-head">
        {step >= 3 && champion ? (
          <div class="sh-champ" key="champ">
            <div class="sh-champ-kicker">🏆 המקום הראשון של הערב 🏆</div>
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
          <div class="sh-ftable-rows" key={page}>
            {pageRows.map((r, i) => (
              <div class={`sh-frow ${r.rank <= 3 ? `is-top${r.rank}` : ''}`} key={r.player.id} style={{ animationDelay: `${i * 60}ms` }}>
                <span class="sh-rank">{r.rank}</span>
                <Avatar avatar={r.player.avatar} name={r.player.name} look={r.player.look} />
                <span class="sh-name" dir="auto">
                  <bdi>{r.player.name}</bdi>
                </span>
                <CountUp class="sh-total" value={r.player.total} ms={1_000} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {funny.node}
    </section>
  );
}
