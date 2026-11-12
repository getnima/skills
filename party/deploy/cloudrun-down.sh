#!/usr/bin/env bash
# B. Delete the Cloud Run service (stops the always-on billing). Asks first
# (YES=1 skips). The built images stay in Artifact Registry
# (repository cloud-run-source-deploy, a few cents a month); the last lines say
# how to delete them too.
#
#   deploy/cloudrun-down.sh            asks, then deletes
#   YES=1 deploy/cloudrun-down.sh      no question
#   deploy/cloudrun-down.sh --dry-run  print the delete command, delete nothing
set -euo pipefail
# shellcheck source=deploy/config.sh
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
require_gcloud

if ! is_dry && [[ -z "$(cloudrun_url)" ]]; then
  ok "Cloud Run service '$SERVICE' ($REGION) does not exist. Nothing to do."
  exit 0
fi
printf '\nThis deletes the Cloud Run service %s (%s) in project %s.\n' "$SERVICE" "$REGION" "$PROJECT_ID"
if [[ "${YES:-0}" != "1" ]] && ! is_dry; then
  [[ -t 0 ]] || die "Not a terminal: re-run with YES=1 to confirm."
  read -r -p "Type 'delete' to continue: " answer
  [[ "$answer" == "delete" ]] || die "Cancelled, nothing deleted."
fi
gc run services delete "$SERVICE" --region="$REGION" --quiet
ok "service deleted"
info "Optional, the build images:  gcloud artifacts repositories delete cloud-run-source-deploy --location=$REGION --project=$PROJECT_ID"
