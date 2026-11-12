"""Fit a headband-style picture (earmuffs) to the doll's head (avatar-extras).

python3 -I tests/e2e/avatar-extras-stretch.py <cut.png> <out.png> --legs 0.28,0.45 --taller 469 --wider 544 --band-rows 0.3 [--max 640] [--check tile.png]

<cut.png> is a full-size RGBA cut (avatar-extras-cut.py --max 2000). The arch of the band is too small for the head:
- the slab of rows between --legs y1,y2 (fractions of the height: only the band's two legs cross it) is stretched
  vertically by --taller px, so the band comes down further before the muffs;
- the picture is split at its centre column and --wider px are inserted there, each filled with the centre column's
  pixels in the top --band-rows fraction (the top of the arch) and left transparent below, so the muffs move apart
  and the band stays one piece.
"""
import argparse

import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--legs', required=True)
    ap.add_argument('--taller', type=int, required=True)
    ap.add_argument('--wider', type=int, required=True)
    ap.add_argument('--band-rows', type=float, default=0.3)
    ap.add_argument('--max', type=int, default=640)
    ap.add_argument('--check', default='')
    a = ap.parse_args()

    pic = Image.open(a.src).convert('RGBA')
    w, h = pic.size
    y1, y2 = (round(float(v) * h) for v in a.legs.split(','))
    top, slab, bottom = pic.crop((0, 0, w, y1)), pic.crop((0, y1, w, y2)), pic.crop((0, y2, w, h))
    slab = slab.resize((w, (y2 - y1) + a.taller), Image.BICUBIC)
    tall = Image.new('RGBA', (w, h + a.taller), (0, 0, 0, 0))
    tall.paste(top, (0, 0))
    tall.paste(slab, (0, y1))
    tall.paste(bottom, (0, y2 + a.taller))

    arr = np.asarray(tall)
    H = arr.shape[0]
    xc = w // 2
    band_h = round(a.band_rows * h)
    col = arr[:, xc:xc + 1].copy()
    col[band_h:] = 0
    filler = np.repeat(col, a.wider, axis=1)
    out = np.concatenate([arr[:, :xc], filler, arr[:, xc:]], axis=1)
    res = Image.fromarray(out, 'RGBA')
    res = res.crop(res.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    if max(res.size) > a.max:
        k = a.max / max(res.size)
        res = res.resize((round(res.size[0] * k), round(res.size[1] * k)), Image.LANCZOS)
    res.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(a.dst, optimize=True)
    if a.check:
        tw, th = res.size
        chk = Image.new('RGB', (tw * 2 + 30, th + 20), (24, 24, 32))
        chk.paste((255, 210, 31), (tw + 15, 0, tw * 2 + 30, th + 20))
        chk.paste(res, (8, 10), res)
        chk.paste(res, (tw + 22, 10), res)
        chk.save(a.check)
    print(a.dst, res.size, 'source cut', (w, h), 'centre column', xc, 'band rows', band_h)


if __name__ == '__main__':
    main()
