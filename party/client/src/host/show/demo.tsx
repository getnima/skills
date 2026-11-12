/**
 * /show.html: the control room. Preview and tune every scene of the TV show
 * without a party: fake players, a simulated race, buttons that force each
 * moment, the winner ceremony on demand.
 *
 * URL: ?scene=playing|results|final|standings &players=12 &seed=1 &dur=60000
 *      &bare=1 (scene only, full window) &calm=1 &sim=0 &winner=one|tie|none &lead=8000   (tie = two players on the same raw score: the earlier one wins)
 * Automation: window.__show (see ShowHooks below).
 */
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import '../../kit/base.css';
import './demo.css';
import { encodeLook, randomLook } from '../../../../shared/avatar';
import { GAMES, GAME_IDS, WINNER_REVEAL_MS } from '../../../../shared/protocol';
import { computeRoundScores, rankOverall } from '../../../../shared/scoring';
import { ITEM_IDS } from '../../avatar';
import { isMuted, setMuted, unlockAudio } from '../../kit/audio';
import { initMobileViewport } from '../../kit/mobile';
import { stopTrack } from '../../kit/music';
import { createRng } from '../../kit/rng';
import { FinalScene, isShowCalm, PlayingScene, ResultsScene, setShowCalm, StandingsPanel } from './index';
import { makeMoment, MOMENT_TYPES } from './moments';
import { injectMoment } from './playing';

import type { JSX } from 'preact';
import type { GameId, PlayerPublic, ResultRow, RoundResults } from '../../../../shared/protocol';
import type { RoundClockSample } from '../../games/types';
import type { MomentType } from './moments';

type SceneName = 'playing' | 'results' | 'final' | 'standings';
type WinnerKind = 'one' | 'tie' | 'none';
const SCENES: readonly SceneName[] = ['playing', 'results', 'final', 'standings'];

export interface ShowHooks {
  scene(name: SceneName): void;
  players(count: number): void;
  game(id: GameId): void;
  /** Start / pause the simulated race. */
  simulate(on: boolean): void;
  /** Restart the race from zero. */
  restart(): void;
  /** Jump the race clock to `elapsedMs`. */
  seek(elapsedMs: number): void;
  force(type: MomentType): void;
  /** Show the results scene; the winner is revealed `leadMs` from now (default 8000). */
  results(kind: WinnerKind, leadMs?: number): void;
  final(): void;
  freeze(on: boolean): void;
  /** Mimic a cutscene covering the results / final scene. */
  active(on: boolean): void;
  calm(on: boolean): void;
  mute(on: boolean): void;
  state(): { scene: SceneName; players: number; elapsedMs: number; leftMs: number; frozen: boolean; calm: boolean; leader: string | null };
}

declare global {
  interface Window {
    __show?: ShowHooks;
  }
}

const NAMES: readonly string[] = [
  'נועה', 'איתי', 'מאיה', 'יונתן', 'תמר', 'עומר', 'שירה', 'דניאל', 'יעל', 'אורי',
  'מקסימיליאן כהן', 'רוני', 'גיא', 'ליה', 'עידו', 'אלכסנדרה ב.', 'נדב', 'הילה', 'אסף', 'מיכל',
  'בן', 'טל', 'Jonathan', 'רותם', 'עדי', 'סבתא רחל', 'אלון', 'ענבל', 'יובל', 'קרן',
  'דודו המלך', 'שחר', 'ליאור', 'נטע', 'אביב', 'הדר', 'מתן', 'אופיר', 'זיו', 'גל',
  'רז', 'שני', 'אריאל', 'עמית', 'חן', 'ניר', 'סתיו', 'ים', 'ליאן', 'אייל',
  'DJ מוטי', 'עלמה', 'איתמר', 'אגם', 'נוי', 'דור', 'פזית', 'אליה', 'בר', 'צביקה',
];

const params = new URLSearchParams(location.search);

