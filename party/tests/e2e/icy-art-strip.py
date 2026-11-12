"""Filmstrip of the hero crops from icy-art-capture.cjs (reads <size>-shots.json).

python3 -I tests/e2e/icy-art-strip.py tests/e2e/out/icy-art/capture/390x844-shots.json <out.png> [--cols 9]
"""
import argparse
import json

from PIL import Image, ImageDraw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('shots')
    ap.add_argument('dst')
    ap.add_argument('--cols', type=int, default=9)
    ap.add_argument('--w', type=int, default=140)
    ap.add_argument('--h', type=int, default=170)
    a = ap.parse_args()
    shots = json.load(open(a.shots))
    cells = []
    for s in shots:
        im = Image.open(s['file'])
        k = im.width / 390 if 'x844' in s['file'] else im.width / int(s['file'].split('/')[-1].split('x')[0])
        x, y = s['x'] * k, s['y'] * k
        box = (int(x - a.w * k / 2), int(y - a.h * k * 0.78), int(x + a.w * k / 2), int(y + a.h * k * 0.22))
        cells.append((im.crop(box), s['tag']))
    cw, ch = int(a.w * 2), int(a.h * 2)
    rows = (len(cells) + a.cols - 1) // a.cols
    strip = Image.new('RGB', (cw * min(a.cols, len(cells)), (ch + 22) * rows), (10, 10, 20))
    d = ImageDraw.Draw(strip)
    for i, (c, t) in enumerate(cells):
        col, row = i % a.cols, i // a.cols
        strip.paste(c.resize((cw, ch)), (col * cw, row * (ch + 22)))
        d.text((col * cw + 6, row * (ch + 22) + ch + 4), f'{i:02d} {t}', fill=(255, 210, 31))
    strip.save(a.dst)
    print(a.dst, strip.size)


if __name__ == '__main__':
    main()
