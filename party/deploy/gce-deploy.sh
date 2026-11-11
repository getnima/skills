#!/usr/bin/env bash
# A. Ship the current code to the VM made by deploy/gce-up.sh.
#
#   deploy/gce-deploy.sh               build locally, upload, restart, wait for HTTPS
#   SKIP_NPM_CI=1 deploy/gce-deploy.sh keep the local node_modules (faster)
#   FORCE=1 deploy/gce-deploy.sh       do not ask when players are connected
#
# A restart drops every room (they live in the server's memory): never run this
# in the middle of the party.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

need_cmd npm "Install Node.js 22: https://nodejs.org"
need_cmd tar
need_cmd curl
require_gcloud

STATUS="$(gc compute instances describe "$INSTANCE" --zone="$ZONE" --format='value(status)' 2>/dev/null || true)"
[[ -n "$STATUS" ]] || die "VM '$INSTANCE' not found in $ZONE. Create it first:  deploy/gce-up.sh"
[[ "$STATUS" == "RUNNING" ]] || die "VM '$INSTANCE' is $STATUS. Start it:  gcloud compute instances start $INSTANCE --zone=$ZONE"
IP="$(vm_ip)"
[[ -n "$IP" ]] || die "Static IP '$IP_NAME' not found. Run deploy/gce-up.sh"
HOST="$(party_hostname "$IP")"
URL="https://$HOST"

# Do not drop a running party by accident.
if health="$(curl -fsS --max-time 5 "$URL/healthz" 2>/dev/null)"; then
  players="$(printf '%s' "$health" | sed -n 's/.*"players":\([0-9]*\).*/\1/p')"
  if [[ "${players:-0}" -gt 0 && "${FORCE:-0}" != "1" ]]; then
    warn "The live server has $players player(s) in its rooms. A deploy restarts it and drops them."
    if [[ -t 0 ]]; then
      read -r -p "    Deploy anyway? [y/N] " answer
      [[ "$answer" =~ ^[Yy] ]] || die "Cancelled."
    else
      die "Not deploying over a live party. Re-run with FORCE=1 if you are sure."
    fi
  fi
fi

cd "$PARTY_ROOT"
step "Building locally"
if [[ "${SKIP_NPM_CI:-0}" != "1" ]]; then
  npm ci --no-audit --no-fund
fi
# Same-origin build: the server serves this client, so no VITE_SERVER_URL.
env -u VITE_SERVER_URL npm run build
[[ -f dist/server/index.mjs && -f dist/client/index.html ]] || die "Build output missing (dist/server/index.mjs, dist/client/index.html)."
ok "built dist/"

RELEASE="$(date -u +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -czf "$TMP/party-release.tgz" dist package.json package-lock.json
cp "$PARTY_ROOT/deploy/gce-install.sh" "$TMP/party-install.sh"
ok "packed release $RELEASE ($(du -h "$TMP/party-release.tgz" | cut -f1))"

step "Waiting for SSH on $INSTANCE"
for i in $(seq 1 30); do
  if gc compute ssh "$INSTANCE" --zone="$ZONE" --quiet --command=true >/dev/null 2>&1; then
    ok "SSH is up"
    break
  fi
  [[ "$i" == 30 ]] && die "SSH to $INSTANCE does not answer. Try: deploy/gce-ssh.sh   (and deploy/doctor.sh)"
  sleep 6
done

step "Uploading"
gc compute scp "$TMP/party-release.tgz" "$TMP/party-install.sh" "$INSTANCE:/tmp/" --zone="$ZONE" --quiet
ok "uploaded"

step "Installing on the VM (npm ci --omit=dev, restart)"
gc compute ssh "$INSTANCE" --zone="$ZONE" --quiet \
  --command="sudo bash /tmp/party-install.sh /tmp/party-release.tgz $RELEASE $APP_PORT"

step "Waiting for $URL/healthz (the first boot also gets the HTTPS certificate)"
deadline=$((SECONDS + HEALTH_TIMEOUT))
until curl -fsS --max-time 8 "$URL/healthz" >/dev/null 2>&1; do
  if ((SECONDS > deadline)); then
    warn "No HTTPS answer after ${HEALTH_TIMEOUT}s."
    info "The certificate can take a few minutes on a brand-new IP. Watch it:  deploy/gce-logs.sh caddy"
    info "Then re-check:  deploy/smoke.sh $URL"
    die "HTTPS not ready yet at $URL"
  fi
  printf '.'
  sleep 5
done
printf '\n'
ok "$(curl -fsS --max-time 8 "$URL/healthz")"

print_party_urls "$URL"
