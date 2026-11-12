"""Local background cut for the intro key art (one toy scene on a plain studio backdrop).

python3 -I tests/e2e/intro-art-cut.py <in> <out.png> [--tol 22] [--shadow 0.4] [--holes 400]
        [--erase x0,y0,x1,y1;...] [--keep-alpha] [--erode 1] [--check tile.png]

The backdrop is modelled as a smooth surface (a quadratic per channel fitted to the outer frame of the
picture). A pixel is backdrop when it is within --tol of that surface, or (with --shadow) when it is the
backdrop's own colour only darker (a soft cast shadow). Background is whatever such pixels connect to the
picture border; enclosed pockets bigger than --holes pixels go too. The mask is eroded, feathered, and the
edge colours are pulled from the interior, so no backdrop fringe is left.
With --keep-alpha the input is already cut (the paid remove_background) and only the clean-up runs.
The output is a full-size RGBA PNG (the final trim / resize / WebP is intro-art-pack.py).
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


def erode(m):
    return m & shift(m, 1, 0) & shift(m, -1, 0) & shift(m, 0, 1) & shift(m, 0, -1)


def reconstruct(seed, mask):
    cur = seed & mask
    while True:
        nxt = cur
        for _ in range(24):
            nxt = dilate(nxt) & mask
        if (nxt == cur).all():
            return cur
        cur = nxt


def components(mask):
    rest = mask.copy()
    while rest.any():
        ys, xs = np.nonzero(rest)
        s = np.zeros_like(rest)
        s[ys[0], xs[0]] = True
        comp = reconstruct(s, rest)
        rest &= ~comp
        yield comp


def fit_backdrop(rgb, frame):
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
    ap.add_argument('--tol', type=float, default=22)
    ap.add_argument('--shadow', type=float, default=0.0)
    ap.add_argument('--shadow-chroma', type=float, default=0.06)
    ap.add_argument('--frame', type=float, default=0.04)
    ap.add_argument('--holes', type=int, default=400)
    ap.add_argument('--smooth', type=float, default=0, help='a backdrop pixel must also be flat: brightness range in a 5x5 window at most this (0 = off). Protects meshes and shaded white parts.')
    ap.add_argument('--shadow-smooth', type=float, default=0, help='flatness limit for shadow pixels (0 = same as --smooth)')
    ap.add_argument('--shadow-box', default='', help='x0,y0,x1,y1: shadows are looked for only here (the floor)')
    ap.add_argument('--zone', default='', help='x0,y0,x1,y1:tol[;...]: another tolerance inside a rectangle (a floor lit by the object)')
    ap.add_argument('--floor', default='', help='chroma,dark: cut each column under its lowest pixel with at least this chroma or at most this brightness')
    ap.add_argument('--erase-grey', default='', help='"x,y x,y x,y;...": polygons where neutral grey pixels are dropped (a clear display stand)')
    ap.add_argument('--grey-chroma', type=float, default=16)
    ap.add_argument('--grey-min', type=float, default=110)
    ap.add_argument('--heal', default='', help='x0,y0,x1,y1[;...]: repaint this strip of the object from the columns left and right of it')
    ap.add_argument('--erase-poly', default='', help='"x,y x,y x,y;...": polygons forced to background')
    ap.add_argument('--erase', default='')
    ap.add_argument('--keep', default='', help='x0,y0,x1,y1[;...]: rectangles forced to stay object (a white part the fill ate)')
    ap.add_argument('--keep-alpha', action='store_true')
    ap.add_argument('--erode', type=int, default=1)
    ap.add_argument('--speck', type=float, default=0.003, help='drop components smaller than this share of the object')
    ap.add_argument('--check', default='')
    a = ap.parse_args()

    rgba = np.asarray(Image.open(a.src).convert('RGBA'))
    rgb = rgba[:, :, :3].astype(np.float32)
    h, w, _ = rgb.shape
    if a.keep_alpha:
        obj = rgba[:, :, 3] >= 96
    else:
        model = fit_backdrop(rgb, a.frame)
        diff = np.abs(rgb - model).max(axis=2)
        tol = np.full((h, w), a.tol, np.float32)
        if a.zone:
            for z in a.zone.split(';'):
                box, t = z.split(':')
                x0, y0, x1, y1 = (int(v) for v in box.split(','))
                tol[y0:y1, x0:x1] = float(t)
        near = diff <= tol
        shade = np.zeros_like(near)
        if a.shadow > 0:
            ratio = rgb / np.maximum(model, 1)
            lo, hi = ratio.min(axis=2), ratio.max(axis=2)
            shade = (hi - lo <= a.shadow_chroma) & (lo >= 1 - a.shadow) & (hi <= 1.05)
            if a.shadow_box:
                x0, y0, x1, y1 = (int(v) for v in a.shadow_box.split(','))
                only = np.zeros_like(shade)
                only[y0:y1, x0:x1] = True
                shade &= only
        if a.smooth > 0:
            lum = rgb.mean(axis=2)
            hi_l, lo_l = lum.copy(), lum.copy()
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    if dy or dx:
                        sh = np.roll(np.roll(lum, dy, axis=0), dx, axis=1)
                        hi_l = np.maximum(hi_l, sh)
                        lo_l = np.minimum(lo_l, sh)
            def reach(limit):
                # the object edge itself is never flat: let the fill come up to it (2 px), not through it
                grow = (hi_l - lo_l) <= limit
                for _ in range(2):
                    grow = dilate(grow)
                return grow
            near &= reach(a.smooth)
            # a cast shadow on the floor is grainier than the lit backdrop: its own (looser) limit
            shade &= reach(a.shadow_smooth if a.shadow_smooth > 0 else a.smooth)
        near |= shade
        if a.keep:
            for r in a.keep.split(';'):
                x0, y0, x1, y1 = (int(v) for v in r.split(','))
                near[y0:y1, x0:x1] = False
        seed = np.zeros_like(near)
        seed[0, :] = seed[-1, :] = seed[:, 0] = seed[:, -1] = True
        back = reconstruct(seed, near)
        for comp in components(near & ~back):
            if int(comp.sum()) >= a.holes:
                back |= comp
        obj = ~back
    if a.floor:
        # the object stands on the floor: in every column the object ends at its lowest "solid" pixel
        # (strongly coloured, or very dark); the pale floor it lights or shades under that is dropped
        c_min, d_max = (float(v) for v in a.floor.split(','))
        solid = obj & ((rgb.max(axis=2) - rgb.min(axis=2) >= c_min) | (rgb.max(axis=2) <= d_max))
        rows = np.arange(h)[:, None]
        last = np.where(solid, rows, -1).max(axis=0)
        cols = last >= 0
        below = rows > (last[None, :] + 1)
        obj &= ~(below & cols[None, :])
    if a.heal:
        # a see-through thing in front of the object (a clear clip): repaint the strip from its two sides
        for r in a.heal.split(';'):
            x0, y0, x1, y1 = (int(v) for v in r.split(','))
            for y in range(y0, y1):
                left, right = rgb[y, x0 - 1].copy(), rgb[y, x1].copy()
                lo_ok, ro_ok = obj[y, x0 - 1], obj[y, x1]
                if not (lo_ok or ro_ok):
                    continue
                if not lo_ok:
                    left = right
                if not ro_ok:
                    right = left
                t = (np.arange(x0, x1) - (x0 - 1)) / (x1 - x0 + 1)
                rgb[y, x0:x1] = left[None, :] * (1 - t[:, None]) + right[None, :] * t[:, None]
    if a.erase_grey:
        # a clear acrylic stand: inside these polygons, drop what is neutral grey (not black, not coloured)
        from PIL import ImageDraw
        zone = Image.new('L', (w, h), 0)
        zd = ImageDraw.Draw(zone)
        for poly in a.erase_grey.split(';'):
            zd.polygon([tuple(float(v) for v in pt.split(',')) for pt in poly.split()], fill=255)
        zone = np.asarray(zone) > 0
        chroma = rgb.max(axis=2) - rgb.min(axis=2)
        obj &= ~(zone & (chroma <= a.grey_chroma) & (rgb.max(axis=2) >= a.grey_min))
    if a.erase_poly:
        from PIL import ImageDraw
        zone = Image.new('L', (w, h), 0)
        zd = ImageDraw.Draw(zone)
        for poly in a.erase_poly.split(';'):
            zd.polygon([tuple(float(v) for v in pt.split(',')) for pt in poly.split()], fill=255)
        obj &= ~(np.asarray(zone) > 0)
    if a.erase:
        for r in a.erase.split(';'):
            x0, y0, x1, y1 = (int(v) for v in r.split(','))
            obj[y0:y1, x0:x1] = False
    total = int(obj.sum())
    kept = np.zeros_like(obj)
    for comp in components(obj):
        if int(comp.sum()) >= total * a.speck:
            kept |= comp
    obj = kept

    inner = obj
    for _ in range(a.erode):
        inner = erode(inner)
    if a.keep_alpha:
        al = rgba[:, :, 3].astype(np.float32) * obj
    else:
        blur = Image.fromarray((inner * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1))
        al = np.clip((np.asarray(blur).astype(np.float32) - 24) * 255 / 207, 0, 255)
    core = inner
    for _ in range(2):
        core = erode(core)
    cw = core.astype(np.float32)
    acc = np.zeros_like(rgb)
    wsum = np.zeros((h, w), np.float32)
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            wsum += shift(cw, dy, dx)
            acc += np.stack([shift(rgb[:, :, c] * cw, dy, dx) for c in range(3)], axis=2)
    fill = acc / np.maximum(wsum, 1e-3)[:, :, None]
    edge = (al > 0) & ~core & (wsum > 0)
    out = rgb.copy()
    if not a.keep_alpha:
        out[edge] = fill[edge]
    else:
        # the paid cut keeps soft alpha; only pull the colour of the half-transparent rim inwards
        rim = edge & (al < 250)
        out[rim] = fill[rim]

    pic = Image.fromarray(np.dstack([np.clip(out, 0, 255), al]).astype(np.uint8), 'RGBA')
    pic.save(a.dst)
    bbox = pic.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if a.check:
        crop = pic.crop(bbox)
        cols = [(30, 63, 216), (255, 210, 31), (22, 18, 14)]
        tw, th = crop.size
        chk = Image.new('RGB', ((tw + 24) * len(cols), th + 24), (0, 0, 0))
        for i, c in enumerate(cols):
            chk.paste(c, (i * (tw + 24), 0, (i + 1) * (tw + 24), th + 24))
            chk.paste(crop, (i * (tw + 24) + 12, 12), crop)
        chk.save(a.check)
    print(f'{a.dst} {w}x{h} bbox={bbox} object={int(obj.sum()) / (w * h):.1%}')


if __name__ == '__main__':
    main()
