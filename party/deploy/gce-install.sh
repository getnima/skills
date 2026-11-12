#!/usr/bin/env bash
# Runs ON THE VM as root, called by deploy/gce-deploy.sh:
#   sudo bash /tmp/party-install.sh <release.tgz> <release-id> <port>
# Unpacks a release next to the previous ones, installs production
# dependencies, switches the `current` symlink and restarts the service.
set -euo pipefail
# Runs on the VM only (deploy/gce-deploy.sh / gce-up.sh call it; their --dry-run shows how).
case "${1:-}" in -h | --help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;; esac

TGZ="$1"
RELEASE="$2"
PORT="${3:-8080}"
APP_USER=party
APP_DIR=/opt/party-arena
READY=/var/lib/party-arena/startup-done
KEEP=3

log() { echo "    [vm] $*"; }

# First boot: the startup script may still be installing Node and Caddy.
for i in $(seq 1 120); do
  [[ -f "$READY" ]] && break
  if [[ "$i" == 120 ]]; then
    echo "The VM startup script did not finish. Its last lines:" >&2
    journalctl -u google-startup-scripts --no-pager -n 40 >&2 || true
    exit 1
  fi
  ((i % 6 == 1)) && log "waiting for the startup script (Node + Caddy install)..."
  sleep 5
done

REL="$APP_DIR/releases/$RELEASE"
rm -rf "$REL"
mkdir -p "$REL"
tar -xzf "$TGZ" -C "$REL"
chown -R "$APP_USER:$APP_USER" "$REL"
log "unpacked $RELEASE"

cd "$REL"
# runuser (util-linux) is on every Debian; HOME so npm's cache lands in the app user's home.
runuser -u "$APP_USER" -- env HOME="$APP_DIR" NODE_ENV=production npm ci --omit=dev --no-audit --no-fund --loglevel=error
log "production dependencies installed"

ln -sfn "$REL" "$APP_DIR/current.tmp"
mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"

systemctl daemon-reload
systemctl reset-failed party-arena.service >/dev/null 2>&1 || true
systemctl enable party-arena.service >/dev/null 2>&1 || true
systemctl restart party-arena.service

for i in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    log "server up on 127.0.0.1:$PORT"
    break
  fi
  if [[ "$i" == 40 ]]; then
    echo "The server did not come up. Its last lines:" >&2
    journalctl -u party-arena --no-pager -n 40 >&2 || true
    exit 1
  fi
  sleep 0.5
done
systemctl is-active --quiet caddy || systemctl restart caddy

# Keep the newest $KEEP releases (names are UTC timestamps, so they sort by name).
cd "$APP_DIR/releases"
find . -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +$((KEEP + 1)) |
  while read -r old; do rm -rf "${APP_DIR:?}/releases/$old"; done
rm -f "$TGZ" /tmp/party-install.sh
log "release $RELEASE is live"
