# Contact sheets of a qa-tap-film.cjs folder: every frame, labelled with its round time,
# 8 per row, at most 40 per sheet.
#   python3 -I tests/e2e/qa-tap-sheet.py tests/e2e/out/qa-tap-film/normal-390x844
import glob
import os
import sys

from PIL import Image, ImageDraw

folder = sys.argv[1]
files = sorted(f for f in glob.glob(os.path.join(folder, '[0-9][0-9][0-9]-*.png')))
for old in glob.glob(os.path.join(folder, 'sheet-*.png')):
    os.remove(old)
COLS, PER = 8, 40
TW = 160
for n in range(0, len(files), PER):
    chunk = files[n:n + PER]
    first = Image.open(chunk[0])
    th = round(first.height * TW / first.width)
    rows = (len(chunk) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * TW, rows * (th + 16)), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(chunk):
        im = Image.open(f).convert('RGB').resize((TW, th))
        x, y = (i % COLS) * TW, (i // COLS) * (th + 16)
        sheet.paste(im, (x, y + 16))
        ms = os.path.basename(f).split('-')[1].split('.')[0]
        d.text((x + 3, y + 2), f'{int(ms) / 1000:.1f}s', fill=(255, 255, 0))
    out = os.path.join(folder, f'sheet-{n // PER:02d}.png')
    sheet.save(out)
    print(out)
