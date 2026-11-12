"""Tighten the icy key art: the climber and the two ledges are separate cut-outs, so the ledges can come closer.

python3 -I tests/e2e/intro-art-icy-compose.py <icy_cut.png> <out.png> [--scale 0.8] [--left x,y] [--right x,y]

The generated picture leaves a lot of air between the climber and the two snowy ledges, which makes the
climber small once the picture is fitted into a box. The pieces are found as connected shapes (a ledge and
its icicles are one piece: everything whose centre lies in the ledge's corner of the picture). The two
ledges are scaled by --scale and placed with their top-left corner at --left / --right (source pixels);
the climber is not touched and is drawn last.
"""
import argparse

import numpy as np
from PIL import Image


def shift(m, dy, dx):
    out = np.zeros_like(m)
    h, w = m.shape[:2]
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = m[ys, xs]
    return out


def dilate(m):
    return m | shift(m, 1, 0) | shift(m, -1, 0) | shift(m, 0, 1) | shift(m, 0, -1)


def reconstruct(seed, mask):
    cur = seed & mask
    while True:
        nxt = cur
        for _ in range(24):
            nxt = dilate(nxt) & mask
        if (nxt == cur).all():
            return cur
        cur = nxt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--scale', type=float, default=0.8)
    ap.add_argument('--left', default='190,754', help='top-left corner of the lower-left ledge after the move')
    ap.add_argument('--right', default='634,500', help='top-left corner of the upper-right ledge after the move')
    a = ap.parse_args()

    src = Image.open(a.src).convert('RGBA')
    w, h = src.size
    arr = np.asarray(src)
    solid = arr[:, :, 3] > 8
    left = np.zeros_like(solid)
    right = np.zeros_like(solid)
    hero = np.zeros_like(solid)
    rest = solid.copy()
    while rest.any():
        ys, xs = np.nonzero(rest)
        seed = np.zeros_like(rest)
        seed[ys[0], xs[0]] = True
        comp = reconstruct(seed, rest)
        rest &= ~comp
        cy, cx = (v.mean() for v in np.nonzero(comp))
        if cx < w * 0.47 and cy > h * 0.72:
            left |= comp
        elif cx > w * 0.66 and cy > h * 0.46 and cy < h * 0.72:
            right |= comp
        else:
            hero |= comp

    def layer(mask):
        out = arr.copy()
        out[~dilate(mask)] = 0  # keep the soft rim of the piece
        lay = Image.fromarray(out, 'RGBA')
        return lay.crop(lay.getchannel('A').getbbox()), lay.getchannel('A').getbbox()

    pad = 200
    canvas = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    for mask, pos in ((left, a.left), (right, a.right)):
        lay, box = layer(mask)
        size = (round(lay.size[0] * a.scale), round(lay.size[1] * a.scale))
        lay = lay.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')
        x, y = (int(v) for v in pos.split(','))
        canvas.alpha_composite(lay, (pad + x, pad + y))
        print('ledge', box, '->', (x, y, x + size[0], y + size[1]))
    lay, box = layer(hero)
    canvas.alpha_composite(lay, (pad + box[0], pad + box[1]))
    print('hero', box)
    bbox = canvas.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    canvas.crop(bbox).save(a.dst)
    print(f'{a.dst} {bbox[2] - bbox[0]}x{bbox[3] - bbox[1]}')


if __name__ == '__main__':
    main()
