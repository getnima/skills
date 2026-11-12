"""Contact sheet of every icy picture at the size the game draws it (390 x 844 phone, 2x device pixels),
on the game's colours, plus a strip of the hero frames.

python3 -I tests/e2e/icy-art-sheet.py <client/public/assets/icy> <out dir>
Writes <out>/sheet.png and <out>/hero-strip.png.

Drawn sizes (world units -> CSS px at scale 0.975 -> device px x2): the hero stands 76 units (box 97 units),
a ledge is 26 units thick, a side wall 18 units wide, the back wall 400 units wide.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

SCALE = 0.975 * 2  # device px per world unit on a 390 px phone at dpr 2
INK = (22, 18, 14)
COB_D = (16, 35, 140)
PAPER = (255, 248, 230)
YEL = (255, 210, 31)
# zone colouring of the stone pictures (tower.ts STONE_LOOKS): wall tint, back tint, back grey?
ZONES = [
    ('1 stone + snow', None, (0x6F, 0x83, 0xD6), False),
    ('2 ice', (0x8F, 0xE2, 0xFF), (0x2F, 0x78, 0xA6), True),
    ('3 timber', (0xF0, 0xB0, 0x7C), (0x7C, 0x40, 0x38), True),
    ('4 summit', (0xFF, 0xD2, 0x4A), (0xB4, 0x7A, 0x22), True),
]


def grey(im):
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    lum = np.minimum(255, (a[:, :, 0] * 0.3 + a[:, :, 1] * 0.59 + a[:, :, 2] * 0.11) * 1.5 + 18)
    a[:, :, 0] = a[:, :, 1] = a[:, :, 2] = lum
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def tint(im, col, make_grey):
    src = grey(im) if make_grey else im.convert('RGBA')
    if col is None:
        return src
    a = np.asarray(src).astype(np.float32)
    for c in range(3):
        a[:, :, c] = a[:, :, c] * col[c] / 255
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def tiled(tile, w, h):
    """`tile` repeated over w x h."""
    out = Image.new('RGBA', (w, h))
    for x in range(0, w, tile.width):
        for y in range(0, h, tile.height):
            out.paste(tile, (x, y))
    return out


def outlined(im, w=3):
    """Ink outline + the picture (like the game's sticker finish), device px."""
    a = np.asarray(im.convert('RGBA'))
    sil = (a[:, :, 3] > 40).astype(np.uint8) * 255
    pad = w + 2
    big = Image.new('RGBA', (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    ink = Image.new('RGBA', im.size, INK + (255,))
    mask = Image.fromarray(sil, 'L')
    for dx in range(-w, w + 1):
        for dy in range(-w, w + 1):
            if dx * dx + dy * dy <= w * w:
                big.paste(ink, (pad + dx, pad + dy), mask)
    big.alpha_composite(im.convert('RGBA'), (pad, pad))
    return big


def label(d, xy, text, fill=PAPER):
    d.text(xy, text, fill=fill)


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    hero = {f: Image.open(os.path.join(src, 'hero', f + '.webp')).convert('RGBA') for f in ['stand', 'run1', 'run2', 'jump', 'fall', 'ball']}
    box = round(76 / (200 / 256) * SCALE)  # the 256 px frame box at drawn size
    floors = {n: Image.open(os.path.join(src, 'floors', n + '.webp')).convert('RGBA') for n in ['zone1', 'zone2', 'zone3', 'zone4', 'milestone']}
    icicles = Image.open(os.path.join(src, 'floors', 'icicles.webp')).convert('RGBA')
    wall = Image.open(os.path.join(src, 'wall.webp')).convert('RGBA')
    bg = Image.open(os.path.join(src, 'bg.webp')).convert('RGBA')

    W = 1600
    sheet = Image.new('RGB', (W, 1980), COB_D)
    d = ImageDraw.Draw(sheet)
    label(d, (20, 12), 'icy: every picture at its drawn size (390x844 phone, 2x device px), on the game colours', YEL)

    # hero frames on each zone's back wall
    y = 40
    label(d, (20, y), f'hero frames (box {box} px, standing figure {round(76 * SCALE)} px tall), ink outline as in the game')
    y += 18
    bh = box + 20
    for zi, (zname, _wt, bt, bgrey) in enumerate(ZONES):
        tile = tint(bg, bt, bgrey).resize((round(400 * SCALE), round(400 * SCALE)))
        row = tiled(tile, W - 40, bh)
        sheet.paste(row.convert('RGB'), (20, y))
        for i, f in enumerate(['stand', 'run1', 'run2', 'jump', 'fall', 'ball']):
            fr = outlined(hero[f].resize((box, box), Image.LANCZOS), 2)
            sheet.paste(fr, (30 + i * (box + 30), y + 6), fr)
        label(d, (W - 200, y + 6), zname)
        y += bh + 4
    for i, f in enumerate(['stand', 'run1', 'run2', 'jump', 'fall', 'ball']):
        label(d, (30 + i * (box + 30) + box // 2 - 12, y), f)
    y += 22

    # ledges at drawn height, at three floor widths (simple 3-slice: caps + stretched middle)
    lh = round(26 * SCALE)
    label(d, (20, y), f'ledges, {lh} px thick, at floor widths 70 / 140 / 260 units (+ the full-width every-10th-floor ledge)')
    y += 18
    feather = {'zone1': 8, 'zone2': 8, 'zone3': 8, 'zone4': 4, 'milestone': 8}
    caps = {'zone1': (44, 73), 'zone2': (55, 56), 'zone3': (51, 37), 'zone4': (22, 12), 'milestone': (43, 50)}
    for zi, n in enumerate(['zone1', 'zone2', 'zone3', 'zone4', 'milestone']):
        z = ZONES[min(zi, 3)] if n != 'milestone' else ZONES[0]
        tile = tint(bg, z[2], z[3]).resize((round(400 * SCALE), round(400 * SCALE)))
        sheet.paste(tiled(tile, W - 40, lh + 46).convert('RGB'), (20, y))
        pic = floors[n]
        k = lh / pic.height
        cl, cr = caps[n]
        x = 30
        widths = [70, 140, 260] if n != 'milestone' else [364]
        for wu in widths:
            ww = round(wu * SCALE)
            left = pic.crop((0, 0, cl, pic.height)).resize((max(1, round(cl * k)), lh), Image.LANCZOS)
            right = pic.crop((pic.width - cr, 0, pic.width, pic.height)).resize((max(1, round(cr * k)), lh), Image.LANCZOS)
            f = round(feather[n] * k)  # the middle runs under the feathered inner edge of each cap
            mid_w = max(1, ww - left.width - right.width + 2 * f)
            unit = pic.crop((cl, 0, pic.width - cr, pic.height))
            uw = max(1, round(unit.width * k))
            mid = Image.new('RGBA', (mid_w, lh), (0, 0, 0, 0))
            for mx in range(0, mid_w, uw):
                mid.paste(unit.resize((uw, lh), Image.LANCZOS), (mx, 0))
            led = Image.new('RGBA', (ww, lh), (0, 0, 0, 0))
            led.paste(mid, (left.width - f, 0))
            led.alpha_composite(left, (0, 0))
            led.alpha_composite(right, (ww - right.width, 0))
            if n in ('zone1', 'zone2'):
                ic = icicles.resize((round(icicles.width * lh * 0.6 / icicles.height), round(lh * 0.6)), Image.LANCZOS)
                sheet.paste(ic.crop((0, 0, min(ic.width, ww - 20), ic.height)), (x + 10, y + 10 + lh - 4), ic.crop((0, 0, min(ic.width, ww - 20), ic.height)))
            o = outlined(led, 2)
            sheet.paste(o, (x, y + 8), o)
            x += ww + 40
        label(d, (W - 200, y + 6), f'floors/{n}.webp')
        y += lh + 50

    # icicle strip
    label(d, (20, y), 'floors/icicles.webp (12 cells), at 2x the drawn size')
    y += 16
    ic = icicles.resize((icicles.width, icicles.height))
    sheet.paste(ic, (30, y), ic)
    y += ic.height + 14

    # side walls and back walls per zone
    ww, wh = round(18 * SCALE), round(144 * SCALE)
    label(d, (20, y), f'side wall (wall.webp, {ww} x {wh} px per tile, mirrored on the right) and back wall (bg.webp, a {round(400 * SCALE)} px wide tile) per zone')
    y += 18
    x = 30
    for zname, wt, bt, bgrey in ZONES:
        wtile = tint(wall, wt, wt is not None).resize((ww, wh), Image.LANCZOS)
        btile = tint(bg, bt, bgrey).resize((round(400 * SCALE), round(400 * SCALE)), Image.LANCZOS).crop((0, 0, 300, wh))
        sheet.paste(wtile.convert('RGB'), (x, y))
        sheet.paste(btile.convert('RGB'), (x + ww + 4, y))
        sheet.paste(wtile.transpose(Image.FLIP_LEFT_RIGHT).convert('RGB'), (x + ww + 8 + 300, y))
        label(d, (x, y + wh + 4), zname)
        x += ww * 2 + 300 + 40
    y += wh + 30
    sheet = sheet.crop((0, 0, W, y))
    sheet.save(os.path.join(out, 'sheet.png'))

    # hero strip: drawn size on the stone wall, and 2x for detail
    tile = tint(bg, ZONES[0][2], False).resize((round(400 * SCALE), round(400 * SCALE)))
    strip = Image.new('RGB', (6 * (box * 2 + 20) + 20, box * 3 + 70), COB_D)
    d2 = ImageDraw.Draw(strip)
    strip.paste(tiled(tile, strip.width, box + 20).convert('RGB'), (0, 0))
    for i, f in enumerate(['stand', 'run1', 'run2', 'jump', 'fall', 'ball']):
        fr = outlined(hero[f].resize((box, box), Image.LANCZOS), 2)
        strip.paste(fr, (20 + i * (box * 2 + 20) + box // 2, 6), fr)
        big = hero[f].resize((box * 2, box * 2), Image.LANCZOS)
        strip.paste(big, (20 + i * (box * 2 + 20), box + 30), big)
        d2.text((20 + i * (box * 2 + 20) + box - 12, box * 3 + 40), f, fill=PAPER)
    strip.save(os.path.join(out, 'hero-strip.png'))
    print(os.path.join(out, 'sheet.png'), sheet.size, os.path.join(out, 'hero-strip.png'), strip.size)


if __name__ == '__main__':
    main()
