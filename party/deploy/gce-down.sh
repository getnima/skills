#!/usr/bin/env bash
# A. Delete everything deploy/gce-up.sh created: the VM (and its disk), the
# static IP and the two firewall rules. Asks first (YES=1 skips the question).
# The project, the enabled APIs and the 'default' network are left alone.
#
#   deploy/gce-down.sh            asks, then deletes
#   YES=1 deploy/gce-down.sh      no question
#   deploy/gce-down.sh --dry-run  print the delete commands, delete nothing
set -euo pipefail
# shellcheck source=deploy/config.sh
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
require_gcloud
# A dry run shows every delete, as if everything existed.
exists() { is_dry || "$@" >/dev/null 2>&1; }

printf '\nThis permanently deletes, in project %s:\n' "$PROJECT_ID"
printf '   VM %s (%s) and its boot disk\n   static IP %s (%s)\n   firewall rules %s, %s\n\n' \
  "$INSTANCE" "$ZONE" "$IP_NAME" "$REGION" "$FW_WEB" "$FW_SSH"
if [[ "${YES:-0}" != "1" ]] && ! is_dry; then
  [[ -t 0 ]] || die "Not a terminal: re-run with YES=1 to confirm."
  read -r -p "Type 'delete' to continue: " answer
  [[ "$answer" == "delete" ]] || die "Cancelled, nothing deleted."
fi

step "VM $INSTANCE"
if exists gc compute instances describe "$INSTANCE" --zone="$ZONE" --format='value(name)'; then
  gc compute instances delete "$INSTANCE" --zone="$ZONE" --delete-disks=all --quiet
  ok "deleted"
else
  ok "already gone"
fi

step "Static IP $IP_NAME"
if is_dry || [[ -n "$(vm_ip)" ]]; then
  gc compute addresses delete "$IP_NAME" --region="$REGION" --quiet
  ok "released"
else
  ok "already gone"
fi

step "Firewall rules"
for fw in "$FW_WEB" "$FW_SSH"; do
  if exists gc compute firewall-rules describe "$fw" --format='value(name)'; then
    gc compute firewall-rules delete "$fw" --quiet
    ok "$fw deleted"
  else
    ok "$fw already gone"
  fi
done

if is_dry; then printf '\nDry run: nothing was deleted.\n'; else printf '\n%sDone. Nothing of the VM path is left running or billed.%s\n' "$_G" "$_N"; fi
