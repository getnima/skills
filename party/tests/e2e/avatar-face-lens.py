"""Make the lenses of a cut-out pair of glasses see-through (avatar-face).

python3 -I tests/e2e/avatar-face-lens.py <cut.png> <out.png> --seeds "0.25,0.7;0.75,0.7" [--dark 110] [--glass 36] [--check tile.png]

<cut.png> is the output of avatar-face-cut.py (RGBA, cropped). Each seed (fractions of width / height)
is a point inside a lens. From it the lens is flood-filled over everything that is not dark frame
(--dark: max channel below it = frame; or --chroma: colourful pixels = frame), then made convex column-wise and row-wise (so a temple arm
seen through the glass is swallowed too), grown by 2 px into the frame's soft inner edge, and
replaced by a faint white glass (--glass = alpha 0..255; 0 = an empty hole).
"""
import argparse

import numpy as np
from PIL import Image, ImageDraw


def shift(m, dy, dx):
    out = np.zeros_like(m)
    h, w = m.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = m[ys, xs]
    return out


def fill_cols_rows(m):
    out = m.copy()
    for x in range(m.shape[1]):
        ys = np.nonzero(out[:, x])[0]
        if ys.size:
            out[ys[0]:ys[-1] + 1, x] = True
    for y in range(m.shape[0]):
        xs = np.nonzero(out[y])[0]
        if xs.size:
            out[y, xs[0]:xs[-1] + 1] = True
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--seeds', required=True)
    ap.add_argument('--dark', type=int, default=110)
    ap.add_argument('--chroma', type=int, default=0, help='frame = colourful pixels (max-min channel above this) instead of dark ones (a gold rim)')
    ap.add_argument('--glass', type=int, default=36)
    ap.add_argument('--grow', type=int, default=2)
    ap.add_argument('--pale', type=int, default=0, help='frame = pale grey pixels (max-min channel up to this): white cardboard')
    ap.add_argument('--tint', type=int, default=0, help='keep the lens colour at this alpha instead of white glass (tinted lenses)')
    ap.add_argument('--open', type=int, default=0, help='open the frame mask by N px first: thin parts seen through the lens (hinges) leave the frame')
    ap.add_argument('--no-convex', action='store_true', help='keep the flooded lens shape (a star) instead of filling it column / row wise')
    ap.add_argument('--check', default='')
    a = ap.parse_args()

    pic = Image.open(a.src).convert('RGBA')
    arr = np.asarray(pic).astype(np.int16)
    h, w, _ = arr.shape
    if a.pale > 0:
        frame = (arr[:, :, 3] > 128) & ((arr[:, :, :3].max(axis=2) - arr[:, :, :3].min(axis=2)) <= a.pale)
    elif a.chroma > 0:
        frame = (arr[:, :, 3] > 128) & ((arr[:, :, :3].max(axis=2) - arr[:, :, :3].min(axis=2)) > a.chroma)
    else:
        frame = (arr[:, :, 3] > 128) & (arr[:, :, :3].max(axis=2) < a.dark)
    if a.open > 0:
        f = frame
        for _ in range(a.open):
            f = f & shift(f, 1, 0) & shift(f, -1, 0) & shift(f, 0, 1) & shift(f, 0, -1)
        for _ in range(a.open):
            f = f | shift(f, 1, 0) | shift(f, -1, 0) | shift(f, 0, 1) | shift(f, 0, -1)
        frame = f & frame
    lens_all = np.zeros((h, w), bool)
    for s in a.seeds.split(';'):
        fx, fy = (float(v) for v in s.split(','))
        sx, sy = int(fx * w), int(fy * h)
        if frame[sy, sx]:
            raise SystemExit(f'seed {s} is on the frame')
        m = Image.fromarray(np.where(frame, 0, 255).astype(np.uint8)).copy()
        ImageDraw.floodfill(m, (sx, sy), 128)
        comp = np.asarray(m) == 128
        if comp[0, :].any() or comp[-1, :].any() or comp[:, 0].any() or comp[:, -1].any():
            raise SystemExit(f'seed {s} leaks to the border: the lens is not closed')
        lens = comp if a.no_convex else fill_cols_rows(comp)
        for _ in range(a.grow):
            lens = lens | shift(lens, 1, 0) | shift(lens, -1, 0) | shift(lens, 0, 1) | shift(lens, 0, -1)
        lens_all |= lens
    out = arr.copy()
    if a.tint > 0:
        out[lens_all, 3] = np.minimum(out[lens_all, 3], a.tint)
    else:
        out[lens_all, 0:3] = 255
        out[lens_all, 3] = a.glass
    res = Image.fromarray(out.astype(np.uint8), 'RGBA')
    res.save(a.dst, optimize=True)
    if a.check:
        chk = Image.new('RGB', (w * 2 + 30, h + 20), (24, 24, 32))
        chk.paste((255, 210, 31), (w + 15, 0, w * 2 + 30, h + 20))
        chk.paste(res, (8, 10), res)
        chk.paste(res, (w + 22, 10), res)
        chk.save(a.check)
    print(a.dst, f'{w}x{h}', 'lens px', int(lens_all.sum()))


if __name__ == '__main__':
    main()
