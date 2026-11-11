#!/usr/bin/env bash
# A. Follow the VM's logs (Ctrl+C to stop).
#
#   deploy/gce-logs.sh            the game server and Caddy (live)
#   deploy/gce-logs.sh app        only the game server
#   deploy/gce-logs.sh caddy      only Caddy (HTTPS certificate, proxy errors)
#   deploy/gce-logs.sh startup    the boot script (Node / Caddy install)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
require_gcloud

case "${1:-all}" in
  all) units="-u party-arena -u caddy" ;;
  app | server) units="-u party-arena" ;;
  caddy | tls | https) units="-u caddy" ;;
  startup | boot) units="-u google-startup-scripts" ;;
  *) die "Unknown log '$1'. Use: all | app | caddy | startup" ;;
esac

gc compute ssh "$INSTANCE" --zone="$ZONE" --quiet \
  --command="sudo journalctl $units -n 200 -f --no-pager -o short-iso"
