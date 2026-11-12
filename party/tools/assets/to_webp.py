"""Convert a game's PNG art to WebP (much lighter for 20 phones on party Wi-Fi) and remove the PNGs.

    python3 -I tools/assets/to_webp.py client/public/assets/tap client/public/assets/ninja [--dry-run]

Every game loads its art through the kit (client/src/kit/assets.ts), which asks for the slot's file
name and falls back to the same base name with another extension, so `face.png` -> `face.webp` needs
no code change. A PNG dropped in later with the original name wins over the WebP (exact name first).

Safety: the colour is lossy (quality 88) but the transparency is kept EXACTLY (lossless alpha). For
every file the script checks that the decoded alpha channel equals the original one pixel for pixel
and that the colour error on visible pixels stays small; a file that fails a check is left as PNG.
Folders are walked recursively. Only PNGs are touched; READMEs and other files are left alone.
Do not run it on client/public/assets/shimi: the avatar code names doll.png / head.png directly.
"""
import os
import sys

from PIL import Image, ImageChops

QUALITY = 88
MAX_MEAN_ERR = 3.0  # mean absolute RGB error (0-255) over pixels with alpha > 16
MAX_P99_ERR = 40  # 99th percentile of the per-pixel RGB error over those pixels


def check(src_rgba, dst_path):
    out = Image.open(dst_path).convert('RGBA')
    if out.size != src_rgba.size:
        return f'size {out.size} != {src_rgba.size}'
    a0 = src_rgba.getchannel('A')
    a1 = out.getchannel('A')
    if ImageChops.difference(a0, a1).getbbox() is not None:
        return 'alpha changed'
    mask = a0.point(lambda v: 255 if v > 16 else 0)
    diff = ImageChops.difference(src_rgba.convert('RGB'), out.convert('RGB')).convert('L')
    hist = diff.histogram(mask)
    n = sum(hist)
    if n == 0:
        return None
    mean = sum(i * c for i, c in enumerate(hist)) / n
    acc, p99 = 0, 0
    for i, c in enumerate(hist):
        acc += c
        if acc >= 0.99 * n:
            p99 = i
            break
    if mean > MAX_MEAN_ERR or p99 > MAX_P99_ERR:
        return f'colour error mean {mean:.2f} p99 {p99}'
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    if not args:
        sys.exit(__doc__)
    before = after = 0
    kept = []
    for root in args:
        if os.path.normpath(root).endswith(os.path.join('assets', 'shimi')):
            sys.exit('refusing: the avatar code names files in assets/shimi directly')
        for dirpath, _dirs, names in os.walk(root):
            for name in sorted(names):
                if not name.lower().endswith('.png'):
                    continue
                src = os.path.join(dirpath, name)
                dst = os.path.splitext(src)[0] + '.webp'
                if os.path.exists(dst):
                    kept.append((src, 'a .webp with that name already exists'))
                    continue
                im = Image.open(src)
                im.load()
                rgba = im.convert('RGBA')
                size0 = os.path.getsize(src)
                rgba.save(dst, 'WEBP', quality=QUALITY, method=6, alpha_quality=100, exact=True)
                problem = check(rgba, dst)
                size1 = os.path.getsize(dst)
                if problem is not None or size1 >= size0:
                    os.remove(dst)
                    kept.append((src, problem or f'webp not smaller ({size1} >= {size0})'))
                    continue
                before += size0
                after += size1
                if dry:
                    os.remove(dst)
                else:
                    os.remove(src)
                print(f'{src}: {size0 // 1024} KB -> {size1 // 1024} KB')
    print(f'total {before / 1e6:.2f} MB -> {after / 1e6:.2f} MB' + (' (dry run, nothing changed)' if dry else ''))
    for src, why in kept:
        print(f'KEPT AS PNG {src}: {why}')


if __name__ == '__main__':
    main()
