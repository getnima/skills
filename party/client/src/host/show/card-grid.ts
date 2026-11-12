/**
 * Where the player cards go on a board (the TV's leaderboards: the standings after a round, the
 * lobby's table, the final table, the live race). Pure: a box and a head count in, the size of
 * a card and the place of every slot out.
 *
 * The cards are as big as the box allows for everybody at once; when that would make them
 * smaller than `minW`, the board pages: as many cards per page as fit at `minW` or more. Slots
 * read like the room reads Hebrew: the first place top right, then leftwards, then the next row.
 * A short last row stays on the right. The grid is centred in the box.
 */
export interface CardGridOptions {
  /** A card's height over its width. */
  readonly aspect: number;
  /** Between two cards, both ways (px). */
  readonly gap: number;
  /** The widest a card may grow (px): a room of three does not get three posters. */
  readonly maxW: number;
  /** Narrower than this and the board pages instead (px). */
  readonly minW: number;
  /** At most this many columns (a narrow panel may want fewer). */
  readonly maxCols?: number;
}

export interface CardGrid {
  readonly cols: number;
  readonly rows: number;
  /** Card width and height (px). */
  readonly cw: number;
  readonly ch: number;
  /** Cards on one page (every card when the board does not page). */
  readonly perPage: number;
  /** The top-left corner of slot `i` on a page, in px from the box's top-left corner. */
  slot(i: number): { readonly x: number; readonly y: number };
}

interface Fit {
  readonly cols: number;
  readonly rows: number;
  readonly cw: number;
}

/** The biggest card that lets `count` cards fit the box (and its columns and rows). */
function bestFit(count: number, boxW: number, boxH: number, o: CardGridOptions): Fit {
  const most = Math.max(1, Math.min(count, o.maxCols ?? count));
  let best: Fit = { cols: 1, rows: Math.max(1, count), cw: 0 };
  for (let cols = 1; cols <= most; cols++) {
    const rows = Math.ceil(count / cols);
    const byW = (boxW - o.gap * (cols - 1)) / cols;
    const byH = (boxH - o.gap * (rows - 1)) / rows / o.aspect;
    const cw = Math.min(byW, byH, o.maxW);
    // at the same card size: the fewest empty slots (6 = 3+3, not 4+2), then more columns (less like a list)
    const empty = cols * rows - count;
    const bestEmpty = best.cols * best.rows - count;
    const same = Math.abs(cw - best.cw) <= 0.5;
    if (cw > best.cw + 0.5 || (same && empty < bestEmpty) || (same && empty === bestEmpty && cols > best.cols)) best = { cols, rows, cw };
  }
  return best;
}

export function cardGrid(count: number, boxW: number, boxH: number, o: CardGridOptions): CardGrid {
  const n = Math.max(1, Math.floor(count));
  let fit = bestFit(n, boxW, boxH, o);
  let perPage = n;
  if (fit.cw < o.minW && n > 1) {
    // too many for one page: as many per page as fit at the smallest size allowed
    const cols = Math.max(1, Math.min(o.maxCols ?? n, Math.floor((boxW + o.gap) / (o.minW + o.gap))));
    const rows = Math.max(1, Math.floor((boxH + o.gap) / (o.minW * o.aspect + o.gap)));
    perPage = Math.max(1, Math.min(n, cols * rows));
    fit = bestFit(perPage, boxW, boxH, o);
  }
  const cw = Math.max(1, fit.cw);
  const ch = cw * o.aspect;
  const cols = fit.cols;
  const rows = Math.ceil(perPage / cols);
  const gridW = cols * cw + (cols - 1) * o.gap;
  const gridH = rows * ch + (rows - 1) * o.gap;
  const left = (boxW - gridW) / 2;
  const top = Math.max(0, (boxH - gridH) / 2);
  return {
    cols,
    rows,
    cw,
    ch,
    perPage,
    slot(i: number) {
      const k = Math.max(0, Math.floor(i));
      const col = k % cols;
      const row = Math.floor(k / cols);
      // right to left: slot 0 is the rightmost of the top row
      return { x: left + (cols - 1 - col) * (cw + o.gap), y: top + row * (ch + o.gap) };
    },
  };
}
