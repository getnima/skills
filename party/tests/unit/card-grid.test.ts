// The TV leaderboards' card grid: big cards when they fit, pages when they do not, read right to left.
import { describe, expect, it } from 'vitest';

import { cardGrid } from '../../client/src/host/show/card-grid';
import { nameDir } from '../../client/src/host/show/cards';

const O = { aspect: 1.36, gap: 34, maxW: 330, minW: 172 };

function inside(g: ReturnType<typeof cardGrid>, w: number, h: number): boolean {
  for (let i = 0; i < g.perPage; i++) {
    const s = g.slot(i);
    if (s.x < -0.5 || s.y < -0.5 || s.x + g.cw > w + 0.5 || s.y + g.ch > h + 0.5) return false;
  }
  return true;
}

function overlaps(g: ReturnType<typeof cardGrid>): boolean {
  for (let i = 0; i < g.perPage; i++) {
    for (let j = i + 1; j < g.perPage; j++) {
      const a = g.slot(i);
      const b = g.slot(j);
      if (Math.abs(a.x - b.x) < g.cw - 0.5 && Math.abs(a.y - b.y) < g.ch - 0.5) return true;
    }
  }
  return false;
}

describe('the card grid', () => {
  it('fits every head count from 1 to 60 inside the box, with no card on another', () => {
    for (const [w, h] of [
      [1340, 860],
      [600, 640],
      [700, 640],
    ] as const) {
      for (let n = 1; n <= 60; n++) {
        const g = cardGrid(n, w, h, O);
        expect(g.perPage).toBeGreaterThan(0);
        expect(g.perPage).toBeLessThanOrEqual(n);
        expect(inside(g, w, h), `${n} in ${w}x${h}`).toBe(true);
        expect(overlaps(g), `${n} in ${w}x${h}`).toBe(false);
        expect(g.cw).toBeLessThanOrEqual(O.maxW + 0.01);
      }
    }
  });

  it('keeps everybody on one page while the cards stay big enough, then pages', () => {
    expect(cardGrid(12, 1340, 860, O).perPage).toBe(12);
    const big = cardGrid(40, 1340, 860, O);
    expect(big.perPage).toBeLessThan(40);
    expect(big.cw).toBeGreaterThanOrEqual(O.minW - 0.01);
  });

  it('reads right to left: the first place top right, then leftwards, then the next row', () => {
    const g = cardGrid(12, 1340, 860, O);
    const first = g.slot(0);
    const second = g.slot(1);
    expect(second.x).toBeLessThan(first.x);
    expect(second.y).toBe(first.y);
    const nextRow = g.slot(g.cols);
    expect(nextRow.y).toBeGreaterThan(first.y);
    expect(nextRow.x).toBe(first.x);
  });

  it('prefers a full grid at the same card size (6 = 3+3, not 4+2), and rows over a column', () => {
    const six = cardGrid(6, 1340, 860, O);
    expect(six.cols * six.rows).toBe(6);
    const twelve = cardGrid(12, 1340, 860, O);
    expect(twelve.cols).toBeGreaterThan(twelve.rows);
  });

  it('lets a few guests have big cards, but no posters', () => {
    expect(cardGrid(3, 1340, 860, O).cw).toBe(O.maxW);
  });
});

describe('a name on a card', () => {
  it('reads in its own direction, so a long name is cut at its end', () => {
    expect(nameDir('מקסימיליאן כהן')).toBe('rtl');
    expect(nameDir('Jonathan')).toBe('ltr');
    expect(nameDir('123 דנה')).toBe('rtl');
    expect(nameDir('😀 Dana')).toBe('ltr');
    expect(nameDir('🙂')).toBe('rtl');
  });
});
