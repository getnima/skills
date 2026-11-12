# Art-director fixes on shipped cut-outs (python3 -I tests/e2e/avatar-review-fix.py). Idempotent: works from
# copies of the makers' pictures kept in tests/e2e/out/avatar-review/src/. Writes the PNG sources in
# client/src/avatar/art-src/; run avatar-review-webp.py afterwards to rebuild the shipped WebP files.
#   204 monocle, 206 star glasses: a thin dark edge so gold reads on skin; 206 gets dark lenses
#   305 earmuffs: a drawn pink band over the head (the maker shipped the muffs alone)
import os, shutil
from PIL import Image, ImageDraw, ImageFilter, ImageChops
ROOT = os.path.dirname(os.path.abspath(__file__)) + '/../../'
P = ROOT + 'client/src/avatar/art-src/'
SRC = ROOT + 'tests/e2e/out/avatar-review/src/'
def src(name):
    if not os.path.exists(SRC + name): shutil.copy(P + name, SRC + name)
    return Image.open(SRC + name).convert('RGBA')
def edge(im, px, color, strength):
    a = im.getchannel('A').point(lambda v: 255 if v > 110 else 0)
    grown = a.filter(ImageFilter.MaxFilter(px * 2 + 1)).filter(ImageFilter.GaussianBlur(0.8))
    ring = Image.new('RGBA', im.size, color + (0,))
    ring.putalpha(grown.point(lambda v: int(v * strength)))
    pad = Image.new('RGBA', im.size, (0, 0, 0, 0))
    pad.alpha_composite(ring); pad.alpha_composite(im)
    return pad
# 206: lenses = the semi-transparent pixels inside the stars
im = src('206_star_glasses.png')
px = im.load()
for y in range(im.height):
    for x in range(im.width):
        r, g, b, a = px[x, y]
        if 8 < a < 190 and b > r - 30:  # bluish glass, not glitter
            px[x, y] = (38, 22, 58, 205)
edge(im, 2, (60, 38, 8), 0.85).save(P + '206_star_glasses.png', optimize=True)
# 204
edge(src('204_monocle.png'), 2, (60, 38, 8), 0.85).save(P + '204_monocle.png', optimize=True)
# 305: band
m = src('305_earmuffs.png')
EXTRA = 440; S = 3
W, H = m.width, m.height + EXTRA
band = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
d = ImageDraw.Draw(band)
cx, rx, top, base = 320, 262, 16, EXTRA + 95
def arc(inset, width, col):
    box = [(cx - rx + inset) * S, (top + inset) * S, (cx + rx - inset) * S, (2 * base - top - inset) * S]
    d.arc(box, 180, 360, fill=col, width=width * S)
arc(0, 30, (176, 22, 104, 255)); arc(3, 24, (255, 79, 163, 255)); arc(7, 6, (255, 170, 214, 255))
band = band.resize((W, H), Image.LANCZOS)
out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
out.alpha_composite(band); out.alpha_composite(m, (0, EXTRA))
out.save(P + '305_earmuffs.png', optimize=True)
for n in ['204_monocle.png', '206_star_glasses.png', '305_earmuffs.png']:
    print(n, Image.open(P + n).size, os.path.getsize(P + n))
