#!/usr/bin/env bash
# Party Arena VM bootstrap. Runs as root on EVERY boot of the VM (GCE startup
# script, installed by deploy/gce-up.sh). Idempotent: installs Node + Caddy
# once, then only rewrites config that changed, and restarts only what changed.
#
# Settings come from the instance metadata (set by gce-up.sh):
#   party-domain   your own hostname for TLS (optional)
#   party-port     port of the Node server behind Caddy (default 8080)
#   party-node     Node major version (default 22)
#   party-email    optional ACME e-mail
# The server answers on all of these at once (each name gets its own certificate,
# so a rate limit on one does not block the others):
#   https://<party-domain>, https://<ip-with-dashes>.sslip.io,
#   https://<ip-with-dashes>.nip.io, and plain http://<ip> as the last resort.
# Logs: sudo journalctl -u google-startup-scripts   (or deploy/gce-logs.sh startup)
set -euo pipefail
# Runs on the VM only (deploy/gce-deploy.sh / gce-up.sh call it; their --dry-run shows how).
case "${1:-}" in -h | --help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;; esac

APP_USER=party
APP_DIR=/opt/party-arena
STATE_DIR=/var/lib/party-arena
READY="$STATE_DIR/startup-done"
UNIT=/etc/systemd/system/party-arena.service
ENV_FILE=/etc/party-arena.env
CADDYFILE=/etc/caddy/Caddyfile
MD=http://metadata.google.internal/computeMetadata/v1

log() { echo "[party-startup] $*"; }

mkdir -p "$STATE_DIR"
rm -f "$READY"

export DEBIAN_FRONTEND=noninteractive
apt_updated=0
apt_update() {
  if [[ "$apt_updated" == 0 ]]; then
    apt-get update -y
    apt_updated=1
  fi
}

# ── base packages (curl first: the metadata reads below need it) ──
if ! command -v gpg >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  apt_update
  apt-get install -y curl ca-certificates gnupg
fi

md() { curl -fsS -H 'Metadata-Flavor: Google' "$MD/$1" 2>/dev/null || true; }
attr() { md "instance/attributes/$1"; }

PORT="$(attr party-port)"
PORT="${PORT:-8080}"
NODE_MAJOR="$(attr party-node)"
NODE_MAJOR="${NODE_MAJOR:-22}"
EMAIL="$(attr party-email)"
DOMAIN="$(attr party-domain)"
IP=""
for _ in $(seq 1 30); do
  IP="$(md instance/network-interfaces/0/access-configs/0/external-ip)"
  [[ -n "$IP" ]] && break
  sleep 2
done
[[ -n "$IP" || -n "$DOMAIN" ]] || { log "no external IP in the metadata and no party-domain"; exit 1; }
NAMES=""
[[ -n "$DOMAIN" ]] && NAMES="$DOMAIN"
if [[ -n "$IP" ]]; then
  for suffix in sslip.io nip.io; do NAMES="${NAMES:+$NAMES, }${IP//./-}.$suffix"; done
fi
log "names: $NAMES${IP:+, http://$IP}; node server on 127.0.0.1:$PORT; Node $NODE_MAJOR"

