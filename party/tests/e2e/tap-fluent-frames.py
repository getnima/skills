"""Turn the image-to-video clip of the nose pick into the tap game's picking frames.

    python3 -I tests/e2e/tap-fluent-frames.py CLIP_FRAMES_DIR OUT_DIR [K]

CLIP_FRAMES_DIR holds every frame of the clip as 001.png, 002.png ... (ffmpeg -vsync 0). The clip was made
from a 768 square input: the 512 head frame (face_normal.png framing) scaled to 680 and placed at (44, 88) on a
flat cream background (the token's disc colour), so in a 960 clip frame the head frame sits at (55, 110), 850 wide.

For every frame:
  1. the head is registered by its two ears (tracked frame to frame on edge maps, smoothed over the clip):
     the frame is turned and shifted back so the hat, hair and ears stay exactly where the other head frames
     have them; the face itself tilting back inside the head is kept (that is the motion we want);
  2. the background is colour-corrected to the disc colour (per-channel gain from the clip's corners);
  3. it is cut to the 512 framing and to the token circle (transparent outside), saved as WebP.

K frames (default 40) are kept, spaced evenly in how much the picture changes (so a crossfade between two
neighbours never shows two hands), always including the first and the last frame. Prints the clip frame number
of every kept frame (the game maps the picking depth to clip frame numbers, see CLIP in art.ts) and writes
OUT_DIR/pick_NN.webp.
"""
import math
import os
import sys

import numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2]
K = int(sys.argv[3]) if len(sys.argv) > 3 else 40
DISC = np.array([255, 246, 224], dtype=np.float32)
X0, Y0, SIDE = 55, 110, 850
N = 512
# the token circle in the 512 framing (art.ts: FRAME_TOP / FRAME_SCALE, MASK_R / FRAME_SCALE)
CX, CY, CR = N / 2, N * 0.46 / 0.96, N * 0.468 / 0.96 + 2

files = sorted(f for f in os.listdir(SRC) if f.endswith('.png'))
frames = [Image.open(os.path.join(SRC, f)).convert('RGB') for f in files]
print('frames', len(frames), frames[0].size)


def edges(a):
    gx = np.abs(np.diff(a, axis=1))[:-1, :]
    gy = np.abs(np.diff(a, axis=0))[:, :-1]
    return gx + gy


grays = [np.asarray(f.convert('L'), dtype=np.float32) for f in frames]
# The two ears are rigid and never covered by the hand: tracked frame to frame, they give the roll and the
# shift of the whole head (the hat and the hair stay put after the correction; the face itself tilts back
# inside the head, which is the motion we want). Points: the ears' centres in the first clip frame.
EAR_L = (110, 380, 250, 640)
EAR_R = (720, 380, 860, 640)
P_L = np.array([180.0, 510.0])
P_R = np.array([790.0, 510.0])


def track(box, R=6):
    x0, y0, x1, y1 = box
    ref = edges(grays[0][y0:y1, x0:x1])
    out = []
    guess = (0, 0)
    for g in grays:
        best = None
        bs = guess
        for dy in range(guess[1] - R, guess[1] + R + 1):
            for dx in range(guess[0] - R, guess[0] + R + 1):
                v = float(np.mean(np.abs(ref - edges(g[y0 + dy:y1 + dy, x0 + dx:x1 + dx]))))
                if best is None or v < best:
                    best = v
                    bs = (dx, dy)
        guess = bs
        out.append(bs)
    return np.array(out, dtype=np.float32)


ear_l = track(EAR_L)
ear_r = track(EAR_R)


def smooth(a, k=9):
    pad = np.pad(a, ((k // 2, k // 2), (0, 0)), mode='edge')
    return np.stack([np.convolve(pad[:, i], np.ones(k) / k, mode='valid') for i in range(a.shape[1])], axis=1)


ear_l = smooth(ear_l)
ear_r = smooth(ear_r)
print('ears drift (first, middle, last):', ear_l[0].tolist(), ear_r[0].tolist(), '|', ear_l[-1].round(1).tolist(), ear_r[-1].round(1).tolist())


def warp(i):
    """Frame i moved back so its ears sit where they are in frame 0 (rotation + shift, no scale)."""
    q_l = P_L + ear_l[i]
    q_r = P_R + ear_r[i]
    ang = math.atan2(q_r[1] - q_l[1], q_r[0] - q_l[0])
    m_q = (q_l + q_r) / 2
    m_p = (P_L + P_R) / 2
    ca, sa = math.cos(ang), math.sin(ang)
    coeffs = (ca, -sa, m_q[0] - ca * m_p[0] + sa * m_p[1], sa, ca, m_q[1] - sa * m_p[0] - ca * m_p[1])
    return frames[i].transform(frames[i].size, Image.AFFINE, coeffs, Image.BICUBIC, fillcolor=tuple(int(v) for v in DISC))

# background colour per frame (corners of the clip, outside the head)
def bg_of(a):
    pts = np.concatenate([a[10:120, 10:120].reshape(-1, 3), a[10:120, -120:-10].reshape(-1, 3)])
    return np.median(pts, axis=0)


yy, xx = np.mgrid[0:N, 0:N]
dist = np.hypot(xx + 0.5 - CX, yy + 0.5 - CY)
alpha = np.clip(CR - dist + 0.5, 0, 1)


def cut(i):
    a = np.asarray(frames[i], dtype=np.float32)
    gain = DISC / np.maximum(1, bg_of(a))
    im = warp(i).resize((N, N), Image.LANCZOS, box=(X0, Y0, X0 + SIDE, Y0 + SIDE))
    b = np.clip(np.asarray(im, dtype=np.float32) * gain, 0, 255)
    rgba = np.dstack([b, alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


# change between consecutive frames, inside the circle, after the crop (small, fast)
small = []
for i in range(len(frames)):
    im = cut(i).resize((128, 128), Image.BILINEAR)
    small.append(np.asarray(im, dtype=np.float32)[:, :, :3])
def change(a, b):
    # the mean of the 5% most changed pixels: a moving hand counts as much as the whole face changing
    d = np.abs(a - b).max(axis=2).ravel()
    n = max(1, d.size // 20)
    return float(np.mean(np.partition(d, -n)[-n:]))


mot = [0.0] + [change(small[i], small[i - 1]) for i in range(1, len(small))]
cum = np.cumsum(mot)
targets = np.linspace(0, cum[-1], K)
keep = []
for t in targets:
    i = int(np.argmin(np.abs(cum - t)))
    if not keep or i > keep[-1]:
        keep.append(i)
if keep[-1] != len(frames) - 1:
    keep.append(len(frames) - 1)
print('kept', len(keep), 'clip frames:', keep)

os.makedirs(OUT, exist_ok=True)
total = 0
for n, i in enumerate(keep):
    p = os.path.join(OUT, f'pick_{n:02d}.webp')
    cut(i).save(p, 'WEBP', quality=80, method=6, alpha_quality=60)
    total += os.path.getsize(p)
print('total bytes', total, 'avg', total // len(keep))
