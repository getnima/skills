"""Shape the generated eye patch for the doll (avatar-face).

python3 -I tests/e2e/avatar-face-patch.py <original.png> <prepared.png>
then: avatar-face-cut.py <prepared.png> <cut.png>, then: avatar-face-patch.py --rotate <cut.png> <out.png> [angle]
(--rotate with an angle also tilts any other cut picture: the party blower)

The generator drew the patch on a straight horizontal cord that runs off both edges of the picture.
On the doll the cord must run from the ear (short end, left) diagonally up across the forehead to the far
side of the head (long end, right). Step 1 lengthens the right end by repeating a slice of the cord,
shortens the left end, thickens the cord (so it still reads at icon size) and puts a white margin around
everything so the background cut can flood round it. Step 2 (--rotate) tilts the cut picture so the long
end rises by ANGLE degrees, and crops it tight.
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

PATCH_X0, PATCH_X1 = 367, 656   # patch columns in the 1024 px original
CORD_Y = 511                    # cord row at the patch
LEFT = 390                      # cord kept left of the patch centre (px of the original)
RIGHT = 860                     # cord kept right of the patch centre
ANGLE = 24
MARGIN = 40


def prepare(src, dst):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    cx = (PATCH_X0 + PATCH_X1) // 2
    canvas = Image.new('RGB', (w + RIGHT, h), (255, 255, 255))
    canvas.paste(im, (0, 0))
    # lengthen the right end: repeat a 120 px slice of cord (columns 860..980), rows near the cord only
    band = im.crop((860, CORD_Y - 30, 980, CORD_Y + 30))
    for x in range(w - 50, w + RIGHT, 120):
        canvas.paste(band, (x, CORD_Y - 30))
    canvas = canvas.crop((cx - LEFT, 0, cx + RIGHT, h))
    # thicken the cord outside the patch (a min filter over the cord rows)
    arr = np.asarray(canvas).copy()
    thick = np.asarray(canvas.filter(ImageFilter.MinFilter(5)))
    px0, px1 = PATCH_X0 - (cx - LEFT) - 6, PATCH_X1 - (cx - LEFT) + 6
    rows = slice(CORD_Y - 22, CORD_Y + 22)
    arr[rows, :px0] = thick[rows, :px0]
    arr[rows, px1:] = thick[rows, px1:]
    out = Image.fromarray(arr)
    framed = Image.new('RGB', (out.size[0] + 2 * MARGIN, out.size[1]), (255, 255, 255))
    framed.paste(out, (MARGIN, 0))
    framed.save(dst)
    print(dst, framed.size, 'patch centre x in prepared:', LEFT + MARGIN)


def rotate(src, dst, angle=ANGLE):
    pic = Image.open(src).convert('RGBA')
    big = pic.resize((pic.size[0] * 2, pic.size[1] * 2), Image.LANCZOS)
    rot = big.rotate(angle, resample=Image.BICUBIC, expand=True)
    rot = rot.crop(rot.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    k = 640 / max(rot.size)
    rot = rot.resize((round(rot.size[0] * k), round(rot.size[1] * k)), Image.LANCZOS)
    rot.save(dst, optimize=True)
    tw, th = rot.size
    chk = Image.new('RGB', (tw * 2 + 30, th + 20), (24, 24, 32))
    chk.paste((255, 210, 31), (tw + 15, 0, tw * 2 + 30, th + 20))
    chk.paste(rot, (8, 10), rot)
    chk.paste(rot, (tw + 22, 10), rot)
    chk.save(dst.replace('.png', '') + '_check.png')
    print(dst, rot.size)


if __name__ == '__main__':
    if sys.argv[1] == '--rotate':
        rotate(sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else ANGLE)
    else:
        prepare(sys.argv[1], sys.argv[2])
