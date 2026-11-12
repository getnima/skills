"""sweep-phone-sheet: contact sheets of the sweep's screenshots, one row per screen label, one
column per profile, each phone scaled to the same height (so 320x568 and 430x932 sit side by side).

    python3 tests/e2e/sweep-phone-sheet.py tests/e2e/out/sweep-phone-/entry [label-substring ...]

Writes <dir>/sheet-<label>.png (one per label, or one per given substring group).
"""
import os
import re
import sys

from PIL import Image, ImageDraw

ORDER = ['se', 'ip14', 'promax', 'pixel7', 's8', 'a412']
H = 640


def main() -> None:
    d = sys.argv[1]
    want = sys.argv[2:]
    files = [f for f in os.listdir(d) if f.endswith('.png') and not f.startswith('sheet-')]
    by = {}
    for f in files:
        m = re.match(r'^([a-z0-9]+)-(.+)\.png$', f)
        if not m or m.group(1) not in ORDER:
            continue
        by.setdefault(m.group(2), {})[m.group(1)] = f
    labels = sorted(by)
    if want:
        labels = [l for l in labels if any(w in l for w in want)]
    for label in labels:
        row = by[label]
        ims = []
        for k in ORDER:
            if k not in row:
                continue
            im = Image.open(os.path.join(d, row[k])).convert('RGB')
            w = round(im.width * H / im.height)
            ims.append((k, im.resize((w, H))))
        if not ims:
            continue
        W = sum(i.width for _, i in ims) + 8 * (len(ims) + 1)
        sheet = Image.new('RGB', (W, H + 28), (40, 40, 40))
        x = 8
        dr = ImageDraw.Draw(sheet)
        for k, im in ims:
            sheet.paste(im, (x, 24))
            dr.text((x + 2, 4), k, fill=(255, 255, 0))
            x += im.width + 8
        sheet.save(os.path.join(d, f'sheet-{label}.png'))
        print(os.path.join(d, f'sheet-{label}.png'))


if __name__ == '__main__':
    main()
