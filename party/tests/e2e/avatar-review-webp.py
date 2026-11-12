# Builds the shipped avatar pictures (python3 -I tests/e2e/avatar-review-webp.py [quality]).
#   client/public/assets/shimi/prop_NN_*.png (the owner's 17, left alone: other screens use them)
#   client/src/avatar/art-src/NNN_*.png      (PNG sources of the new accessories, not shipped)
#     ->  client/public/assets/shimi/props/<same name>.webp   (what catalog*.ts points at)
import glob, os, re, sys
from PIL import Image
ROOT = os.path.dirname(os.path.abspath(__file__)) + '/../../'
OUT = ROOT + 'client/public/assets/shimi/props/'
Q = int(sys.argv[1]) if len(sys.argv) > 1 else 86
MAX = 640  # long side
# a picture never needs more pixels than 1.5x its width on the 483 px doll (sharp in the dressing room at 3x)
CAT = ''.join(open(f, encoding='utf8').read() for f in glob.glob(ROOT + 'client/src/avatar/catalog*.ts'))
WIDTH = {m.group(1): float(m.group(2)) for m in re.finditer(r"file: '/assets/shimi/props/([\w.]+)',\s+place: \[[-\d.]+, [-\d.]+, ([\d.]+),", CAT)}
before = after = 0
for src in sorted(glob.glob(ROOT + 'client/public/assets/shimi/prop_*.png') + glob.glob(ROOT + 'client/src/avatar/art-src/*.png')):
    im = Image.open(src).convert('RGBA')
    name = os.path.basename(src).replace('prop_', '').replace('.png', '.webp')
    k = min(1, MAX / max(im.size), WIDTH[name] / 100 * 483 * 1.5 / im.width)
    if k < 1:
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    im.save(OUT + name, 'WEBP', quality=Q, alpha_quality=100, method=4)
    before += os.path.getsize(src); after += os.path.getsize(OUT + name)
    print(f'{name:32s} {im.width}x{im.height} {os.path.getsize(src):7d} -> {os.path.getsize(OUT + name):6d}')
print('total', before, '->', after)
