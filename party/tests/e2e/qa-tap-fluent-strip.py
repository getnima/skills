"""The strip of the fluent nose pick and the 4 s recording, from tests/e2e/qa-tap-fluent.cjs.

    python3 -I tests/e2e/qa-tap-fluent-strip.py

Reads tests/e2e/out/tap-fluent/strip.json + strip-NN.png and writes strip.png (the token at rising tap rates,
each labelled with the rate, the depth and the clip frame). If picking.json and the recorded frames (rec/NNN.png) are
there, makes picking.webp (animated, 390 px wide, 25 fps) with ffmpeg.
"""
import json
import os
import subprocess

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out', 'tap-fluent')

try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 17)
    big = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 24)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
except OSError:
    font = big = small = ImageFont.load_default()

shots = json.load(open(os.path.join(OUT, 'strip.json'), encoding='utf-8'))
TW = 230
COLS = len(shots) if len(shots) <= 7 else (len(shots) + 1) // 2
rows = (len(shots) + COLS - 1) // COLS
CAP = 62
sheet = Image.new('RGB', (COLS * (TW + 10) + 10, rows * (TW + CAP + 10) + 56), (22, 18, 14))
draw = ImageDraw.Draw(sheet)
draw.text((12, 14), 'Shimi tap: the hand goes in as the tap rate rises (1.5 -> 12 taps/s), then the player stops', fill=(255, 210, 31), font=big)
for i, s in enumerate(shots):
    r, c = divmod(i, COLS)
    x = 10 + c * (TW + 10)
    y = 56 + r * (TW + CAP + 10)
    im = Image.open(s['file']).convert('RGB').resize((TW, TW), Image.LANCZOS)
    sheet.paste(im, (x, y))
    draw.rectangle([x, y + TW, x + TW, y + TW + CAP], fill=(30, 63, 216))
    draw.text((x + 6, y + TW + 5), f"{i + 1}. {s['label']}  ({s['rate']}/s now)", fill=(255, 255, 255), font=font)
    draw.text((x + 6, y + TW + 32), f"d {s['depth']:.2f}  clip {s['clip']:.0f}  {s['hand']}", fill=(255, 210, 31), font=small)
dst = os.path.join(OUT, 'strip.png')
sheet.save(dst)
print(dst, len(shots), 'shots')

meta = os.path.join(OUT, 'picking.json')
if os.path.exists(meta):
    m = json.load(open(meta, encoding='utf-8'))
    webp = os.path.join(OUT, 'picking.webp')
    cmd = ['ffmpeg', '-v', 'error', '-y', '-framerate', str(m['fps']), '-i', os.path.join(m['frames'], '%03d.png'),
           '-vf', 'scale=390:-1:flags=lanczos', '-c:v', 'libwebp_anim', '-loop', '0', '-quality', '72', '-lossless', '0', webp]
    subprocess.run(cmd, check=True)
    print(webp, os.path.getsize(webp) // 1024, 'KB', m['n'], 'frames')
