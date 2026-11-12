"""Make the PNG art in client/public/assets as light as it can be with no visible change.

    python3 -I tools/assets/optimize.py              convert (`npm run assets`, the first step of `npm run build`)
    python3 -I tools/assets/optimize.py --check      convert nothing; list what would change, exit 1 if anything would
    python3 -I tools/assets/optimize.py --dry-run    encode and measure everything, change nothing
    python3 -I tools/assets/optimize.py --report F   also write the per-file numbers to F (JSON)

Each PNG under client/public/assets becomes a WebP of the same name next to it, and the PNG is
removed (git history keeps the original). Code needs no change: the kit asks for a slot by name
(kit/files.ts findPublicFile) and takes the same base name with another extension, so a slot named
`face.png` finds `face.webp`. A file named LITERALLY by its full public URL somewhere in client/
(e.g. '/assets/shimi/doll.png' in the avatar catalog) is left alone and reported: change the
reference to .webp, then run this again.

How a file is encoded (quality first, then bytes):
  * lossless WebP, and lossy WebP (method 6, alpha kept EXACT: alpha_quality 100) at a few qualities;
  * a lossy one counts only when it is visually lossless against the PNG: PSNR on the colour
    composited over white AND over black >= 42 dB on the visible pixels, no 32x32 block of the
    picture under 36 dB (catches a local smear a global average would hide), alpha error 0;
  * the smallest candidate that passes wins (lossless always passes);
  * the PNG stays when WebP saves less than 10 % (or under 2 KB). It is then recorded in
    tools/assets/optimize-kept.json with its hash, so the next build does not try it again.
Pixel sizes are never changed. client/public/icons is never touched (the web manifest and iOS want
PNG icons), nor any WebP / JPEG (already lossy: re-encoding would only lose more), nor video or audio.

SOURCES below are converted losslessly only: they are the originals another script builds from.
Runs on Python 3 with Pillow (with WebP support); without Pillow it says so and exits 3, and the
build goes on with the art as it is.
"""
import fnmatch
import hashlib
import io
import json
import math
import os
import re
import sys
import tempfile

try:
    from PIL import Image, ImageChops, features
except ImportError:  # pragma: no cover - depends on the machine
    print('[assets] Pillow is not installed (pip3 install pillow): the art is left as it is')
    sys.exit(3)

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
PUBLIC = os.path.join(ROOT, 'client', 'public')
ASSETS = os.path.join(PUBLIC, 'assets')
KEPT_FILE = os.path.join(ROOT, 'tools', 'assets', 'optimize-kept.json')

PSNR_MIN = 42.0
BLOCK_MIN = 36.0
BLOCK = 32
GAIN_MIN = 0.10
GAIN_MIN_BYTES = 2048
# lossy qualities, tried from the middle out (PSNR is not monotonic in quality, so a few around the pass mark)
QUALITIES = (80, 84, 86, 88, 90, 92, 94, 96, 98)
FIRST_Q = 90

# Originals another script builds from (tests/e2e/avatar-review-webp.py makes shimi/props/*.webp from
# them): lossless only, so a rebuild starts from the very same pixels.
SOURCES = ('shimi/prop_*.png',)


def rel(path):
    return os.path.relpath(path, PUBLIC).replace(os.sep, '/')


