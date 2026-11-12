#!/usr/bin/env bash
# Cut one generated host pose out of its light-grey backdrop and pack it as the TV WebP.
#   bash tests/e2e/host-poses-pack.sh <name> [extra intro-art-cut.py args...]
# reads  tests/e2e/out/host-poses/originals/<name>_<n>.png (the newest take, or <name>.png)
# writes tests/e2e/out/host-poses/work/<name>.png (+ _check.png) and client/public/assets/hosts/poses/<name>.webp
set -euo pipefail
cd "$(dirname "$0")/../.."
name="$1"; shift
src="tests/e2e/out/host-poses/originals/${SRC:-$name}.png"
[ -f "$src" ] || src="$(ls -t tests/e2e/out/host-poses/originals/${name}_*.png | head -1)"
work="tests/e2e/out/host-poses/work"
mkdir -p "$work" client/public/assets/hosts/poses
python3 -I tests/e2e/intro-art-cut.py "$src" "$work/$name.png" --tol 14 --shadow 0.25 --check "$work/${name}_check.png" "$@"
python3 -I tests/e2e/intro-art-pack.py "$work/$name.png" "client/public/assets/hosts/poses/$name.webp" --max 640 --quality 88 --limit 115
