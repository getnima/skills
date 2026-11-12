#!/usr/bin/env bash
# A. Open a shell on the party VM. Extra arguments go to `gcloud compute ssh`,
# e.g.  deploy/gce-ssh.sh --command='sudo systemctl status party-arena caddy'
#
#   deploy/gce-ssh.sh             a shell on the VM
#   deploy/gce-ssh.sh --dry-run   print the gcloud command
set -euo pipefail
# shellcheck source=deploy/config.sh
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
require_gcloud

# Interactive: allow the one-time SSH key prompt.
unset CLOUDSDK_CORE_DISABLE_PROMPTS
gc compute ssh "$INSTANCE" --zone="$ZONE" ${1+"$@"}
