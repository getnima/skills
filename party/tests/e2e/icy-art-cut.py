"""Local background cut for the generated icy pictures (one toy on a plain studio backdrop).

python3 -I tests/e2e/icy-art-cut.py <in.png> <out.png> [--tol 26] [--shadow 0.45] [--holes 300]
        [--box x0,y0,x1,y1] [--max 512] [--check tile.png]

The backdrop is not perfectly flat (studio light falls off towards the corners), so the background is
modelled as a smooth surface: a quadratic fitted per channel to the outer frame of the picture. A pixel is
background when it is within --tol of that surface, or (with --shadow) when it is the backdrop's own colour
only darker (a soft cast shadow: all three channels dimmed by about the same factor, down to 1 - shadow).
Background is whatever such pixels connect to the picture border; enclosed pockets bigger than --holes
pixels go too. The mask is eroded by one pixel, feathered, and edge colours are pulled from the interior
(no backdrop fringe). --box keeps only that part of the source (to drop a shadow under the object).
With --keep-alpha the input is already cut (remove_background) and only the trim / resize / check run.
"""
import argparse

import numpy as np
from PIL import Image, ImageFilter


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
        for _ in range(16):
            nxt = dilate(nxt) & mask
        if (nxt == cur).all():
            return cur
        cur = nxt