function numParam(key: string, fallback: number, min: number, max: number): number {
  const raw = params.get(key);
  const v = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

const SEED = numParam('seed', 7, 0, 1e9);
const DURATION = numParam('dur', 60_000, 5_000, 600_000);
const BARE = params.get('bare') === '1';

interface Racer {
  readonly id: string;
  /** Points per second. */
  readonly rate: number;
  /** Does nothing until this many ms (the sleepy one). */
  readonly wakeAt: number;
  /** Late surge multiplier from 62% of the round. */
  readonly surge: number;
  /** Loses a third of the score once, at this ms (the bomb), or -1. */
  readonly bombAt: number;
}

function makePlayers(count: number): PlayerPublic[] {
  const rng = createRng(SEED).fork('players');
  return withRanks(
    NAMES.slice(0, count).map((name, i) => ({
      id: `p${i + 1}`,
      name,
      avatar: i,
      look: encodeLook(randomLook(SEED * 131 + i, ITEM_IDS)),
      connected: i % 13 !== 12,
      total: Math.round(rng.float(300, 2_400) / 10) * 10,
      rank: i + 1,
    })),
  );
}

/** Strict ranks like the server's: total, then (here) the order in the list. */
function strictRanks(totals: ReadonlyArray<readonly [string, number]>): Map<string, number> {
  return rankOverall(totals.map(([id, total], joinOrder) => ({ id, total, wins: 0, best: 0, lastPos: null, joinOrder })));
}

function withRanks(players: readonly PlayerPublic[]): PlayerPublic[] {
  const ranks = strictRanks(players.map((p) => [p.id, p.total] as const));
  return players.map((p) => ({ ...p, rank: ranks.get(p.id) ?? players.length }));
}

function makeRacers(players: readonly PlayerPublic[], duration: number): Racer[] {
  const rng = createRng(SEED).fork('race');
  const n = players.length;
  const sleepy = n >= 4 ? rng.int(Math.floor(n / 2), n - 1) : -1;
  const surger = n >= 5 ? rng.int(Math.floor(n / 2), n - 1) : -1;
  const bomber = n >= 2 ? rng.int(0, Math.min(2, n - 1)) : -1;
  return players.map((p, i) => ({
    id: p.id,
    rate: rng.float(6, 16) * (i < 3 ? 1.25 : 1),
    wakeAt: i === sleepy ? duration * 0.37 : rng.float(0, 2_500),
    surge: i === surger && i !== sleepy ? 4.5 : 1,
    bombAt: i === bomber ? duration * 0.4 : -1,
  }));
}

function buildResults(players: readonly PlayerPublic[], raws: ReadonlyMap<string, number>, kind: WinnerKind, revealAt: number, gameId: GameId): RoundResults {
  const raw = new Map<string, number>();
  for (const p of players) raw.set(p.id, kind === 'none' ? 0 : Math.round(raws.get(p.id) ?? 0));
  if (kind !== 'none') {
    const sorted = [...raw].sort((a, b) => b[1] - a[1]);
    const best = sorted[0];
    const second = sorted[1];
    if (best && best[1] <= 0) raw.set(best[0], 100);
    if (kind === 'tie' && best && second) raw.set(second[0], Math.max(100, best[1]));
    if (kind === 'one' && best && second && second[1] === best[1]) raw.set(best[0], best[1] + 7);
  }
  // Everyone "reached" their score at a different moment. In the 'tie' demo the runner-up has the
  // SAME raw score as the leader and got there later: one winner, and the "⏱" hint on the stage.
  const order = [...raw].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const reachedAt = new Map<string, number | null>(players.map((p) => [p.id, (raw.get(p.id) ?? 0) > 0 ? revealAt - 60_000 + order.indexOf(p.id) * 700 : null]));
  const scored = computeRoundScores(
    players.map((p, joinOrder) => ({ id: p.id, raw: raw.get(p.id) ?? 0, reachedAt: reachedAt.get(p.id) ?? null, joinOrder, totalBefore: p.total })),
  );
  const prevRanks = strictRanks(players.map((p) => [p.id, p.total] as const));
  const totals = players.map((p) => [p.id, p.total + (scored.get(p.id)?.points ?? 0)] as const);
  const ranks = strictRanks(totals);
  const rows: ResultRow[] = players.map((p) => {
    const s = scored.get(p.id);
    return {
      playerId: p.id,
      name: p.name,
      avatar: p.avatar,
      look: p.look,
      raw: raw.get(p.id) ?? 0,
      points: s?.points ?? 0,
      roundRank: s?.roundRank ?? players.length,
      reachedAt: reachedAt.get(p.id) ?? null,
      total: p.total + (s?.points ?? 0),
      rank: ranks.get(p.id) ?? players.length,
      prevRank: prevRanks.get(p.id) ?? null,
    };
  });
  rows.sort((a, b) => a.rank - b.rank);
  const winnerIds = rows.filter((r) => r.roundRank === 1 && r.raw > 0).map((r) => r.playerId);
  return { roundIndex: 2, roundNumber: 3, gameId, rows, winnerIds, revealAt };
}

function Demo(): JSX.Element {
  const [scene, setScene] = useState<SceneName>(() => {
    const s = params.get('scene');
    return SCENES.find((x) => x === s) ?? 'playing';
  });
  const [count, setCount] = useState(() => numParam('players', 12, 1, 60));
  const [gameId, setGameId] = useState<GameId>(() => GAME_IDS.find((g) => g === params.get('game')) ?? 'ninja');
  const [running, setRunning] = useState(params.get('sim') !== '0');
  const [frozen, setFrozen] = useState(false);
  const [active, setActive] = useState(true);
  const [calm, setCalm] = useState(() => {
    if (params.has('calm')) setShowCalm(params.get('calm') === '1');
    return isShowCalm();
  });
  const [muted, setMutedState] = useState(isMuted());
  const [scores, setScores] = useState<ReadonlyMap<string, number>>(new Map());
  const [results, setResults] = useState<RoundResults | null>(null);
  const [runId, setRunId] = useState(0);
  const [bare, setBare] = useState(BARE);

  const players = useMemo(() => makePlayers(count), [count]);
  const racers = useMemo(() => makeRacers(players, DURATION), [players]);
  const sim = useRef({ elapsed: 0, scores: new Map<string, number>(), bombed: new Set<string>(), acc: 0, last: performance.now() });
  const flags = useRef({ running, frozen });
  flags.current = { running, frozen };
  const racersRef = useRef(racers);
  racersRef.current = racers;

  const resetRace = (): void => {
    sim.current = { elapsed: 0, scores: new Map(racersRef.current.map((r) => [r.id, 0])), bombed: new Set(), acc: 0, last: performance.now() };
    setScores(new Map(sim.current.scores));
    setRunId((v) => v + 1);
  };

  useEffect(resetRace, [racers]);

  // the race: time advances every frame, scores are published 4 times a second (like the server)
  useEffect(() => {
    let raf = 0;
    const frame = (t: number): void => {
      const s = sim.current;
      const dt = Math.min(100, t - s.last);
      s.last = t;
      if (flags.current.running && !flags.current.frozen && s.elapsed < DURATION) {
        s.elapsed = Math.min(DURATION, s.elapsed + dt);
        s.acc += dt;
        if (s.acc >= 250) {
          const step = s.acc / 1000;
          s.acc = 0;
          const rng = createRng(SEED + Math.floor(s.elapsed / 250)).fork('tick');
          for (const r of racersRef.current) {
            let v = s.scores.get(r.id) ?? 0;
            if (s.elapsed >= r.wakeAt) {
              const boost = s.elapsed > DURATION * 0.62 ? r.surge : 1;
              const wobble = 0.8 + Math.sin(s.elapsed / 3_000 + r.rate * 3) * 0.75;
              v += r.rate * boost * wobble * step * rng.float(0.2, 1.9) * 4;
            }
            if (r.bombAt >= 0 && s.elapsed >= r.bombAt && !s.bombed.has(r.id)) {
              s.bombed.add(r.id);
              v *= 0.62;
            }
            s.scores.set(r.id, Math.max(0, Math.round(v)));
          }
          setScores(new Map(s.scores));
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const clock = useRef((): RoundClockSample => ({ leftMs: Math.max(0, DURATION - sim.current.elapsed), frozen: flags.current.frozen }));
  const now = useRef((): number => Date.now());

  const showResults = (kind: WinnerKind, leadMs: number = WINNER_REVEAL_MS): void => {
    stopTrack();
    const raws = new Map(sim.current.scores);
    // a race that never ran still needs scores to rank
    const rng = createRng(SEED).fork('raws');
    for (const p of players) if ((raws.get(p.id) ?? 0) === 0) raws.set(p.id, rng.int(40, 900));
    setResults(buildResults(players, raws, kind, Date.now() + leadMs, gameId));
    setRunId((v) => v + 1);
    setActive(true);
    setScene('results');
  };

  const afterPlayers = useMemo((): PlayerPublic[] => {
    if (!results) return players;
    const totals = new Map(results.rows.map((r) => [r.playerId, r.total]));
    return withRanks(players.map((p) => ({ ...p, total: totals.get(p.id) ?? p.total })));
  }, [players, results]);

  const force = (type: MomentType): void => {
    const s = sim.current;
    const ranked = [...s.scores].sort((a, b) => b[1] - a[1]);
    const nameOf = (id: string | undefined): { id: string; name: string } | null => {
      const p = players.find((x) => x.id === id);
      return p ? { id: p.id, name: p.name } : null;
    };
    const first = ranked[0];
    const second = ranked[1];
    const third = ranked[2] ?? second;
    const last = ranked[ranked.length - 1];
    const mid = ranked[Math.min(ranked.length - 1, 3)];
    switch (type) {
      case 'lead':
        if (first && second) {
          s.scores.set(second[0], Math.round(first[1] * 1.12) + 15);
          setScores(new Map(s.scores));
          injectMoment(makeMoment('lead', nameOf(second[0]), nameOf(first[0])));
        }
        break;
      case 'overtake':
        if (second && third && second !== third) {
          s.scores.set(third[0], second[1] + 9);
          setScores(new Map(s.scores));
          injectMoment(makeMoment('overtake', nameOf(third[0]), nameOf(second[0])));
        }
        break;
      case 'drop':
        if (first) {
          const victim = second ?? first;
          s.scores.set(victim[0], Math.round(victim[1] * 0.45));
          setScores(new Map(s.scores));
          injectMoment(makeMoment('drop', nameOf(victim[0])));
        }
        break;
      case 'jump':
      case 'streak':
        if (mid) {
          s.scores.set(mid[0], Math.round(mid[1] * 1.3) + 20);
          setScores(new Map(s.scores));
          injectMoment(makeMoment(type, nameOf(mid[0])));
        }
        break;
      case 'tie':
        if (first && second) {
          s.scores.set(second[0], first[1]);
          setScores(new Map(s.scores));
          injectMoment(makeMoment('tie', nameOf(first[0]), nameOf(second[0])));
        }
        break;
      case 'photo':
        injectMoment(makeMoment('photo', nameOf(first?.[0]), nameOf(second?.[0])));
        break;
      case 'comeback':
        if (last && third) {
          s.scores.set(last[0], third[1] + 11);
          setScores(new Map(s.scores));
          injectMoment(makeMoment('comeback', nameOf(last[0])));
        }
        break;
      case 'last':
      case 'zero':
        injectMoment(makeMoment(type, nameOf(last?.[0])));
        break;
      case 'final10':
        injectMoment(makeMoment('final10'));
        break;
      default: {
        const _exhaustive: never = type;
        throw new Error(`Unhandled moment: ${String(_exhaustive)}`);
      }
    }
  };

  const hooks: ShowHooks = {
    scene: (name) => {
      if (name === 'results' && !results) showResults('one');
      else {
        if (name !== 'results') stopTrack();
        setRunId((v) => v + 1);
        setActive(true);
        setScene(name);
      }
    },
    players: (n) => setCount(Math.min(60, Math.max(1, Math.round(n)))),
    game: setGameId,
    simulate: setRunning,
    restart: resetRace,
    seek: (ms) => {
      sim.current.elapsed = Math.min(DURATION, Math.max(0, ms));
    },
    force,
    results: showResults,
    final: () => hooks.scene('final'),
    freeze: setFrozen,
    active: setActive,
    calm: (on) => {
      setShowCalm(on);
      setCalm(on);
    },
    mute: (on) => {
      setMuted(on);
      setMutedState(on);
    },
    state: () => {
      const top = [...sim.current.scores].sort((a, b) => b[1] - a[1])[0];
      return {
        scene,
        players: count,
        elapsedMs: sim.current.elapsed,
        leftMs: Math.max(0, DURATION - sim.current.elapsed),
        frozen,
        calm,
        leader: top && top[1] > 0 ? (players.find((p) => p.id === top[0])?.name ?? null) : null,
      };
    },
  };
  window.__show = hooks;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'f' || e.key === 'F' || e.key === 'ב') setBare((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const game = GAMES[gameId];
  let stage: JSX.Element;
  if (scene === 'playing') {
    stage = <PlayingScene key={`play-${runId}`} game={game} roundIndex={2} players={players} scores={scores} clock={clock.current} durationMs={DURATION} />;
  } else if (scene === 'results' && results) {
    stage = <ResultsScene key={`res-${runId}`} game={game} results={results} now={now.current} active={active} />;
  } else if (scene === 'final') {
    stage = <FinalScene key={`fin-${runId}`} players={afterPlayers} results={results} active={active} />;
  } else {
    stage = (
      <div class="dm-lobby">
        <div class="dm-lobby-note">כך הפאנל נראה בלובי, בין הסיבובים</div>
        <div class="dm-lobby-panel">
          <StandingsPanel players={afterPlayers} results={results} />
        </div>
      </div>
    );
  }

  const sceneLabel: Readonly<Record<SceneName, string>> = { playing: 'מרוץ חי', results: 'תוצאות', final: 'פודיום', standings: 'טבלה בלובי' };
  const momentLabel: Readonly<Record<MomentType, string>> = {
    lead: 'מוביל חדש',
    overtake: 'עקיפה',
    jump: 'קפיצה גדולה',
    drop: 'נפילה (פצצה)',
    tie: 'תיקו בצמרת',
    last: 'מקום אחרון',
    comeback: 'קאמבק',
    zero: 'עדיין על אפס',
    final10: '10 שניות',
    photo: 'פוטו פיניש',
    streak: 'על אש',
  };

  return (
    <div class={`dm ${bare ? 'dm--bare' : ''}`} dir="rtl" onPointerDown={unlockAudio}>
      <div class="dm-stage">
        <div class="dm-screen">{stage}</div>
      </div>
      {bare ? null : (
        <aside class="dm-panel kit-scroll">
          <h1>חדר בקרה · המופע</h1>
          <section>
            <h2>סצנה</h2>
            <div class="dm-grid">
              {SCENES.map((s) => (
                <button class={scene === s ? 'is-on' : ''} key={s} onClick={() => hooks.scene(s)}>
                  {sceneLabel[s]}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2>
              שחקנים: <b>{count}</b>
            </h2>
            <input type="range" min={1} max={60} value={count} onInput={(e) => hooks.players(Number(e.currentTarget.value))} />
            <div class="dm-grid dm-grid--5">
              {GAME_IDS.map((g) => (
                <button class={gameId === g ? 'is-on' : ''} key={g} onClick={() => setGameId(g)} title={GAMES[g].title}>
                  {GAMES[g].emoji}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2>מרוץ</h2>
            <div class="dm-grid">
              <button class={running ? 'is-on' : ''} onClick={() => setRunning(!running)}>
                {running ? '⏸ עצור סימולציה' : '▶ סימולציית מרוץ'}
              </button>
              <button onClick={resetRace}>↺ מהתחלה</button>
              <button class={frozen ? 'is-on' : ''} onClick={() => setFrozen(!frozen)}>
                ❄️ הקפאה (קאטסין)
              </button>
              <button onClick={() => hooks.seek(DURATION - 13_000)}>⏩ ל־13 שניות אחרונות</button>
            </div>
          </section>
          <section>
            <h2>רגעים (בסצנת המרוץ)</h2>
            <div class="dm-grid">
              {MOMENT_TYPES.map((m) => (
                <button key={m} disabled={scene !== 'playing'} onClick={() => force(m)}>
                  {momentLabel[m]}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2>טקס הזוכה</h2>
            <div class="dm-grid">
              <button onClick={() => showResults('one', 1_500)}>🏆 זוכה אחד</button>
              <button onClick={() => showResults('tie', 1_500)}>⏱ אותו ניקוד, הקודם זוכה</button>
              <button onClick={() => showResults('none', 1_500)}>😇 אף אחד</button>
              <button onClick={() => showResults('one')}>🥁 תוצאות מלאות (8 שנ׳)</button>
              <button class={active ? '' : 'is-on'} onClick={() => setActive(!active)}>
                🎬 קאטסין מכסה
              </button>
              <button onClick={() => hooks.scene('final')}>🎉 פודיום מחדש</button>
            </div>
          </section>
          <section>
            <h2>כללי</h2>
            <div class="dm-grid">
              <button class={calm ? 'is-on' : ''} onClick={() => hooks.calm(!calm)}>
                🧘 מצב רגוע
              </button>
              <button class={muted ? 'is-on' : ''} onClick={() => hooks.mute(!muted)}>
                {muted ? '🔇 מושתק' : '🔊 סאונד'}
              </button>
              <button onClick={() => setBare(true)}>⛶ מסך מלא (F)</button>
            </div>
            <p class="dm-hint">תמונות: client/public/assets/host · שירים: client/public/audio/victory.mp3, final.mp3</p>
          </section>
        </aside>
      )}
    </div>
  );
}

initMobileViewport();
const root = document.getElementById('app');
if (root) render(<Demo />, root);
