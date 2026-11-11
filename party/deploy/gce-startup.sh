#!/usr/bin/env bash
# Party Arena VM bootstrap. Runs as root on EVERY boot of the VM (GCE startup
# script, installed by deploy/gce-up.sh). Idempotent: installs Node + Caddy
# once, then only rewrites config that changed.
#
# Settings come from the instance metadata (set by gce-up.sh):
#   party-domain   hostname for TLS; empty = <external-ip-with-dashes>.sslip.io
#   party-port     port of the Node server behind Caddy (default 8080)
#   party-node     Node major version (default 22)
#   party-email    optional ACME e-mail
# Logs: sudo journalctl -u google-startup-scripts   (or deploy/gce-logs.sh startup)
set -euo pipefail

APP_USER=party
APP_DIR=/opt/party-arena
STATE_DIR=/var/lib/party-arena
READY="$STATE_DIR/startup-done"
UNIT=/etc/systemd/system/party-arena.service
ENV_FILE=/etc/party-arena.env
CADDYFILE=/etc/caddy/Caddyfile
MD=http://metadata.google.internal/computeMetadata/v1

log() { echo "[party-startup] $*"; }

md() { curl -fsS -H 'Metadata-Flavor: Google' "$MD/$1" 2>/dev/null || true; }
attr() { md "instance/attributes/$1"; }

mkdir -p "$STATE_DIR"
rm -f "$READY"

PORT="$(attr party-port)"
PORT="${PORT:-8080}"
NODE_MAJOR="$(attr party-node)"
NODE_MAJOR="${NODE_MAJOR:-22}"
EMAIL="$(attr party-email)"
DOMAIN="$(attr party-domain)"
if [[ -z "$DOMAIN" ]]; then
  IP=""
  for _ in $(seq 1 30); do
    IP="$(md instance/network-interfaces/0/access-configs/0/external-ip)"
    [[ -n "$IP" ]] && break
    sleep 2
  done
  [[ -n "$IP" ]] || { log "no external IP in the metadata"; exit 1; }
  DOMAIN="${IP//./-}.sslip.io"
fi
log "hostname $DOMAIN, node server on 127.0.0.1:$PORT, Node $NODE_MAJOR"

export DEBIAN_FRONTEND=noninteractive
apt_updated=0
apt_update() {
  if [[ "$apt_updated" == 0 ]]; then
    apt-get update -y
    apt_updated=1
  fi
}

# ── base packages ──
if ! command -v gpg >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  apt_update
  apt-get install -y curl ca-certificates gnupg
fi

# ── Node.js (NodeSource) ──
if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  log "installing Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
  apt_updated=1
fi
log "node $(node --version), npm $(npm --version)"

# ── Caddy (official apt repo) ──
if ! command -v caddy >/dev/null 2>&1; then
  log "installing Caddy"
  apt_update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
log "$(caddy version)"

# ── system user + app directory ──
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_DIR/releases"
chown "$APP_USER:$APP_USER" "$APP_DIR" "$APP_DIR/releases"
touch "$ENV_FILE"

# Write a file only when its content changed; returns 0 when it changed.
write_if_changed() {
  local target="$1" tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if [[ -f "$target" ]] && cmp -s "$tmp" "$target"; then
    rm -f "$tmp"
    return 1
  fi
  install -m 0644 "$tmp" "$target"
  rm -f "$tmp"
  return 0
}

# ── systemd unit ──
if write_if_changed "$UNIT" <<EOF
[Unit]
Description=Party Arena game server
After=network-online.target
Wants=network-online.target
# Until the first deploy there is nothing to run (no restart loop).
ConditionPathExists=$APP_DIR/current/dist/server/index.mjs

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/current
Environment=NODE_ENV=production
Environment=PORT=$PORT
# CLIENT_ORIGIN etc. (written by deploy/firebase-deploy.sh). Optional.
EnvironmentFile=-$ENV_FILE
ExecStart=/usr/bin/node dist/server/index.mjs
Restart=always
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=5
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
then
  log "systemd unit written"
  systemctl daemon-reload
fi
systemctl enable party-arena.service >/dev/null 2>&1 || true
if [[ -f "$APP_DIR/current/dist/server/index.mjs" ]]; then
  systemctl restart party-arena.service
fi

# ── Caddy: TLS for $DOMAIN, reverse proxy to Node (websockets pass through) ──
GLOBAL=""
[[ -n "$EMAIL" ]] && GLOBAL=$'{\n\temail '"$EMAIL"$'\n}\n\n'
if write_if_changed "$CADDYFILE" <<EOF
${GLOBAL}# Written by the Party Arena startup script on every boot: edit deploy/gce-startup.sh instead.
# Automatic HTTPS: Caddy gets and renews the certificate itself and redirects http -> https.
$DOMAIN {
	reverse_proxy 127.0.0.1:$PORT
}
EOF
then
  log "Caddyfile written for $DOMAIN"
  caddy validate --config "$CADDYFILE" --adapter caddyfile
  systemctl enable caddy >/dev/null 2>&1 || true
  systemctl restart caddy
else
  systemctl is-active --quiet caddy || systemctl restart caddy
fi

echo "$DOMAIN" >"$READY"
log "ready: https://$DOMAIN"
