"""Turn the vite build of client/preview.html into one self-contained page plus its pictures.

    assemble.py <vite-out-dir> <client/public> <site-dir>

index.html in <site-dir> has no <html>/<head>/<body> wrapper (the host page adds one), the CSS and
the JS are inline, the fonts are data URIs inside the CSS, and every picture is a file next to it
under assets/ (relative URLs only). files.json lists the published files.
"""
import base64
import json
import os
import re
import shutil
import sys

build, public, site = sys.argv[1], sys.argv[2], sys.argv[3]

html = open(os.path.join(build, 'preview.html'), encoding='utf-8').read()
js_files = re.findall(r'<script[^>]+src="\./([^"]+\.js)"', html)
css_files = re.findall(r'<link[^>]+href="\./([^"]+\.css)"', html)
if len(js_files) != 1 or len(css_files) != 1:
    sys.exit(f'expected one JS and one CSS file, got {js_files} and {css_files}')
js = open(os.path.join(build, js_files[0]), encoding='utf-8').read()
css = open(os.path.join(build, css_files[0]), encoding='utf-8').read()


def font_uri(match):
    name = match.group(2)
    path = os.path.join(public, 'fonts', name)
    data = base64.b64encode(open(path, 'rb').read()).decode('ascii')
    return f'url(data:font/woff2;base64,{data})'


css, n_fonts = re.subn(r'''url\((['"]?)[^)'"]*?fonts/([A-Za-z0-9_.-]+\.woff2)\1\)''', font_uri, css)
left = re.findall(r'url\(([^)]*)\)', css)
bad = [u for u in left if not u.strip('\'"').startswith(('data:', './assets/', 'assets/', '../assets/', '#'))]
if bad:
    sys.exit(f'CSS still has URLs that are not inline and not under assets/: {bad[:5]}')
css = css.replace('url(../assets/', 'url(./assets/')

# absolute URLs left in the code would break when the page is not served from the root of a host
abs_refs = sorted(set(re.findall(r'''["'`](/(?:assets|fonts|audio|cutscenes)/[^"'`]*)''', js)))
abs_refs = [a for a in abs_refs if not a.startswith('/assets/')]  # the kit's file list keeps /assets/... keys and adds the base itself
if abs_refs:
    print('NOTE: absolute references left in the JS:', abs_refs[:8])

page = '\n'.join([
    '<title>Party Arena Preview</title>',
    '<script>document.documentElement.lang = "he"; document.documentElement.dir = "rtl";</script>',
    '<style>',
    css,
    '</style>',
    '<div id="app"></div>',
    '<script type="module">',
    js.replace('</script', '<\\/script'),
    '</script>',
    '',
])
os.makedirs(site, exist_ok=True)
open(os.path.join(site, 'index.html'), 'w', encoding='utf-8').write(page)

# the pictures the games and the dressing room can ask for
KEEP_DIRS = ['assets/tap', 'assets/icy', 'assets/flappy', 'assets/plotzel', 'assets/ninja', 'assets/shimi', 'assets/intro']
EXTS = ('.png', '.webp', '.jpg', '.jpeg', '.svg', '.gif')
files = []
for d in KEEP_DIRS:
    for dirpath, _dirs, names in os.walk(os.path.join(public, d)):
        for name in sorted(names):
            if not name.lower().endswith(EXTS):
                continue
            src = os.path.join(dirpath, name)
            rel = os.path.relpath(src, public).replace(os.sep, '/')
            dst = os.path.join(site, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            files.append(rel)
# the drop-in sound clips the preview plays: the air horn and the gong (the songs stay out)
for rel in ('audio/airhorn.mp3', 'audio/gong.mp3'):
    src = os.path.join(public, rel)
    if os.path.exists(src):
        dst = os.path.join(site, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        files.append(rel)
json.dump(sorted(files), open(os.path.join(site, 'files.json'), 'w'), indent=0)
total = sum(os.path.getsize(os.path.join(site, f)) for f in files)
print(f'index.html {len(page) / 1024:.0f} KB (css {len(css) / 1024:.0f} KB, js {len(js) / 1024:.0f} KB, {n_fonts} fonts inlined); {len(files)} pictures, {total / 1e6:.1f} MB')
