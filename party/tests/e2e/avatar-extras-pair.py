"""Re-space the parts of a cut-out picture onto the doll (avatar-extras): earrings onto the ear lobes, a one-sided
thing at one ear padded to the width of the head so its box stays centred on the doll.

python3 -I tests/e2e/avatar-extras-pair.py <cut.png> <out.png> --centers 17,85 --width 14 --span 10,92 [--parts 2] [--rotate deg] [--max 640]

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
    ap.add_argument('--fade-split', type=int, default=0, help='px: fade the alpha towards the split line (two pieces that touched)')
    ap.add_argument('--mirror-outer', action='store_true', help='rebuild each piece from its mirrored outer half (two round muffs that touched)')
    ap.add_argument('--clear-thin', type=int, default=0, help='px: clear rows from the top while no opaque run in the row is this wide (band stubs above muffs)')
    ap.add_argument('--rotate', type=float, default=0.0, help='degrees counter-clockwise, before placing (a phone tilted from the ear to the mouth)')
    a = ap.parse_args()
    pic = Image.open(a.src).convert('RGBA')
    if a.rotate:
        pic = pic.rotate(a.rotate, resample=Image.BICUBIC, expand=True)
        pic = pic.crop(pic.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    alpha = np.asarray(pic)[:, :, 3]
    parts = components(alpha, a.parts)
    if len(parts) < a.parts and a.parts == 2:
        # the two pieces touch: split at the column with the least alpha in the middle part
        w = alpha.shape[1]
        cols = (alpha > 40).sum(axis=0)
        mid = int(w * 0.35) + int(np.argmin(cols[int(w * 0.35):int(w * 0.65)]))
        left, right = pic.crop((0, 0, mid, pic.size[1])), pic.crop((mid, 0, w, pic.size[1]))
        parts = []
        for off, half in ((0, left), (mid, right)):
            bb = half.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
            parts.append((0, bb[0] + off, bb[1], bb[2] + off, bb[3]))
        print(f'split at column {mid} ({cols[mid]} opaque px there)')
        if a.fade_split > 0:
            arr = np.asarray(pic).copy()
            for i in range(a.fade_split):
                k = (i + 0.5) / a.fade_split
                for x in (mid - 1 - i, mid + i):
                    if 0 <= x < w:
                        arr[:, x, 3] = (arr[:, x, 3] * k).astype(np.uint8)
            pic = Image.fromarray(arr, 'RGBA')
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
        if a.mirror_outer:
            pw, ph = piece.size
            half = pw // 2
            if x0 == parts[0][1]:  # left piece: the outer half is its left half
                outer = piece.crop((0, 0, half, ph))
                piece = Image.new('RGBA', (half * 2, ph), (0, 0, 0, 0))
                piece.paste(outer, (0, 0))
                piece.paste(outer.transpose(Image.FLIP_LEFT_RIGHT), (half, 0))
            else:
                outer = piece.crop((pw - half, 0, pw, ph))
                piece = Image.new('RGBA', (half * 2, ph), (0, 0, 0, 0))
                piece.paste(outer.transpose(Image.FLIP_LEFT_RIGHT), (0, 0))
                piece.paste(outer, (half, 0))
            x1 = x0 + half * 2
        # keep only this piece's pixels (a neighbour's edge may reach into the box)
        canvas.alpha_composite(piece, (round((c - L) / s - (x1 - x0) / 2), y0 - top))
    if a.clear_thin > 0:
        arr = np.asarray(canvas).copy()
        for y in range(arr.shape[0]):
            row = arr[y, :, 3] > 60
            best = run = 0
            for v in row:
                run = run + 1 if v else 0
                best = max(best, run)
            if best >= a.clear_thin:
                break
            arr[y] = 0
        canvas = Image.fromarray(arr, 'RGBA')
        canvas = canvas.crop(canvas.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    if max(canvas.size) > a.max:
        k = a.max / max(canvas.size)
        canvas = canvas.resize((round(canvas.size[0] * k), round(canvas.size[1] * k)), Image.LANCZOS)
    canvas.save(a.dst, optimize=True)
    W, H = canvas.size
    print(f'{a.dst} {W}x{H} place left={L} width={R - L} height={(R - L) * H / W * 483 / 1200:.2f} (pieces: {[(p[0], p[1], p[3]) for p in parts]})')


if __name__ == '__main__':
    main()
