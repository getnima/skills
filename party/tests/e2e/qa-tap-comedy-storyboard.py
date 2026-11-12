"""One storyboard sheet of a whole tap round from the burst screenshots of qa-tap-comedy-shots.cjs.

    python3 tests/e2e/qa-tap-comedy-storyboard.py SHOTS_LOG [SIZE]

SHOTS_LOG is the stdout of `node tests/e2e/qa-tap-comedy-shots.cjs SIZE all` (it names every shot and the
tap count when it was taken). Writes tests/e2e/out/qa-tap-comedy/storyboard.png.
"""
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out', 'qa-tap-comedy')
LOG = sys.argv[1]
SIZE = sys.argv[2] if len(sys.argv) > 2 else '390x844'

# (shot, caption) in the order of a round: the wait, the start, the sprint, the final image
ORDER = [
    ('60-wait-start', 'WAIT 0:01 tap to start'),
    ('62-wait-sneak-caught', 'WAIT sneak bit: caught'),
    ('66-countdown-5', 'WAIT 0:25 countdown 5'),
    ('68-autostart', 'AUTO-START 0:30'),
    ('02-first-tap-click', 'FIRST TAP (paparazzi)'),
    ('51-slow-nostril', 'hand at the nostril'),
    ('10-yossi', 'Yossi'),
    ('11-rope-stretch', 'the rope'),
    ('13-ear', 'out of the ear'),
    ('14-mini-slide', 'Shimi inside Shimi'),
    ('17-sneeze-burst', 'the sneeze'),
    ('18-squeegee', 'the squeegee'),
    ('20-king-pop', 'the king'),
    ('22-spin-dizzy', 'bobble overload'),
    ('24-cork-pop', 'the cork'),
    ('32-last5', 'last 5 seconds'),
    ('40-final', 'FINAL IMAGE'),
]

taps = {}
for line in open(LOG, encoding='utf-8'):
    m = re.match(r'shot (\S+): taps (\d+)', line)
    if m:
        taps[m.group(1)] = int(m.group(2))

tiles = []
for name, cap in ORDER:
    path = os.path.join(OUT, f'{SIZE}-{name}.png')
    if not os.path.exists(path):
        continue
    label = cap if name not in taps or name.startswith('6') else f'{taps[name]} taps - {cap}'
    tiles.append((path, label))

COLS = 6
TW = 300
im0 = Image.open(tiles[0][0])
TH = int(TW * im0.height / im0.width)
CAP = 34
rows = (len(tiles) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * (TW + 12) + 12, rows * (TH + CAP + 12) + 12 + 50), (22, 18, 14))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
    big = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 26)
except OSError:
    font = big = ImageFont.load_default()
draw.text((14, 12), f'Shimi tap - one round ({SIZE}): wait 30 s, sprint 20 s from the first tap, final image', fill=(255, 210, 31), font=big)
for i, (path, label) in enumerate(tiles):
    r, c = divmod(i, COLS)
    x = 12 + c * (TW + 12)
    y = 62 + r * (TH + CAP + 12)
    im = Image.open(path).convert('RGB').resize((TW, TH), Image.LANCZOS)
    sheet.paste(im, (x, y))
    draw.rectangle([x, y + TH, x + TW, y + TH + CAP], fill=(30, 63, 216))
    draw.text((x + 8, y + TH + 7), f'{i + 1}. {label}', fill=(255, 255, 255), font=font)
dst = os.path.join(OUT, 'storyboard.png')
sheet.save(dst)
print(dst, len(tiles), 'frames')
