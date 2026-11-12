#!/usr/bin/env bash
# A. Ship the current code (and every picture, song and video in client/public)
# to the VM made by deploy/gce-up.sh.
#
#   deploy/gce-deploy.sh               build locally, upload, restart, wait for HTTPS
#   deploy/gce-deploy.sh --dry-run     print the commands, run nothing
#   SKIP_NPM_CI=1 deploy/gce-deploy.sh keep the local node_modules (faster)
#   FORCE=1 deploy/gce-deploy.sh       do not ask when players are connected
#
# A restart drops every room (they live in the server's memory): never run this
# in the middle of the party.
set -euo pipefail
# shellcheck source=deploy/config.sh
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

need_cmd npm "Install Node.js 22: https://nodejs.org"
need_cmd tar
need_cmd curl
require_gcloud

STATUS="$(gc compute instances describe "$INSTANCE" --zone="$ZONE" --format='value(status)' 2>/dev/null || true)"
IP="$(vm_ip)"
if is_dry; then
  STATUS=RUNNING
  IP="$DRY_IP"
fi
[[ -n "$STATUS" ]] || die "VM '$INSTANCE' not found in $ZONE. Create it first:  deploy/gce-up.sh"
[[ "$STATUS" == "RUNNING" ]] || die "VM '$INSTANCE' is $STATUS. Start it:  gcloud compute instances start $INSTANCE --zone=$ZONE"
[[ -n "$IP" ]] || die "Static IP '$IP_NAME' not found. Run deploy/gce-up.sh"
HOST="$(party_hostname "$IP")"
URL="https://$HOST"

# Do not drop a running party by accident.
guard_live_party "$URL" "A deploy restarts it and drops them."

cd "$PARTY_ROOT"
step "Building locally"
if [[ "${SKIP_NPM_CI:-0}" != "1" ]]; then
  run npm ci --no-audit --no-fund
fi
# Same-origin build: the server serves this client, so no VITE_SERVER_URL.
run env -u VITE_SERVER_URL npm run build
if ! is_dry; then
  [[ -f dist/server/index.mjs && -f dist/client/index.html ]] || die "Build output missing (dist/server/index.mjs, dist/client/index.html)."
fi
ok "built dist/"

RELEASE="$(date -u +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# COPYFILE_DISABLE: macOS tar must not add ._* resource-fork files (downloaded media carry them).
run env COPYFILE_DISABLE=1 tar -czf "$TMP/party-release.tgz" dist package.json package-lock.json
cp "$PARTY_ROOT/deploy/gce-install.sh" "$TMP/party-install.sh"
if is_dry; then ok "packed release $RELEASE"; else ok "packed release $RELEASE ($(du -h "$TMP/party-release.tgz" | cut -f1))"; fi

step "Waiting for SSH on $INSTANCE (the first time creates your SSH key)"
is_dry && gc compute ssh "$INSTANCE" --zone="$ZONE" --quiet --command=true
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

# Addresses that also reach this server when the main HTTPS name is not ready.
fallbacks() {
  local dashed="${IP//./-}" u
  for u in "https://$dashed.sslip.io" "https://$dashed.nip.io" "http://$IP"; do
    [[ "$u" == "$URL" ]] && continue
    if curl -fsS --max-time 6 "$u/healthz" >/dev/null 2>&1; then info "works now:  $u/host"; fi
  done
}

step "Waiting for $URL/healthz (the first boot also gets the HTTPS certificate)"
if is_dry; then
  info "(dry run) would wait up to ${HEALTH_TIMEOUT}s for $URL/healthz"
else
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  until curl -fsS --max-time 8 "$URL/healthz" >/dev/null 2>&1; do
    if ((SECONDS > deadline)); then
      printf '\n'
      warn "No HTTPS answer from $URL after ${HEALTH_TIMEOUT}s."
      info "The certificate can take a few minutes on a brand-new IP. Watch it:  deploy/gce-logs.sh caddy"
      info "Meanwhile these addresses answer (open /host on the one that works; its QR follows it):"
      fallbacks
      info "Re-check later:  deploy/smoke.sh $URL"
      die "HTTPS not ready yet at $URL"
    fi
    printf '.'
    sleep 5
  done
  printf '\n'
  ok "$(curl -fsS --max-time 8 "$URL/healthz")"
fi

print_party_urls "$URL"
info "Same server, other names (if a Wi-Fi filter or a certificate problem blocks the one above):"
info "  https://${IP//./-}.nip.io   ·   http://$IP  (plain http: no screen wake lock on phones)"
