#!/usr/bin/env bash
# Cut one generated host pose out of its light-grey backdrop and pack it as the TV WebP.
#   bash tests/e2e/host-poses-pack.sh <name> [extra intro-art-cut.py args...]
#   bash tests/e2e/host-poses-pack.sh all
# reads  tests/e2e/out/host-poses/originals/<name>_<n>.png (the newest take; SRC=<file base> picks one)
# writes tests/e2e/out/host-poses/work/<name>.png (+ _check.png) and client/public/assets/hosts/poses/<name>.webp
# The backdrop is a flat light grey (225); the per-pose settings below are the ones the pictures were made with.
set -euo pipefail
cd "$(dirname "$0")/../.."

# host A (olive shirt): a plain fill is enough. Host B (white stripes, white teeth): a tight tolerance,
# flat-only backdrop, the floor shadow and the pocket between the legs dropped as neutral grey.
B_ARGS=(--tol 7 --holes 20000 --smooth 5 --shadow 0.3 --shadow-box 0,960,896,1200 --shadow-smooth 9 --grey-chroma 14)
args_for() {
  case "$1" in
    a_*) echo "--tol 14 --shadow 0.25" ;;
    b_present) echo "${B_ARGS[*]} --erase-grey 230,450|266,450|266,645|230,645;626,445|672,445|672,645|626,645;410,905|495,905|495,1112|410,1112;200,1094|800,1094|800,1140|200,1140" ;;
    b_shocked) echo "${B_ARGS[*]} --holes 300 --erase-grey 234,430|268,430|268,632|234,632;245,640|300,640|300,725|245,725;622,440|668,440|668,580|622,580;436,905|470,905|470,965|436,965" ;;
    b_wave) echo "${B_ARGS[*]} --erase-grey 230,450|268,450|268,600|230,600;628,445|672,445|672,600|628,600;420,900|478,900|478,1000|420,1000" ;;
    b_shush) echo "${B_ARGS[*]} --erase-grey 230,450|266,450|266,645|230,645;626,445|672,445|672,645|626,645" ;;
    b_laugh) echo "${B_ARGS[*]} --erase-grey 268,460|306,460|306,590|268,590;420,890|475,890|475,1010|420,1010;180,1062|800,1062|800,1140|180,1140" ;;
    b_*) echo "${B_ARGS[*]}" ;;
  esac
}

pack() {
  local name="$1"; shift
  local src="tests/e2e/out/host-poses/originals/${SRC:-$name}.png"
  [ -f "$src" ] || src="$(ls -t tests/e2e/out/host-poses/originals/${name}_*.png | head -1)"
  local work="tests/e2e/out/host-poses/work"
  mkdir -p "$work" client/public/assets/hosts/poses
  local extra
  read -r -a extra <<< "$(args_for "$name")"
  # polygons are written with | between the corners (no spaces inside one word)
  for i in "${!extra[@]}"; do extra[$i]="${extra[$i]//|/ }"; done
  python3 -I tests/e2e/intro-art-cut.py "$src" "$work/$name.png" --check "$work/${name}_check.png" "${extra[@]}" "$@"
  python3 -I tests/e2e/intro-art-pack.py "$work/$name.png" "client/public/assets/hosts/poses/$name.webp" --max 640 --quality 88 --limit 115
}

if [ "$1" = all ]; then
  for f in tests/e2e/out/host-poses/originals/*_1.png; do
    n="$(basename "$f" _1.png)"
    pack "$n"
  done
else
  pack "$@"
fi
