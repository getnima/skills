#!/usr/bin/env bash
# A. Open a shell on the party VM. Extra arguments go to `gcloud compute ssh`,
# e.g.  deploy/gce-ssh.sh --command='sudo systemctl status party-arena caddy'
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
require_gcloud

# Interactive: allow the one-time SSH key prompt.
unset CLOUDSDK_CORE_DISABLE_PROMPTS
gc compute ssh "$INSTANCE" --zone="$ZONE" "$@"
