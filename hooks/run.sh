#!/usr/bin/env bash
# Entry for every nima hook. Fails closed for the guard (exit 2 blocks the
# tool call) and open for everything else. Needs bash and Node >= 18.
if [ -f "${CLAUDE_PROJECT_DIR:-.}/.nima-off" ] || [ "${NIMA_PLUGIN:-}" = "off" ]; then
  # An opt-out must never leave filing unguarded (the file-signal skill pre-approves create_signal).
  if [ "$1" = "guard" ]; then
    echo "nima plugin is off for this repo; create_signal is blocked." >&2
    exit 2
  fi
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  if [ "$1" = "guard" ]; then
    echo "nima plugin: Node is required to enforce filing limits; create_signal is blocked until it is installed." >&2
    exit 2
  fi
  exit 0
fi
if [ "$1" != "guard" ]; then
  exec node "$(dirname "$0")/../scripts/nima-hook.mjs" "$@"
fi
# Guard: any exit other than 0 or 2 (bad NODE_OPTIONS, old Node, crash) must still block.
node "$(dirname "$0")/../scripts/nima-hook.mjs" "$@"
rc=$?
if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
  echo "nima plugin: guard crashed (exit $rc); create_signal is blocked." >&2
  exit 2
fi
exit "$rc"
