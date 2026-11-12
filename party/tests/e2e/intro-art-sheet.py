"""Contact sheet of the intro key art: every picture at 96, 200 and 480 px on cobalt and on sunburst yellow.

python3 -I tests/e2e/intro-art-sheet.py <intro dir> <sheet.png>
"""
import os
import sys

from PIL import Image, ImageDraw

NAMES = ['show', 'tap', 'icy', 'flappy', 'plotzel', 'ninja']
SIZES = [96, 200, 480]
BGS = [(0x1E, 0x3F, 0xD8), (0xFF, 0xD2, 0x1F)]
INK = (0x16, 0x12, 0x0E)
PAD = 16
LABEL = 22


def main():
    src, dst = sys.argv[1], sys.argv[2]
    pics = [(n, Image.open(os.path.join(src, n + '.webp')).convert('RGBA')) for n in NAMES
            if os.path.exists(os.path.join(src, n + '.webp'))]
    half = sum(SIZES) + PAD * (len(SIZES) + 1)
    row = max(SIZES) + PAD * 2 + LABEL
    sheet = Image.new('RGB', (half * len(BGS), row * len(pics)), INK)
    draw = ImageDraw.Draw(sheet)
    for r, (name, pic) in enumerate(pics):
        y0 = r * row
        for b, bg in enumerate(BGS):
            x0 = b * half
            sheet.paste(bg, (x0, y0, x0 + half, y0 + row - 2))
            kb = os.path.getsize(os.path.join(src, name + '.webp')) / 1024
            draw.text((x0 + PAD, y0 + 5), f'{name}.webp  {pic.size[0]}x{pic.size[1]}  {kb:.0f} KB   at 96 / 200 / 480 px',
                      fill=(255, 255, 255) if b == 0 else INK)
            x = x0 + PAD
            for s in SIZES:
                k = s / max(pic.size)
                t = pic.convert('RGBa').resize((max(1, round(pic.size[0] * k)), max(1, round(pic.size[1] * k))),
                                               Image.LANCZOS).convert('RGBA')
                sheet.paste(t, (x + (s - t.size[0]) // 2, y0 + LABEL + PAD + (max(SIZES) - t.size[1]) // 2), t)
                x += s + PAD
    sheet.save(dst, optimize=True)
    print(f'{dst} {sheet.size[0]}x{sheet.size[1]} {len(pics)} pictures')


if __name__ == '__main__':
    main()
