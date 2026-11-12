/** StandingsPanel: the compact cumulative leaderboard in the lobby between rounds. */
import { useMemo } from 'preact/hooks';

import { Avatar, CountUp, sharedRanks, useStage } from './common';

import type { JSX } from 'preact';
import type { StandingsPanelProps } from './types';

const TOP = 8;

export function StandingsPanel(props: StandingsPanelProps): JSX.Element {
  const { ref } = useStage([640, 760], [640, 760]);
  const rows = useMemo(() => {
    const sorted = [...props.players].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'he'));
    const ranks = sharedRanks(sorted.map((p) => p.total));
    const hints = new Map((props.results?.rows ?? []).map((r) => [r.playerId, r]));
    return sorted.map((player, i) => {
      const res = hints.get(player.id);
      const delta = res && res.prevRank !== null ? res.prevRank - res.rank : null;
      return { player, rank: ranks[i] ?? i + 1, delta, isNew: res !== undefined && res.prevRank === null, points: res?.points ?? null };
    });
  }, [props.players, props.results]);
  const top = rows.slice(0, TOP);
  const more = rows.length - top.length;
  const anyPoints = rows.some((r) => r.player.total > 0);

  return (
    <section class="sh-scene sh-panel" dir="rtl" ref={ref}>
      <header class="sh-panel-head">
        <span>🏆 טבלת הניקוד</span>
        <span class="sh-panel-count">{rows.length} שחקנים</span>
      </header>
      {rows.length === 0 ? (
        <div class="sh-panel-empty">עוד אין שחקנים. סרקו את הקוד והצטרפו!</div>
      ) : (
        <div class="sh-panel-rows">
          {top.map((r) => (
            <div class={`sh-prow ${anyPoints && r.rank === 1 ? 'is-first' : ''} ${r.player.connected ? '' : 'is-away'}`} key={r.player.id}>
              <span class="sh-rank">{anyPoints ? r.rank : '·'}</span>
              <Avatar avatar={r.player.avatar} name={r.player.name} />
              <span class="sh-name" dir="auto">
                <bdi>{r.player.name}</bdi>
              </span>
              {r.delta !== null && r.delta !== 0 ? (
                <span class={`sh-move ${r.delta > 0 ? 'is-up' : 'is-down'}`} dir="ltr">
                  {r.delta > 0 ? `▲${r.delta}` : `▼${-r.delta}`}
                </span>
              ) : r.isNew && props.results !== null && props.results.roundIndex > 0 ? (
                <span class="sh-move is-up">חדש</span>
              ) : null}
              <CountUp class="sh-total" value={r.player.total} ms={1_000} />
            </div>
          ))}
          {more > 0 ? <div class="sh-panel-more">+{more} נוספים</div> : null}
        </div>
      )}
    </section>
  );
}
