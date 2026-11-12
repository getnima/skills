"""Normalise the hero's cut-out frames into one sprite box (same scale, one anchor, feet on one baseline).

python3 -I tests/e2e/icy-art-hero.py <originals dir> <out dir> [--strip strip.png]

Input: the remove_background results of the generated poses (896 x 1200, transparent), listed in FRAMES.
Output: one 256 x 256 WebP per frame. The anchor is the same in every frame:
  x = 128 (the middle of the box): the figure's centre of mass sits on it, so mirroring for "facing left"
      and the spin do not shift the figure;
  y = 236 (BASELINE): the ground line. Ground frames (stand, run) put their lowest boot pixel on it. Air
      frames (jump, fall) keep the jacket at the height it has when standing, so the legs tuck up from the
      ground instead of the body dropping; the ball's centre of mass sits on the spin pivot (PIVOT px above
      the baseline).
Scale: the standing figure is STAND_H px tall; every other frame is brought to the same head size with the
factor in FRAMES (hat top to chin, measured on the generated pictures).

Head swap (HEAD_FROM): the two run frames came out with the head at different angles (three-quarter and
full profile), which would flick at every stride. A frame listed there gets the head of another frame
(hat, hair and face down to the chin, cut along the scarf) pasted chin on chin, so the head is the very same
picture in both strides and only the body changes.
"""
import argparse
import os

import numpy as np
from PIL import Image

BOX = 256
BASELINE = 236
STAND_H = 200
PIVOT = 87

# name, source file, head-size factor against the standing frame, kind
FRAMES = [
    ('stand', 'hero_stand_a_rmbg.png', 1.0, 'ground'),
    ('run1', 'hero_run1_a_rmbg.png', 1.02, 'ground'),
    ('run2', 'hero_run2_b_rmbg.png', 1.05, 'ground'),
    ('jump', 'hero_jump_a_rmbg.png', 1.06, 'air'),
    ('fall', 'hero_fall_a_rmbg.png', 1.17, 'air'),
    ('ball', 'hero_ball_a_rmbg.png', 1.0, 'ball'),
]


# frame -> the frame whose head it wears
HEAD_FROM = {'run2': 'run1'}


def reconstruct(seed, mask):
    def grow(m):
        out = m.copy()
        out[1:] |= m[:-1]
        out[:-1] |= m[1:]
        out[:, 1:] |= m[:, :-1]
        out[:, :-1] |= m[:, 1:]
        return out & mask

    cur = seed & mask
    while True:
        nxt = cur
        for _ in range(16):
            nxt = grow(nxt)
        if (nxt == cur).all():
            return cur
        cur = nxt


