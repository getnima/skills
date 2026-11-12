"""Colour-difference key for a strongly coloured, fuzzy object on white (avatar-extras: the feather boa).

python3 -I tests/e2e/avatar-extras-key.py <cut.png> <out.png> --chan 1 --ref 70 [--quantize] [--check tile.png]

<cut.png> is the output of avatar-extras-cut.py. White left between feathers / fibres keeps a high value in
--chan (0 R, 1 G, 2 B) while the object itself is low there (--ref = the object's typical value in that
channel). Each pixel's alpha is multiplied by (255 - v) / (255 - ref) (clipped to 0..1) and its colour is
unmixed from white, so the white specks vanish and the fibre tips fade instead of glowing.
"""
import argparse

import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--chan', type=int, default=1)
    ap.add_argument('--ref', type=float, default=70)
    ap.add_argument('--quantize', action='store_true')
    ap.add_argument('--check', default='')
    a = ap.parse_args()

    pic = Image.open(a.src).convert('RGBA')
    arr = np.asarray(pic).astype(np.float32)
    rgb, al = arr[:, :, :3], arr[:, :, 3] / 255
    v = rgb[:, :, a.chan]
    k = np.clip((255 - v) / (255 - a.ref), 0, 1)
    k = np.clip((k - 0.08) / 0.92, 0, 1)  # a little hard floor: no faint white haze
    unmixed = (rgb - (1 - k[:, :, None]) * 255) / np.maximum(k[:, :, None], 1e-3)
    out_rgb = np.where(k[:, :, None] > 0.02, np.clip(unmixed, 0, 255), rgb)
    out_a = al * k
    res = Image.fromarray(np.dstack([out_rgb, out_a * 255]).astype(np.uint8), 'RGBA')
    res = res.crop(res.getchannel('A').point(lambda x: 255 if x > 8 else 0).getbbox())
    if a.quantize:
        res.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(a.dst, optimize=True)
    else:
        res.save(a.dst, optimize=True)
    if a.check:
        tw, th = res.size
        chk = Image.new('RGB', (tw * 2 + 30, th + 20), (24, 24, 32))
        chk.paste((255, 210, 31), (tw + 15, 0, tw * 2 + 30, th + 20))
        chk.paste(res, (8, 10), res)
        chk.paste(res, (tw + 22, 10), res)
        chk.save(a.check)
    print(a.dst, res.size)


if __name__ == '__main__':
    main()
