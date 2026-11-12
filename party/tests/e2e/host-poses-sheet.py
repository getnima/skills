"""Contact sheet of the hosts' narrating poses: per host, the reference doll and every pose, big (420 px tall)
on the show's cobalt and at TV sizes (260 and 140 px tall, as the narrator draws them in a round and on a
small screen) on the sunburst yellow, with each file's size and weight.

python3 -I tests/e2e/host-poses-sheet.py <repo root> <sheet.png>
"""
import os
import sys

from PIL import Image, ImageDraw

POSES = ['present', 'cheer', 'shocked', 'shush', 'laugh', 'wave']
COB = (0x1E, 0x3F, 0xD8)
YEL = (0xFF, 0xD2, 0x1F)
INK = (0x16, 0x12, 0x0E)
BIG = 420
SMALL = [260, 140]
PAD = 18
LABEL = 26


def fit(pic, h):
    k = h / pic.size[1]
    return pic.convert('RGBa').resize((max(1, round(pic.size[0] * k)), h), Image.LANCZOS).convert('RGBA')


def main():
    root, dst = sys.argv[1], sys.argv[2]
    hosts = os.path.join(root, 'client/public/assets/hosts')
    rows = []
    for who in 'ab':
        cells = [('reference', os.path.join(hosts, f'host_{who}.png'))]
        cells += [(p, os.path.join(hosts, 'poses', f'{who}_{p}.webp')) for p in POSES]
        rows.append((who, [(n, f) for n, f in cells if os.path.exists(f)]))
    col_w = 260
    small_h = sum(SMALL) + PAD
    row_h = LABEL + BIG + PAD + small_h + PAD * 2
    width = max(len(c) for _, c in rows) * (col_w + PAD) + PAD
    sheet = Image.new('RGB', (width, row_h * len(rows)), INK)
    draw = ImageDraw.Draw(sheet)
    for r, (who, cells) in enumerate(rows):
        y0 = r * row_h
        for c, (name, path) in enumerate(cells):
            x0 = PAD + c * (col_w + PAD)
            pic = Image.open(path).convert('RGBA')
            kb = os.path.getsize(path) / 1024
            draw.text((x0, y0 + 6), f'{who}_{name}  {pic.size[0]}x{pic.size[1]}  {kb:.0f} KB', fill=(255, 255, 255))
            top = y0 + LABEL
            sheet.paste(COB, (x0, top, x0 + col_w, top + BIG))
            big = fit(pic, BIG - 20)
            if big.size[0] > col_w - 10:
                big = big.resize((col_w - 10, round(big.size[1] * (col_w - 10) / big.size[0])), Image.LANCZOS)
            sheet.paste(big, (x0 + (col_w - big.size[0]) // 2, top + BIG - 10 - big.size[1]), big)
            top += BIG + PAD
            sheet.paste(YEL, (x0, top, x0 + col_w, top + small_h))
            x = x0 + 8
            for h in SMALL:
                t = fit(pic, h)
                sheet.paste(t, (x, top + small_h - 8 - t.size[1]), t)
                x += t.size[0] + 10
    sheet.save(dst, optimize=True)
    print(f'{dst} {sheet.size[0]}x{sheet.size[1]}')


if __name__ == '__main__':
    main()
