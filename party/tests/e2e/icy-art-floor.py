"""Build one icy ledge picture (3-slice) from a cut-out of a long generated ledge.

python3 -I tests/e2e/icy-art-floor.py <cut.png> <out.png> --body Y --lcap X --rcap X --cuts a,b,c
        [--height 64] [--blend 28] [--icicles strip.png] [--check tile.png]

<cut.png> is the output of icy-art-cut.py (trimmed, transparent). All positions are in its pixels:
  --body Y     the ledge is rows 0..Y (below it hang icicles; they are not part of the ledge picture)
  --lcap X     the left end cap is columns 0..X
  --rcap X     the right end cap is columns X..width
  --cuts ...   columns between the caps where the middle may be cut (joints between blocks)

The middle (lcap..rcap) is the repeating unit. Its last --blend columns are cross-faded into the columns
just left of the unit, so the unit wraps without a step. The picture is scaled to --height and saved; the
cap widths and cut positions are printed in output pixels (they go into FLOOR_SLICES in games/icy/art.ts
and into the README).

--icicles writes the hanging icicles as a strip of 32 x 64 cells, top-aligned (cell count printed).
--check writes ledges of several widths assembled the way the game does it, to look at.
"""
import argparse

import numpy as np
from PIL import Image


def assemble(pic, cap_l, cap_r, cuts, width, f=0):
    """Mirror of the game's layout: caps unscaled, whole units + a prefix up to a cut, scaled in x to fit.
    The middle runs `f` pixels under each cap (their inner edges are feathered)."""
    w, h = pic.size
    unit0, unit1 = cap_l, w - cap_r
    full = unit1 - unit0
    out = Image.new('RGBA', (width, h), (0, 0, 0, 0))
    if width <= cap_l + cap_r:
        half = width // 2
        out.paste(pic.crop((0, 0, cap_l - f, h)).resize((half, h), Image.LANCZOS), (0, 0))
        out.paste(pic.crop((unit1 + f, 0, w, h)).resize((width - half, h), Image.LANCZOS), (half, 0))
        return out
    cap_l -= f
    cap_r -= f
    need = width - cap_l - cap_r
    n = need // full
    rem = need - n * full
    options = [0] + [c - unit0 for c in cuts] + [full]
    p = min(options, key=lambda v: abs(v - rem))
    if n == 0 and p == 0:
        p = options[1]
    total = n * full + p
    s = need / total
    x = float(cap_l)
    unit = pic.crop((unit0, 0, unit1, h))
    for i in range(n):
        x1 = cap_l + round((i + 1) * full * s)
        x0 = cap_l + round(i * full * s)
        out.paste(unit.resize((x1 - x0, h), Image.LANCZOS), (x0, 0))
    if p > 0:
        x0 = cap_l + round(n * full * s)
        out.paste(unit.crop((0, 0, p, h)).resize((width - cap_r - x0, h), Image.LANCZOS), (x0, 0))
    left = pic.crop((0, 0, cap_l + f, h))
    right = pic.crop((unit1, 0, w, h))
    out.alpha_composite(left, (0, 0))
    out.alpha_composite(right, (width - cap_r - f, 0))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--body', type=int, required=True)
    ap.add_argument('--lcap', type=int, required=True)
    ap.add_argument('--rcap', type=int, required=True)
    ap.add_argument('--cuts', default='')
    ap.add_argument('--height', type=int, default=64)
    ap.add_argument('--blend', type=int, default=28)
    ap.add_argument('--feather', type=int, default=8, help='output pixels: the inner edge of each cap fades out over this many columns (the middle runs under it)')
    ap.add_argument('--icicles', default='')
    ap.add_argument('--check', default='')
    ap.add_argument('--quantize', action='store_true')
    a = ap.parse_args()

    src = Image.open(a.src).convert('RGBA')
    arr = np.asarray(src).astype(np.float32)
    w = arr.shape[1]
    body = arr[: a.body].copy()
    # wrap: the unit's last columns fade into what sits just left of the unit
    o = a.blend
    if o > 0:
        t = (np.arange(o, dtype=np.float32) + 1) / (o + 1)
        tail = body[:, a.rcap - o : a.rcap]
        lead = body[:, a.lcap - o : a.lcap]
        # premultiplied blend so a see-through edge does not pull colour
        pa, pb = tail[:, :, 3:4] / 255, lead[:, :, 3:4] / 255
        k = t[None, :, None]
        al = pa * (1 - k) + pb * k
        rgb = (tail[:, :, :3] * pa * (1 - k) + lead[:, :, :3] * pb * k) / np.maximum(al, 1e-3)
        body[:, a.rcap - o : a.rcap, :3] = rgb
        body[:, a.rcap - o : a.rcap, 3:4] = al * 255
    pic = Image.fromarray(np.clip(body, 0, 255).astype(np.uint8), 'RGBA')
    k = a.height / a.body
    ow = round(w * k)
    pic = pic.resize((ow, a.height), Image.LANCZOS)
    cap_l = round(a.lcap * k)
    cap_r = ow - round(a.rcap * k)
    cuts = [round(int(c) * k) for c in a.cuts.split(',') if c]
    if a.feather > 0:
        px = np.asarray(pic).astype(np.float32)
        f = a.feather
        ramp = (np.arange(f, dtype=np.float32) + 0.5) / f
        px[:, cap_l - f : cap_l, 3] *= ramp[::-1][None, :]
        px[:, ow - cap_r : ow - cap_r + f, 3] *= ramp[None, :]
        pic = Image.fromarray(np.clip(px, 0, 255).astype(np.uint8), 'RGBA')
    if a.quantize:
        pic.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(a.dst, optimize=True)
    else:
        pic.save(a.dst, optimize=True)
    print(f'{a.dst} {ow}x{a.height} capL={cap_l} capR={cap_r} cuts={cuts} unit={ow - cap_l - cap_r}')

    if a.icicles:
        hang = arr[a.body + 3 :, :, :].copy()
        # the dark shadow the icicles cast on the ledge behind them is not icicle
        hang[hang[:, :, :3].max(axis=2) < 125, 3] = 0
        mask = hang[:, :, 3] > 110
        hh = hang.shape[0]
        # depth of what hangs in every column, smoothed; one icicle = the columns between two valleys
        depth = np.where(mask.any(axis=0), hh - np.argmax(mask[::-1], axis=0), 0).astype(np.float32)
        sm = np.convolve(depth, np.ones(7) / 7, mode='same')
        cuts_x = [0]
        for x in range(8, w - 8):
            lo = sm[x - 6 : x + 7].min()
            if sm[x] <= lo + 1e-3 and (sm[max(0, x - 22) : x].max() - sm[x] > hh * 0.12 or sm[x] < 1) and x - cuts_x[-1] > 12:
                cuts_x.append(x)
        cuts_x.append(w)
        cell_w, cell_h = 32, 64
        kk = cell_h / hh * 0.98
        cells = []
        for x0, x1 in zip(cuts_x, cuts_x[1:]):
            seg = depth[x0:x1]
            if seg.max() < hh * 0.25:
                continue
            cols = np.nonzero(seg > 0)[0]
            if cols.size < 12:
                continue
            c0, c1 = x0 + int(cols[0]), x0 + int(cols[-1]) + 1
            piece = Image.fromarray(np.clip(hang[:, c0:c1], 0, 255).astype(np.uint8), 'RGBA')
            pw = max(1, round((c1 - c0) * kk))
            if pw > cell_w:
                continue
            piece = piece.resize((pw, round(piece.size[1] * kk)), Image.LANCZOS)
            cell = Image.new('RGBA', (cell_w, cell_h), (0, 0, 0, 0))
            cell.paste(piece, ((cell_w - pw) // 2, 0))
            cells.append(cell)
        if len(cells) > 12:
            cells = [cells[round(i * (len(cells) - 1) / 11)] for i in range(12)]
        strip = Image.new('RGBA', (cell_w * len(cells), cell_h), (0, 0, 0, 0))
        for i, c in enumerate(cells):
            strip.paste(c, (i * cell_w, 0))
        strip.save(a.icicles, optimize=True)
        print(f'{a.icicles} {strip.size[0]}x{strip.size[1]} cells={len(cells)}')

    if a.check:
        widths = [80, 110, 150, 200, 260, 330, 420, 560, 896]
        hh = a.height + 14
        chk = Image.new('RGB', (920, hh * len(widths) + 10), (20, 44, 156))
        for i, ww in enumerate(widths):
            fl = assemble(pic, cap_l, cap_r, cuts, ww, a.feather)
            chk.paste(fl, (10, 10 + i * hh), fl)
        chk.save(a.check)


if __name__ == '__main__':
    main()
