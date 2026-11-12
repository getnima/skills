"""Re-make every shipped hat picture from the kept originals, with the settings each one needed.

python3 -I tests/e2e/avatar-hats-cutall.py   (run from /home/user/skills/party)

Originals (the untouched generations, and the two remove_background results) live in
tests/e2e/out/avatar-hats/originals/ and are not shipped.
"""
import os
import subprocess
import sys

from PIL import Image

O = 'tests/e2e/out/avatar-hats'
P = 'client/public/assets/shimi/props'
MAX = '480'
NOHOLES = ['--holes', '100000000']

JOBS = [
    ('101_halo', '101_halo.png', ['--tol', '34', '--holes', '12']),
    ('102_devil_horns', None, ['--tol', '24']),  # top 560 rows only (the headband legs hide in the hair)
    ('103_chef_hat', '103_chef_hat_rembg.png', ['--keep-alpha', *NOHOLES]),
    ('104_cowboy_hat', '104_cowboy_hat.png', ['--tol', '60', '--grey', '16,110']),
    ('105_graduation_cap', '105_graduation_cap.png', ['--tol', '40', '--grey', '14,150', *NOHOLES]),
    ('106_wizard_hat', '106_wizard_hat.png', ['--tol', '40', '--grey', '14,150', *NOHOLES]),
    ('107_pompom_beanie', '107_pompom_beanie.png', ['--tol', '18', *NOHOLES]),
    ('108_fez', '108_fez.png', ['--tol', '40', '--grey', '14,150', *NOHOLES]),
    ('109_flower_crown', '109_flower_crown.png', ['--tol', '45', '--grey', '24,160', '--holes', '30', '--peel', '40,140,42']),
    ('110_watermelon_helmet', '110_watermelon_helmet.png', ['--tol', '12', *NOHOLES]),
    ('111_propeller_cap', '111_propeller_cap.png', ['--tol', '40', '--grey', '14,150', *NOHOLES]),
    ('112_traffic_cone', '112_traffic_cone_rembg.png', ['--keep-alpha', *NOHOLES]),
]

os.makedirs(f'{O}/work', exist_ok=True)
Image.open(f'{O}/originals/102_devil_horns.png').crop((0, 0, 1024, 560)).save(f'{O}/work/102_top.png')
for name, src, args in JOBS:
    src_path = f'{O}/work/102_top.png' if src is None else f'{O}/originals/{src}'
    cmd = [sys.executable, '-I', 'tests/e2e/avatar-hats-cut.py', src_path, f'{P}/{name}.png', '--max', MAX,
           '--quantize', '--check', f'{O}/work/{name}_check.png', *args]
    subprocess.run(cmd, check=True)