def fit_backdrop(rgb, frame):
    """Quadratic surface per channel through the outer frame (fraction `frame` of each side)."""
    h, w, _ = rgb.shape
    yy, xx = np.mgrid[0:h, 0:w]
    u = xx / (w - 1) * 2 - 1
    v = yy / (h - 1) * 2 - 1
    fw = max(2, round(w * frame))
    fh = max(2, round(h * frame))
    edge = np.zeros((h, w), bool)
    edge[:fh] = edge[-fh:] = True
    edge[:, :fw] = edge[:, -fw:] = True
    basis = np.stack([np.ones_like(u), u, v, u * u, v * v, u * v], axis=-1)
    a = basis[edge]
    model = np.zeros_like(rgb, dtype=np.float32)
    for c in range(3):
        y = rgb[:, :, c][edge].astype(np.float32)
        # two rounds: drop the frame pixels that are not backdrop (an object touching the frame)
        coef, *_ = np.linalg.lstsq(a, y, rcond=None)
        res = np.abs(a @ coef - y)
        keep = res <= max(6.0, np.percentile(res, 80))
        coef, *_ = np.linalg.lstsq(a[keep], y[keep], rcond=None)
        model[:, :, c] = basis @ coef
    return model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--tol', type=float, default=26)
    ap.add_argument('--shadow', type=float, default=0.0, help='how dark a cast shadow may be (0 = keep shadows as object), e.g. 0.45')
    ap.add_argument('--shadow-chroma', type=float, default=0.07)
    ap.add_argument('--frame', type=float, default=0.05)
    ap.add_argument('--holes', type=int, default=300)
    ap.add_argument('--box', default='', help='x0,y0,x1,y1 in source pixels: everything outside is dropped')
    ap.add_argument('--erase', default='', help='x0,y0,x1,y1[;...] in source pixels: rectangles forced to background')
    ap.add_argument('--max', type=int, default=0, help='resize so the long side is at most this')
    ap.add_argument('--height', type=int, default=0, help='resize to exactly this height')
    ap.add_argument('--keep-alpha', action='store_true')
    ap.add_argument('--erode', type=int, default=1)
    ap.add_argument('--close', type=int, default=0, help='close gaps up to about 2x this many pixels wide (dark joints that match a dark backdrop)')
    ap.add_argument('--check', default='')
    ap.add_argument('--check-bg', default='20,44,156;122,31,92;255,210,31')
    a = ap.parse_args()

    src = Image.open(a.src)
    rgba = np.asarray(src.convert('RGBA'))
    rgb = rgba[:, :, :3].astype(np.float32)
    h, w, _ = rgb.shape
    if a.keep_alpha:
        obj = rgba[:, :, 3] >= 128
        model = None
    else:
        model = fit_backdrop(rgb, a.frame)
        diff = np.abs(rgb - model).max(axis=2)
        near = diff <= a.tol
        if a.shadow > 0:
            ratio = rgb / np.maximum(model, 1)
            lo, hi = ratio.min(axis=2), ratio.max(axis=2)
            near |= (hi - lo <= a.shadow_chroma) & (lo >= 1 - a.shadow) & (hi <= 1.06)
        seed = np.zeros_like(near)
        seed[0, :] = seed[-1, :] = seed[:, 0] = seed[:, -1] = True
        back = reconstruct(seed, near)
        rest = near & ~back
        holes = 0
        while rest.any():
            ys, xs = np.nonzero(rest)
            s = np.zeros_like(rest)
            s[ys[0], xs[0]] = True
            comp = reconstruct(s, rest)
            if int(comp.sum()) >= a.holes:
                back |= comp
                holes += 1
            rest &= ~comp
        obj = ~back
        if a.close > 0:
            m = obj
            for _ in range(a.close):
                m = dilate(m)
            for _ in range(a.close):
                m = m & shift(m, 1, 0) & shift(m, -1, 0) & shift(m, 0, 1) & shift(m, 0, -1)
            # erosion pulls the picture border in: keep what was object there
            obj = m | obj
    if a.box:
        x0, y0, x1, y1 = (int(v) for v in a.box.split(','))
        keep = np.zeros_like(obj)
        keep[y0:y1, x0:x1] = True
        obj &= keep
    if a.erase:
        for r in a.erase.split(';'):
            x0, y0, x1, y1 = (int(v) for v in r.split(','))
            obj[y0:y1, x0:x1] = False
    # drop specks: keep the components that hold at least 0.4% of the object
    total = int(obj.sum())
    rest = obj.copy()
    kept = np.zeros_like(obj)
    while rest.any():
        ys, xs = np.nonzero(rest)
        s = np.zeros_like(rest)
        s[ys[0], xs[0]] = True
        comp = reconstruct(s, rest)
        if int(comp.sum()) >= total * 0.004:
            kept |= comp
        rest &= ~comp
    obj = kept

    inner = obj
    for _ in range(a.erode):
        inner = inner & shift(inner, 1, 0) & shift(inner, -1, 0) & shift(inner, 0, 1) & shift(inner, 0, -1)
    if a.keep_alpha:
        al = rgba[:, :, 3].astype(np.float32) * obj
    else:
        alpha = Image.fromarray((inner * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
        al = np.asarray(alpha).astype(np.float32)
        al = np.clip((al - 20) * 255 / 215, 0, 255)
    core = inner & shift(inner, 2, 0) & shift(inner, -2, 0) & shift(inner, 0, 2) & shift(inner, 0, -2)
    # defringe: edge pixels take the colour of nearby core pixels
    cw = core.astype(np.float32)
    acc = np.zeros_like(rgb)
    wsum = np.zeros((h, w), np.float32)
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            wsum += shift(cw, dy, dx)
            acc += np.stack([shift(rgb[:, :, c] * cw, dy, dx) for c in range(3)], axis=2)
    fill = acc / np.maximum(wsum, 1e-3)[:, :, None]
    edge = (al > 0) & ~core & (wsum > 0)
    out = rgb.copy()
    out[edge] = fill[edge]

    pic = Image.fromarray(np.dstack([np.clip(out, 0, 255), al]).astype(np.uint8), 'RGBA')
    bbox = pic.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    pic = pic.crop(bbox)
    if a.height:
        pic = pic.resize((max(1, round(pic.size[0] * a.height / pic.size[1])), a.height), Image.LANCZOS)
    elif a.max and max(pic.size) > a.max:
        k = a.max / max(pic.size)
        pic = pic.resize((max(1, round(pic.size[0] * k)), max(1, round(pic.size[1] * k))), Image.LANCZOS)
    pic.save(a.dst, optimize=True)
    if a.check:
        cols = [tuple(int(v) for v in c.split(',')) for c in a.check_bg.split(';')]
        tw, th = pic.size
        chk = Image.new('RGB', ((tw + 16) * len(cols), th + 16), (0, 0, 0))
        for i, c in enumerate(cols):
            chk.paste(c, (i * (tw + 16), 0, (i + 1) * (tw + 16), th + 16))
            chk.paste(pic, (i * (tw + 16) + 8, 8), pic)
        chk.save(a.check)
    print(f'{a.dst} {pic.size[0]}x{pic.size[1]} bbox={bbox}')


if __name__ == '__main__':
    main()
