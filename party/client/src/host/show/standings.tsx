/** StandingsPanel: the cumulative leaderboard in the lobby between rounds, as player cards (cards.tsx). */
import { useMemo } from 'preact/hooks';

import { cardGrid } from './card-grid';
import { PlayerCard, useBoardBox } from './cards';
import { CountUp, useStage, useTicker } from './common';

import type { JSX } from 'preact';
import type { StandingsPanelProps } from './types';

/** The lobby's table turns its page this often. */
const PANEL_PAGE_MS = 6_000;

export function StandingsPanel(props: StandingsPanelProps): JSX.Element {
  const { ref, size } = useStage([640, 760], [640, 760]);
  const rows = useMemo(() => {
    // The server's strict rank (1..n, never shared): no rank is derived from totals here.
    const sorted = [...props.players].sort((a, b) => a.rank - b.rank);
    const hints = new Map((props.results?.rows ?? []).map((r) => [r.playerId, r]));
    return sorted.map((player) => {
      const res = hints.get(player.id);
      const delta = res && res.prevRank !== null ? res.prevRank - res.rank : null;
      return { player, rank: player.rank, delta, isNew: res !== undefined && res.prevRank === null };
    });
  }, [props.players, props.results]);
  const anyPoints = rows.some((r) => r.player.total > 0);

  // the cards: big enough to read across the room (the panel is a third of the TV), and the
  // table pages through everybody, six at a time, while the lobby waits for the next game
  const box = useBoardBox();
  const u = size.u;
  const grid = cardGrid(rows.length, box.w, box.h, { aspect: 1.36, gap: 22 * u, maxW: 260 * u, minW: 165 * u });
  const per = Math.max(1, grid.perPage);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  useTicker(pages > 1 ? 500 : 60_000);
  const page = pages > 1 ? Math.floor(Date.now() / PANEL_PAGE_MS) % pages : 0;
  const offset = Math.min(page * per, Math.max(0, rows.length - per));
  const shown = rows.slice(offset, offset + per);
  const newRound = props.results !== null && props.results.roundIndex > 0;

  return (
    <section class="sh-scene sh-panel" dir="rtl" ref={ref}>
      <header class="sh-panel-head">
        <span>🏆 טבלת הניקוד</span>
        <span class="sh-panel-count">{pages > 1 ? `${offset + 1}–${offset + shown.length} מתוך ${rows.length}` : `${rows.length} שחקנים`}</span>
      </header>
      {rows.length === 0 ? (
        <div class="sh-panel-empty">עוד אין שחקנים. סרקו את הקוד והצטרפו!</div>
      ) : (
        <div class="sh-panel-cards" ref={box.ref} key={page}>
            {box.w > 0
              ? shown.map((r, i) => {
                  const at = grid.slot(i);
                  const move =
                    r.delta !== null && r.delta !== 0
                      ? { text: r.delta > 0 ? `▲${r.delta}` : `▼${-r.delta}`, kind: r.delta > 0 ? ('up' as const) : ('down' as const) }
                      : r.isNew && newRound
                        ? { text: 'חדש', kind: 'new' as const }
                        : null;
                  return (
                    <PlayerCard
                      key={r.player.id}
                      name={r.player.name}
                      avatar={r.player.avatar}
                      look={r.player.look}
                      rank={anyPoints ? r.rank : null}
                      cw={grid.cw}
                      u={u}
                      x={at.x}
                      y={at.y}
                      class={`${anyPoints && r.rank === 1 ? 'is-first' : ''} ${r.player.connected ? '' : 'is-away'}`}
                      move={move}
                      testId="panel-card"
                    >
                      <CountUp value={r.player.total} ms={1_000} />
                    </PlayerCard>
                  );
                })
              : null}
        </div>
      )}
    </section>
  );
}
