#!/usr/bin/env bash
# Build the no-server preview (the five games + the dressing room) as ONE page plus its pictures,
# ready to publish as a shareable page or to open from any static host.
#
#   tools/preview/make.sh [out-dir]        (default: /tmp/party-preview)
#
# It works on a copy of the tree, so a build never touches files other people are editing:
#   1. copy the tree (no node_modules, no dist, no test output, no "_before" folders)
#   2. make the avatar pictures relative (the avatar catalog uses absolute /assets/... URLs)
#   3. vite build with tools/preview/vite.config.mjs
#   4. tools/preview/assemble.py: inline the JS, the CSS and the fonts into index.html and copy the pictures
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PARTY="$(cd "$HERE/../.." && pwd)"
OUT="${1:-/tmp/party-preview}"
SRC="$OUT/src"
BUILD="$OUT/build"
SITE="$OUT/site"
rm -rf "$OUT"
mkdir -p "$SRC" "$SITE"
(cd "$PARTY" && tar -cf - --exclude=./node_modules --exclude=./dist --exclude=./.git --exclude=./tests/e2e/out --exclude=_before --exclude=art-src .) | (cd "$SRC" && tar -xf -)
ln -s "$PARTY/node_modules" "$SRC/node_modules"
sed -i "s#'/assets/shimi/#'./assets/shimi/#g" "$SRC"/client/src/avatar/catalog*.ts
(cd "$SRC" && PREVIEW_SRC="$SRC" PREVIEW_OUT="$BUILD" npx vite build --config "$HERE/vite.config.mjs")
python3 -I "$HERE/assemble.py" "$BUILD" "$SRC/client/public" "$SITE"
echo "preview site: $SITE"
