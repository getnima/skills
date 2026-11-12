"""Local background cut for the hat pictures (avatar-hats).

python3 -I tests/e2e/avatar-hats-cut.py <in.png> <out.png> [--tol 22] [--holes 400] [--pad-bottom 0] [--max 640]

The generated picture is one object on a flat background. The background is flood-filled from the
image border over near-background pixels; enclosed background pockets bigger than --holes pixels
(the inside of a ring) are removed too. The mask is eroded by one pixel, the alpha edge feathered
(~1.2 px) and edge colours are pulled towards the interior (no light fringe). Cropped to the alpha
bounding box, resized (LANCZOS) to at most --max px on the long side. With --check <path> also writes
the cut on a dark tile and on a yellow tile, to look at.
"""
import argparse

import numpy as np
from PIL import Image, ImageFilter


def shift(m, dy, dx):
    out = np.zeros_like(m)
    h, w = m.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = m[ys, xs]
    return out


def dilate(m):
    return m | shift(m, 1, 0) | shift(m, -1, 0) | shift(m, 0, 1) | shift(m, 0, -1)


def reconstruct(seed, mask):
    cur = seed & mask
    while True:
        # several steps per check: cheaper
        nxt = cur
        for _ in range(8):
            nxt = dilate(nxt) & mask
        if (nxt == cur).all():
            return cur
        cur = nxt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--tol', type=int, default=22)
    ap.add_argument('--holes', type=int, default=400)
    ap.add_argument('--max', type=int, default=640)
    ap.add_argument('--pad-bottom', type=float, default=0.0, help='transparent space added below, fraction of height')
    ap.add_argument('--pad-top', type=float, default=0.0)
    ap.add_argument('--grey', default='', help='"chroma,minvalue": grey pixels (a soft shadow) count as background too')
    ap.add_argument('--keep-alpha', action='store_true', help='input is already cut (remove_background): use its alpha')
    ap.add_argument('--check', default='', help='where to write the dark / yellow check tile')
    a = ap.parse_args()

    src = Image.open(a.src)
    src_alpha = np.asarray(src.convert('RGBA'))[:, :, 3] if a.keep_alpha else None
    im = src.convert('RGB')
    rgb = np.asarray(im).astype(np.int16)
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    near = (np.abs(rgb - bg) <= a.tol).all(axis=2)
    if a.grey:
        c, v = (int(x) for x in a.grey.split(','))
        near |= ((rgb.max(axis=2) - rgb.min(axis=2)) <= c) & (rgb.min(axis=2) >= v)
    if src_alpha is not None:
        near = src_alpha < 128

    seed = np.zeros_like(near)
    seed[0, :] = seed[-1, :] = seed[:, 0] = seed[:, -1] = True
    back = reconstruct(seed, near)

    # enclosed pockets of background (inside a ring): remove the big ones
    rest = near & ~back
    holes = 0
    while rest.any():
        ys, xs = np.nonzero(rest)
        s = np.zeros_like(rest)
        s[ys[0], xs[0]] = True
        comp = reconstruct(s, rest)
        n = int(comp.sum())
        if n >= a.holes:
            back |= comp
            holes += 1
        rest &= ~comp

    obj = ~back
    # erode by one pixel
    inner = obj & shift(obj, 1, 0) & shift(obj, -1, 0) & shift(obj, 0, 1) & shift(obj, 0, -1)
    alpha = Image.fromarray((inner * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    al = np.asarray(alpha).astype(np.float32)
    al = np.clip((al - 20) * 255 / 215, 0, 255)  # keep the edge crisp, kill faint haze
    core = inner & shift(inner, 2, 0) & shift(inner, -2, 0) & shift(inner, 0, 2) & shift(inner, 0, -2)

    # defringe: edge pixels take the colour of nearby core pixels
    rgbf = rgb.astype(np.float32)
    cw = core.astype(np.float32)
    acc = np.zeros_like(rgbf)
    wsum = np.zeros((h, w), np.float32)
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            m = shift(cw, dy, dx)
            acc += np.stack([shift(rgbf[:, :, c] * cw, dy, dx) for c in range(3)], axis=2)
            wsum += m
    fill = acc / np.maximum(wsum, 1e-3)[:, :, None]
    edge = (al > 0) & ~core & (wsum > 0)
    out = rgbf.copy()
    out[edge] = fill[edge]

    rgba = np.dstack([np.clip(out, 0, 255), al]).astype(np.uint8)
    pic = Image.fromarray(rgba, 'RGBA')
    bbox = pic.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    pic = pic.crop(bbox)
    if a.pad_bottom > 0 or a.pad_top > 0:
        pw, ph = pic.size
        nb, nt = round(ph * a.pad_bottom), round(ph * a.pad_top)
        canvas = Image.new('RGBA', (pw, ph + nb + nt), (0, 0, 0, 0))
        canvas.paste(pic, (0, nt))
        pic = canvas
    if max(pic.size) > a.max:
        k = a.max / max(pic.size)
        pic = pic.resize((max(1, round(pic.size[0] * k)), max(1, round(pic.size[1] * k))), Image.LANCZOS)
    pic.save(a.dst, optimize=True)

    tw, th = pic.size
    chk = Image.new('RGB', (tw * 2 + 30, th + 20), (255, 255, 255))
    chk.paste((24, 24, 32), (0, 0, tw + 15, th + 20))
    chk.paste((255, 210, 31), (tw + 15, 0, tw * 2 + 30, th + 20))
    chk.paste(pic, (8, 10), pic)
    chk.paste(pic, (tw + 22, 10), pic)
    if a.check:
        chk.save(a.check)
    print(f'{a.dst} {pic.size[0]}x{pic.size[1]} bg={bg.tolist()} holes_removed={holes}')


if __name__ == '__main__':
    main()