def sha1(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()


def load_kept():
    try:
        with open(KEPT_FILE, encoding='utf8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def literal_refs():
    """Every client file's text, to find art named by its full public URL."""
    out = []
    for base, exts in ((os.path.join(ROOT, 'client', 'src'), ('.ts', '.tsx', '.css', '.html')), (os.path.join(ROOT, 'client'), ('.html',)), (PUBLIC, ('.webmanifest', '.json'))):
        deep = base.endswith('src')
        for dirpath, dirs, names in os.walk(base):
            if not deep:
                dirs[:] = []
            for n in names:
                if n.endswith(exts):
                    p = os.path.join(dirpath, n)
                    try:
                        with open(p, encoding='utf8') as f:
                            out.append((os.path.relpath(p, ROOT), f.read()))
                    except (OSError, UnicodeDecodeError):
                        pass
    return out


def named_in(url, texts):
    """Files that name `url` as a string literal or a CSS url(), other than as the first argument of
    findPublicFile() (which finds the same base name with another extension). Comments do not count."""
    pat = re.compile(r'''(findPublicFile\(\s*)?(?:['"`]|url\(\s*['"]?)''' + re.escape(url) + r'''(?=['"`)?#])''')
    return [name for name, text in texts if any(m.group(1) is None for m in pat.finditer(text))]


# ───────────────────────────── measuring ─────────────────────────────


def visible_mask(a, b):
    """255 where either picture has any alpha."""
    return ImageChops.lighter(a.getchannel('A'), b.getchannel('A')).point(lambda v: 255 if v > 0 else 0)


def sq_err(diff_rgb, mask):
    """(sum of squared errors over the 3 channels, pixel count) under the mask."""
    total = 0
    n = 0
    for band in diff_rgb.split():
        h = band.histogram(mask)
        total += sum(c * i * i for i, c in enumerate(h))
        n = sum(h)
    return total, n


def psnr(total, n):
    if n == 0 or total == 0:
        return 99.0
    mse = total / (3 * n)
    return 10 * math.log10(255 * 255 / mse)


def compare(src, out):
    """src/out RGBA: (global PSNR over white, over black, worst block PSNR, max alpha error)."""
    mask = visible_mask(src, out)
    res = []
    worst = 99.0
    for bg in ((255, 255, 255, 255), (0, 0, 0, 255)):
        back = Image.new('RGBA', src.size, bg)
        diff = ImageChops.difference(Image.alpha_composite(back, src).convert('RGB'), Image.alpha_composite(back, out).convert('RGB'))
        res.append(psnr(*sq_err(diff, mask)))
        w, h = src.size
        for y in range(0, h, BLOCK):
            for x in range(0, w, BLOCK):
                box = (x, y, min(w, x + BLOCK), min(h, y + BLOCK))
                m = mask.crop(box)
                seen = m.histogram()[255]
                if seen * 4 < (box[2] - box[0]) * (box[3] - box[1]):
                    continue
                worst = min(worst, psnr(*sq_err(diff.crop(box), m)))
    amax = ImageChops.difference(src.getchannel('A'), out.getchannel('A')).getextrema()[1]
    return res[0], res[1], worst, amax


def encode(im, **kw):
    buf = io.BytesIO()
    im.save(buf, 'WEBP', **kw)
    data = buf.getvalue()
    dec = Image.open(io.BytesIO(data))
    dec.load()
    return data, dec.convert('RGBA')


def passes(m):
    return m[0] >= PSNR_MIN and m[1] >= PSNR_MIN and m[2] >= BLOCK_MIN and m[3] == 0


def best_webp(src, lossless_only):
    """(bytes, info) of the smallest candidate that passes."""
    rgba = src.convert('RGBA')
    has_alpha = rgba.getchannel('A').getextrema()[0] < 255
    im = rgba if has_alpha else src.convert('RGB')
    data, dec = encode(im, lossless=True, quality=100, method=6)
    m = compare(rgba, dec)
    if not (m[3] == 0 and m[0] >= 99 and m[1] >= 99):
        raise RuntimeError(f'lossless WebP is not exact (psnr {m[0]:.1f}/{m[1]:.1f}, alpha {m[3]})')
    best = (data, {'mode': 'lossless', 'psnr_white': None, 'psnr_black': None, 'block_min': None, 'alpha_err': 0})
    tried = {}
    if lossless_only:
        return best, tried

    def lossy(q):
        if q not in tried:
            d, o = encode(im, quality=q, method=6, alpha_quality=100)
            tried[q] = (d, compare(rgba, o))
        return tried[q]

    i = QUALITIES.index(FIRST_Q)
    if passes(lossy(QUALITIES[i])[1]):
        # step down while it still passes
        j = i - 1
        while j >= 0 and passes(lossy(QUALITIES[j])[1]):
            j -= 1
    else:
        # step up to the first quality that passes
        j = i + 1
        while j < len(QUALITIES) and not passes(lossy(QUALITIES[j])[1]):
            j += 1
    for q, (d, mm) in tried.items():
        if passes(mm) and len(d) < len(best[0]):
            best = (d, {'mode': f'lossy q{q}', 'psnr_white': round(mm[0], 2), 'psnr_black': round(mm[1], 2), 'block_min': round(mm[2], 2), 'alpha_err': mm[3]})
    return best, {q: {'bytes': len(d), 'psnr_white': round(mm[0], 2), 'block_min': round(mm[2], 2), 'pass': passes(mm)} for q, (d, mm) in sorted(tried.items())}


def work(job):
    """Runs in a worker: encode and measure one PNG. Returns a result dict (writes nothing)."""
    path, lossless_only = job
    try:
        src = Image.open(path)
        src.load()
        (data, info), tried = best_webp(src, lossless_only)
        return {'path': path, 'size': list(src.size), 'png': os.path.getsize(path), 'webp': len(data), 'data': data, 'info': info, 'tried': tried}
    except Exception as err:  # a broken file is reported, never fatal
        return {'path': path, 'error': f'{type(err).__name__}: {err}'}


def main():
    argv = sys.argv[1:]
    check = '--check' in argv
    dry = '--dry-run' in argv or check
    report_path = None
    if '--report' in argv:
        k = argv.index('--report')
        report_path = argv[k + 1] if k + 1 < len(argv) else None
    if not features.check('webp'):
        print('[assets] this Pillow has no WebP support: the art is left as it is')
        sys.exit(3)
    kept = load_kept()
    texts = literal_refs()
    jobs, notes = [], []
    for dirpath, dirs, names in os.walk(ASSETS):
        dirs.sort()
        for name in sorted(names):
            if not name.lower().endswith('.png'):
                continue
            path = os.path.join(dirpath, name)
            r = rel(path)
            webp = os.path.splitext(path)[0] + '.webp'
            if os.path.exists(webp):
                notes.append(f'SKIP {r}: {rel(webp)} already exists (two pictures for one slot: remove one)')
                continue
            refs = named_in('/' + r, texts)
            if refs:
                notes.append(f'SKIP {r}: named literally in {", ".join(refs)} (point it at .webp, then run again)')
                continue
            if kept.get(r, {}).get('sha1') == sha1(path):
                continue
            lossless_only = any(fnmatch.fnmatch(r[len('assets/'):], pat) for pat in SOURCES)
            jobs.append((path, lossless_only))
    if not jobs:
        for n in notes:
            print('[assets]', n)
        print('[assets] nothing to convert')
        return 0
    if check:
        for p, _ in jobs:
            print(f'[assets] would convert {rel(p)}')
        for n in notes:
            print('[assets]', n)
        return 1
    print(f'[assets] {len(jobs)} PNG file(s) to look at (a big one takes a few seconds)')
    procs = max(1, min(len(jobs), os.cpu_count() or 1, 6))
    if procs > 1:
        import multiprocessing

        with multiprocessing.Pool(procs) as pool:
            results = pool.map(work, jobs, chunksize=1)
    else:
        results = [work(j) for j in jobs]
    report = []
    before = after = 0
    for res in results:
        path = res['path']
        r = rel(path)
        if 'error' in res:
            print(f'[assets] KEPT {r}: could not be read or encoded ({res["error"]})')
            continue
        png, webp, info = res['png'], res['webp'], res['info']
        entry = {'file': r, 'size': res['size'], 'png': png, 'webp': webp, **info, 'tried': res['tried']}
        if png - webp < max(GAIN_MIN_BYTES, png * GAIN_MIN):
            entry['kept'] = True
            print(f'[assets] KEPT {r}: WebP {webp} bytes is not meaningfully smaller than the PNG ({png})')
            if not dry:
                kept[r] = {'sha1': sha1(path), 'why': f'webp {webp} vs png {png} bytes'}
            report.append(entry)
            continue
        out = os.path.splitext(path)[0] + '.webp'
        if not dry:
            fd, tmp = tempfile.mkstemp(prefix='.optimize-', suffix='.webp', dir=os.path.dirname(path))
            with os.fdopen(fd, 'wb') as f:
                f.write(res['data'])
            os.chmod(tmp, 0o644)
            os.replace(tmp, out)
            os.remove(path)
            kept.pop(r, None)
        before += png
        after += webp
        q = info['mode'] if info['mode'] == 'lossless' else f'{info["mode"]} psnr {info["psnr_white"]:.1f} dB, worst block {info["block_min"]:.1f} dB'
        print(f'[assets] {r} {res["size"][0]}x{res["size"][1]}: {png // 1024} KB -> {webp // 1024} KB webp ({q})')
        report.append(entry)
    for n in notes:
        print('[assets]', n)
    if before:
        print(f'[assets] {before / 1e6:.2f} MB of PNG -> {after / 1e6:.2f} MB of WebP' + (' (dry run: nothing changed)' if dry else ''))
    if not dry and (kept or os.path.exists(KEPT_FILE)):
        with open(KEPT_FILE, 'w', encoding='utf8') as f:
            json.dump(dict(sorted(kept.items())), f, indent=1)
            f.write('\n')
    if report_path:
        with open(report_path, 'w', encoding='utf8') as f:
            json.dump(report, f, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
