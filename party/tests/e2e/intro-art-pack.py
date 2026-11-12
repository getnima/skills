"""Trim, resize and save one cut intro picture as the final WebP.

python3 -I tests/e2e/intro-art-pack.py <cut.png> <out.webp> [--max 768] [--quality 86] [--limit 160]

Trims to the opaque pixels (alpha > 8), keeps a 2 px transparent margin, resizes so the longest side is
--max, and saves WebP with alpha. If the file is over --limit KB the quality steps down (never under 70).
"""
import argparse
import os

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--max', type=int, default=768)
    ap.add_argument('--quality', type=int, default=86)
    ap.add_argument('--limit', type=int, default=160)
    a = ap.parse_args()

    pic = Image.open(a.src).convert('RGBA')
    bbox = pic.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    pic = pic.crop(bbox)
    inner = a.max - 4
    k = inner / max(pic.size)
    size = (max(1, round(pic.size[0] * k)), max(1, round(pic.size[1] * k)))
    # resize premultiplied so the colour of see-through edge pixels cannot bleed in
    pic = pic.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')
    out = Image.new('RGBA', (size[0] + 4, size[1] + 4), (0, 0, 0, 0))
    out.paste(pic, (2, 2))
    q = a.quality
    while True:
        out.save(a.dst, 'WEBP', quality=q, method=6, alpha_quality=95, exact=False)
        kb = os.path.getsize(a.dst) / 1024
        if kb <= a.limit or q <= 70:
            break
        q -= 2
    back = Image.open(a.dst)
    print(f'{a.dst} {back.size[0]}x{back.size[1]} {back.mode} q={q} {kb:.1f} KB')


if __name__ == '__main__':
    main()