def head_of(px):
    """(mask of the head: hat, hair, face down to the chin; chin x, chin y)."""
    r, g, b, al = px[:, :, 0], px[:, :, 1], px[:, :, 2], px[:, :, 3]
    opaque = al > 100
    yellow = opaque & (r > 165) & (g > 120) & (b < 125) & (r - b > 80)
    skin = opaque & (r > 120) & (g > r * 0.52) & (g < r * 0.76) & (b > r * 0.36) & (b < r * 0.66) & (r - b > 40) & (r < 235)
    hair = opaque & (np.maximum(np.maximum(r, g), b) < 80)
    hy, _ = np.nonzero(hair)
    # the face is the skin next to the hair, above the scarf: rows with plenty of skin, down to the last one
    rows = skin.sum(axis=1)
    top = int(np.percentile(hy, 5))
    ys = np.nonzero(rows >= 22)[0]
    ys = ys[ys >= top]
    # stop at the first gap (the mittens are below, they are yellow anyway)
    chin = int(ys[0])
    for y in ys:
        if y - chin > 6:
            break
        chin = int(y)
    xs = np.nonzero(skin[chin - 8 : chin + 1].any(axis=0))[0]
    chin_x = float(np.median(xs))
    ok = opaque & ~yellow
    ok[chin + 1 :] = False
    seed = np.zeros_like(ok)
    fy, fx = np.nonzero(skin & ok)
    seed[int(np.median(fy)), int(np.median(fx))] = True
    seed &= ok
    if not seed.any():
        seed[fy[len(fy) // 2], fx[len(fx) // 2]] = True
    return reconstruct(seed, ok), chin_x, float(chin)


def swap_head(px, donor, ratio, sink=5.0):
    """`px` with its head removed and the donor frame's head (scaled by `ratio`) pasted chin on chin."""
    mask, cx, cy = head_of(px)
    dmask, dcx, dcy = head_of(donor)
    out = px.copy()
    # take the old head away (a little wider, so no rim of it is left)
    wide = mask.copy()
    for _ in range(2):
        g = wide.copy()
        g[1:] |= wide[:-1]
        g[:-1] |= wide[1:]
        g[:, 1:] |= wide[:, :-1]
        g[:, :-1] |= wide[:, 1:]
        wide = g
    wide[int(cy) + 1 :] = False
    out[wide, 3] = 0
    ys, xs = np.nonzero(dmask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    cut = donor[y0:y1, x0:x1].copy()
    cut[~dmask[y0:y1, x0:x1], 3] = 0
    head = Image.fromarray(np.clip(cut, 0, 255).astype(np.uint8), 'RGBA')
    head = head.resize((round(head.size[0] * ratio), round(head.size[1] * ratio)), Image.LANCZOS)
    base = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA')
    ox = round(cx - (dcx - x0) * ratio)
    oy = round(cy + sink - (dcy - y0) * ratio)
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    layer.paste(head, (ox, oy), head)
    # the head goes BEHIND what is left in front of it at the neck? no: the chin sits over the scarf
    base.alpha_composite(layer)
    return np.asarray(base).astype(np.float32)


def load(path):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)
    # the remover leaves a faint haze here and there: drop it, keep the soft edge
    al = a[:, :, 3]
    al = np.where(al < 24, 0, al)
    a[:, :, 3] = al
    return a


def jacket_y(a):
    r, g, b, al = a[:, :, 0], a[:, :, 1], a[:, :, 2], a[:, :, 3]
    red = (al > 128) & (r > 150) & (g < r * 0.42) & (b < r * 0.42)
    ys, _ = np.nonzero(red)
    # the hat is red too: the jacket is the lower red mass
    return float(np.median(ys[ys > np.percentile(ys, 30)]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--strip', default='')
    ap.add_argument('--quality', type=int, default=88)
    ap.add_argument('--no-head-swap', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.dst, exist_ok=True)

    stand = load(os.path.join(a.src, FRAMES[0][1]))
    ys, xs = np.nonzero(stand[:, :, 3] > 128)
    stand_h = ys.max() - ys.min() + 1
    base_k = STAND_H / stand_h
    stand_jacket = (ys.max() - jacket_y(stand)) * base_k  # px above the baseline, in the box
    out = []
    raw = {name: load(os.path.join(a.src, file)) for name, file, _f, _k in FRAMES}
    factors = {name: factor for name, _file, factor, _k in FRAMES}
    for name, file, factor, kind in FRAMES:
        px = raw[name]
        if name in HEAD_FROM and not a.no_head_swap:
            src_name = HEAD_FROM[name]
            px = swap_head(px, raw[src_name], factors[src_name] / factor)
        al = px[:, :, 3]
        ys, xs = np.nonzero(al > 128)
        k = base_k * factor
        w = al / 255
        cx = float((w.sum(axis=0) * np.arange(al.shape[1])).sum() / w.sum())
        cy = float((w.sum(axis=1) * np.arange(al.shape[0])).sum() / w.sum())
        if kind == 'ground':
            ay = float(ys.max())  # lowest boot pixel on the baseline
        elif kind == 'air':
            ay = jacket_y(px) + stand_jacket / k
        else:
            ay = cy + PIVOT / k
        img = Image.fromarray(np.clip(px, 0, 255).astype(np.uint8), 'RGBA')
        sw, sh = round(img.size[0] * k), round(img.size[1] * k)
        img = img.resize((sw, sh), Image.LANCZOS)
        box = Image.new('RGBA', (BOX, BOX), (0, 0, 0, 0))
        ox, oy = round(BOX / 2 - cx * k), round(BASELINE - ay * k)
        box.alpha_composite(img, (ox, oy)) if (ox >= 0 and oy >= 0) else box.paste(img, (ox, oy), img)
        bb = box.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
        clipped = ox < 0 or oy < 0 or ox + sw > BOX or oy + sh > BOX
        box.save(os.path.join(a.dst, f'{name}.webp'), quality=a.quality, method=6)
        size = os.path.getsize(os.path.join(a.dst, f'{name}.webp'))
        print(f'{name}: scale {k:.4f} bbox {bb} drawn {bb[2] - bb[0]}x{bb[3] - bb[1]} bytes {size}{" CLIPPED?" if clipped and (bb[0] == 0 or bb[1] == 0 or bb[2] == BOX or bb[3] == BOX) else ""}')
        out.append((name, box))

    if a.strip:
        cols = [(20, 44, 156), (60, 74, 110)]
        strip = Image.new('RGB', (BOX * len(out), BOX * 2 + 100), (20, 44, 156))
        for i, (name, box) in enumerate(out):
            for r, c in enumerate(cols):
                strip.paste(c, (i * BOX, r * BOX, (i + 1) * BOX, (r + 1) * BOX))
                strip.paste(box, (i * BOX, r * BOX), box)
            # baseline + anchor marks on the second row
            for x in range(i * BOX, (i + 1) * BOX, 6):
                strip.putpixel((x, BOX + BASELINE), (255, 210, 31))
            for y in range(BOX, BOX * 2, 6):
                strip.putpixel((i * BOX + BOX // 2, y), (255, 210, 31))
            # drawn size on a phone (about 74 px tall standing): 0.37 of the box
            small = box.resize((round(BOX * 0.37), round(BOX * 0.37)), Image.LANCZOS)
            strip.paste(small, (i * BOX + 80, BOX * 2 + 2), small)
        strip.save(a.strip)


if __name__ == '__main__':
    main()
