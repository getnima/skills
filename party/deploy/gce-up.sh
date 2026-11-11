#!/usr/bin/env bash
# A. Compute Engine: create (or update) the party VM, then deploy the app to it.
#
#   deploy/gce-up.sh                 everything, safe to re-run
#   SKIP_DEPLOY=1 deploy/gce-up.sh   only the infrastructure
#
# Creates: static IP $IP_NAME, firewall rules $FW_WEB (80/443) and $FW_SSH (22)
# for the tag $NETWORK_TAG, and the VM $INSTANCE (Debian 12, Node, Caddy with
# automatic HTTPS at <ip-with-dashes>.sslip.io or $DOMAIN).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

require_gcloud
enable_apis compute.googleapis.com

step "Network '$NETWORK'"
if gc compute networks describe "$NETWORK" --format='value(name)' >/dev/null 2>&1; then
  ok "exists"
else
  gc compute networks create "$NETWORK" --subnet-mode=auto
  ok "created"
fi

step "Static IP '$IP_NAME' ($REGION)"
if [[ -z "$(vm_ip)" ]]; then
  gc compute addresses create "$IP_NAME" --region="$REGION" --network-tier=PREMIUM \
    --description="Party Arena public address"
fi
IP="$(vm_ip)"
[[ -n "$IP" ]] || die "Could not read the static IP '$IP_NAME'."
HOSTNAME_PUBLIC="$(party_hostname "$IP")"
ok "$IP  ->  https://$HOSTNAME_PUBLIC"

ensure_firewall() {
  local name="$1" rules="$2" desc="$3"
  if gc compute firewall-rules describe "$name" --format='value(name)' >/dev/null 2>&1; then
    ok "$name exists"
  else
    gc compute firewall-rules create "$name" --network="$NETWORK" --direction=INGRESS --action=ALLOW \
      --rules="$rules" --source-ranges=0.0.0.0/0 --target-tags="$NETWORK_TAG" --description="$desc"
    ok "$name created"
  fi
}
step "Firewall rules (tag $NETWORK_TAG)"
ensure_firewall "$FW_WEB" "tcp:80,tcp:443,udp:443" "Party Arena: HTTP (certificate challenge, redirect) and HTTPS / HTTP3"
ensure_firewall "$FW_SSH" "tcp:22" "Party Arena: SSH for gcloud compute ssh/scp (deploys)"

METADATA="party-domain=$DOMAIN,party-port=$APP_PORT,party-node=$NODE_MAJOR,party-email=$ACME_EMAIL"
STARTUP="$PARTY_ROOT/deploy/gce-startup.sh"

step "VM '$INSTANCE' ($MACHINE_TYPE, $ZONE)"
STATUS="$(gc compute instances describe "$INSTANCE" --zone="$ZONE" --format='value(status)' 2>/dev/null || true)"
if [[ -z "$STATUS" ]]; then
  gc compute instances create "$INSTANCE" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family="$IMAGE_FAMILY" \
    --image-project="$IMAGE_PROJECT" \
    --boot-disk-size="$BOOT_DISK_SIZE" \
    --boot-disk-type=pd-balanced \
    --network="$NETWORK" \
    --address="$IP" \
    --tags="$NETWORK_TAG" \
    --labels=app=party-arena \
    --shielded-secure-boot \
    --metadata="$METADATA" \
    --metadata-from-file=startup-script="$STARTUP"
  ok "created; first boot installs Node + Caddy (about 2 minutes)"
else
  info "exists (status $STATUS): updating its startup script and settings"
  gc compute instances add-metadata "$INSTANCE" --zone="$ZONE" \
    --metadata="$METADATA" --metadata-from-file=startup-script="$STARTUP"
  if [[ "$STATUS" == "RUNNING" ]]; then
    info "re-running the startup script on the VM"
    gc compute ssh "$INSTANCE" --zone="$ZONE" --quiet \
      --command='sudo google_metadata_script_runner startup' ||
      warn "could not re-run the startup script now; it runs on the next boot (deploy/gce-logs.sh startup)"
  else
    gc compute instances start "$INSTANCE" --zone="$ZONE"
    ok "started (the startup script runs on boot)"
  fi
fi

if [[ "${SKIP_DEPLOY:-0}" == "1" ]]; then
  print_party_urls "https://$HOSTNAME_PUBLIC"
  info "SKIP_DEPLOY=1: the app is not deployed yet. Next: deploy/gce-deploy.sh"
  exit 0
fi

exec "$PARTY_ROOT/deploy/gce-deploy.sh"