# ── Node.js: NodeSource apt repo; if that fails, the official nodejs.org tarball ──
node_ok() { /usr/bin/node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; }
install_node_tarball() {
  # Called as `install_node_tarball || ...`, where set -e is off: every step checks itself.
  local arch base file
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64) arch=arm64 ;;
    *) log "no Node tarball for $(uname -m)"; return 1 ;;
  esac
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  # .tar.gz, not .tar.xz: gzip is on every Debian, xz is not.
  curl -fsSL "$base/SHASUMS256.txt" -o /tmp/node-SHASUMS256.txt || return 1
  file="$(awk -v a="linux-$arch.tar.gz" '$2 ~ a"$" { print $2; exit }' /tmp/node-SHASUMS256.txt)"
  [[ -n "$file" ]] || return 1
  curl -fsSL "$base/$file" -o "/tmp/$file" || return 1
  (cd /tmp && grep " $file\$" node-SHASUMS256.txt | sha256sum -c -) || return 1
  rm -rf /usr/local/lib/nodejs.new && mkdir -p /usr/local/lib/nodejs.new || return 1
  tar -xzf "/tmp/$file" -C /usr/local/lib/nodejs.new --strip-components=1 || return 1
  rm -rf /usr/local/lib/nodejs && mv /usr/local/lib/nodejs.new /usr/local/lib/nodejs || return 1
  rm -f "/tmp/$file" /tmp/node-SHASUMS256.txt
  for bin in node npm npx; do ln -sfn "/usr/local/lib/nodejs/bin/$bin" "/usr/bin/$bin" || return 1; done
  log "installed $file from nodejs.org"
}
if ! node_ok; then
  log "installing Node.js $NODE_MAJOR"
  if curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh &&
    bash /tmp/nodesource_setup.sh && apt-get install -y nodejs && node_ok; then
    apt_updated=1
  else
    log "NodeSource failed: installing the nodejs.org tarball instead"
    # A half-added NodeSource repo would make every later apt-get update fail.
    rm -f /etc/apt/sources.list.d/nodesource.* /etc/apt/sources.list.d/nodesource*.sources
    install_node_tarball || true
    node_ok || { log "Node.js $NODE_MAJOR could not be installed"; exit 1; }
  fi
fi
log "node $(node --version), npm $(npm --version)"

# ── Caddy: official apt repo; if that fails, Debian's own package ──
if ! command -v caddy >/dev/null 2>&1; then
  log "installing Caddy"
  apt_update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https || true
  if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg &&
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list; then
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y || true
  else
    log "the Caddy apt repo is not reachable: using Debian's caddy package"
    rm -f /etc/apt/sources.list.d/caddy-stable.list
  fi
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
unit_changed=0
if write_if_changed "$UNIT" <<EOF
[Unit]
Description=Party Arena game server
After=network-online.target
Wants=network-online.target
# Until the first deploy there is nothing to run (no restart loop).
ConditionPathExists=$APP_DIR/current/dist/server/index.mjs
# Never give up restarting (the default stops after 5 crashes in 10 s).
StartLimitIntervalSec=0

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
  unit_changed=1
  systemctl daemon-reload
fi
systemctl enable party-arena.service >/dev/null 2>&1 || true
if [[ -f "$APP_DIR/current/dist/server/index.mjs" ]]; then
  # A re-run during the party must not drop the rooms: restart only for a new unit.
  if [[ "$unit_changed" == 1 ]]; then
    systemctl restart party-arena.service
  elif ! systemctl is-active --quiet party-arena.service; then
    systemctl start party-arena.service
  fi
fi

# ── Caddy: TLS for every name, reverse proxy to Node (websockets pass through) ──
GLOBAL=""
[[ -n "$EMAIL" ]] && GLOBAL=$'{\n\temail '"$EMAIL"$'\n}\n\n'
PROXY="	reverse_proxy 127.0.0.1:$PORT {
		# no response buffering: socket.io long-polling and websockets go straight through
		flush_interval -1
	}"
HTTP_SITE=""
[[ -n "$IP" ]] && HTTP_SITE="
# Last resort: plain http on the bare IP (no certificate needed; phones lose the
# screen wake lock and the iPhone home-screen app, the game itself works).
http://$IP {
$PROXY
}"
if write_if_changed "$CADDYFILE" <<EOF
${GLOBAL}# Written by the Party Arena startup script on every boot: edit deploy/gce-startup.sh instead.
# Automatic HTTPS: Caddy gets and renews a certificate for each name and redirects http -> https.
$NAMES {
$PROXY
}
$HTTP_SITE
EOF
then
  log "Caddyfile written for $NAMES"
  caddy validate --config "$CADDYFILE" --adapter caddyfile
  systemctl enable caddy >/dev/null 2>&1 || true
  systemctl restart caddy
else
  systemctl is-active --quiet caddy || systemctl restart caddy
fi

echo "$NAMES" >"$READY"
log "ready: $NAMES${IP:+, http://$IP}"
