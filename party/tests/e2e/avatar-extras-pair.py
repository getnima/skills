"""Re-space the parts of a cut-out picture onto the doll (avatar-extras): earrings onto the ear lobes, a one-sided
thing at one ear padded to the width of the head so its box stays centred on the doll.

python3 -I tests/e2e/avatar-extras-pair.py <cut.png> <out.png> --centers 17,85 --width 14 --span 10,92 [--parts 2] [--max 640]

<cut.png>: an RGBA cut (avatar-extras-cut.py). Its --parts largest connected pieces (left to right) are each put
with their centre at the matching --centers x (in % of the doll box width), scaled so the first piece is --width %
wide, tops aligned as in the source. The canvas spans --span L,R (% of the doll width), transparent elsewhere.
Prints the place to use: left = L, width = R - L, and the height % (from the picture's shape).
"""
import argparse

import numpy as np
from PIL import Image, ImageDraw


def components(alpha, n):
    """The n largest 4-connected pieces of the alpha mask, left to right, as (pixels, x0, y0, x1, y1)."""
    work = Image.fromarray(np.where(alpha > 40, 255, 0).astype(np.uint8))
    seen = np.zeros(alpha.shape, bool)
    comps = []
    ys, xs = np.nonzero(alpha > 40)
    for y, x in zip(ys[::7], xs[::7]):
        if seen[y, x]:
            continue
        ImageDraw.floodfill(work, (int(x), int(y)), 0)
        comp = (np.asarray(work) == 0) & ~seen
        seen |= comp
        cy, cx = np.nonzero(comp)
        if cy.size:
            comps.append((int(comp.sum()), int(cx.min()), int(cy.min()), int(cx.max()) + 1, int(cy.max()) + 1))
    comps.sort(reverse=True)
    return sorted(comps[:n], key=lambda c: c[1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--centers', required=True)
    ap.add_argument('--width', type=float, required=True)
    ap.add_argument('--span', required=True)
    ap.add_argument('--parts', type=int, default=2)
    ap.add_argument('--max', type=int, default=640)
    a = ap.parse_args()
    pic = Image.open(a.src).convert('RGBA')
    alpha = np.asarray(pic)[:, :, 3]
    parts = components(alpha, a.parts)
    centers = [float(v) for v in a.centers.split(',')]
    L, R = (float(v) for v in a.span.split(','))
    s = a.width / (parts[0][3] - parts[0][1])  # doll % per source px
    top = min(p[2] for p in parts)
    bottom = max(p[4] for p in parts)
    cw = round((R - L) / s)
    ch = bottom - top
    canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    for (n, x0, y0, x1, y1), c in zip(parts, centers):
        piece = pic.crop((x0, y0, x1, y1))
        # keep only this piece's pixels (a neighbour's edge may reach into the box)
        canvas.alpha_composite(piece, (round((c - L) / s - (x1 - x0) / 2), y0 - top))
    if max(canvas.size) > a.max:
        k = a.max / max(canvas.size)
        canvas = canvas.resize((round(canvas.size[0] * k), round(canvas.size[1] * k)), Image.LANCZOS)
    canvas.save(a.dst, optimize=True)
    W, H = canvas.size
    print(f'{a.dst} {W}x{H} place left={L} width={R - L} height={(R - L) * H / W * 483 / 1200:.2f} (pieces: {[(p[0], p[1], p[3]) for p in parts]})')


if __name__ == '__main__':
    main()
