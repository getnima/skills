#!/usr/bin/env bash
# A. Delete everything deploy/gce-up.sh created: the VM (and its disk), the
# static IP and the two firewall rules. Asks first (YES=1 skips the question).
# The project, the enabled APIs and the 'default' network are left alone.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
require_gcloud

printf '\nThis permanently deletes, in project %s:\n' "$PROJECT_ID"
printf '   VM %s (%s) and its boot disk\n   static IP %s (%s)\n   firewall rules %s, %s\n\n' \
  "$INSTANCE" "$ZONE" "$IP_NAME" "$REGION" "$FW_WEB" "$FW_SSH"
if [[ "${YES:-0}" != "1" ]]; then
  [[ -t 0 ]] || die "Not a terminal: re-run with YES=1 to confirm."
  read -r -p "Type 'delete' to continue: " answer
  [[ "$answer" == "delete" ]] || die "Cancelled, nothing deleted."
fi

step "VM $INSTANCE"
if gc compute instances describe "$INSTANCE" --zone="$ZONE" --format='value(name)' >/dev/null 2>&1; then
  gc compute instances delete "$INSTANCE" --zone="$ZONE" --delete-disks=all --quiet
  ok "deleted"
else
  ok "already gone"
fi

step "Static IP $IP_NAME"
if [[ -n "$(vm_ip)" ]]; then
  gc compute addresses delete "$IP_NAME" --region="$REGION" --quiet
  ok "released"
else
  ok "already gone"
fi

step "Firewall rules"
for fw in "$FW_WEB" "$FW_SSH"; do
  if gc compute firewall-rules describe "$fw" --format='value(name)' >/dev/null 2>&1; then
    gc compute firewall-rules delete "$fw" --quiet
    ok "$fw deleted"
  else
    ok "$fw already gone"
  fi
done

printf '\n%sDone. Nothing of the VM path is left running or billed.%s\n' "$_G" "$_N"
