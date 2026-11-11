# shellcheck shell=bash
# Shared settings for every deploy script. Sourced, never run.
#
# Every value below is an environment variable with a default. Override one of
# three ways (first wins):
#   1. on the command line:      ZONE=europe-west1-c deploy/gce-up.sh
#   2. in the project's .env:    copy .env.example to .env and edit it
#   3. the defaults right here.
# PROJECT_ID defaults to the active gcloud project (gcloud config set project ...).

PARTY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PARTY_ROOT

# .env loader: KEY=VALUE lines, # comments, optional quotes. A variable that is
# already set in the environment is NOT overwritten (the command line wins).
party_load_env_file() {
  local file="$1" line key val
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[2]}"
    val="${BASH_REMATCH[3]}"
    if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    [[ -n "${!key+x}" ]] || export "$key=$val"
  done <"$file"
}
party_load_env_file "${PARTY_ENV_FILE:-$PARTY_ROOT/.env}"

# ── Google Cloud ────────────────────────────────────────────────────────────
if [[ -z "${PROJECT_ID:-}" ]] && command -v gcloud >/dev/null 2>&1; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi
: "${PROJECT_ID:=}"
: "${REGION:=europe-west1}"
: "${ZONE:=${REGION}-b}"

# ── A. Compute Engine VM ────────────────────────────────────────────────────
: "${INSTANCE:=party-arena}"
: "${MACHINE_TYPE:=e2-small}"
: "${IMAGE_FAMILY:=debian-12}"
: "${IMAGE_PROJECT:=debian-cloud}"
: "${BOOT_DISK_SIZE:=10GB}"
: "${NETWORK:=default}"
: "${NETWORK_TAG:=party-arena-web}"
: "${IP_NAME:=party-arena-ip}"
: "${FW_WEB:=party-arena-allow-web}"
: "${FW_SSH:=party-arena-allow-ssh}"
# Node major version installed on the VM (NodeSource).
: "${NODE_MAJOR:=22}"
# Port the Node server listens on inside the VM (Caddy proxies 443 -> it).
: "${APP_PORT:=8080}"
# Your own hostname (an A record pointing at the static IP). Empty = <ip-with-dashes>.sslip.io.
: "${DOMAIN:=}"
# Optional e-mail for Let's Encrypt expiry notices. Empty is fine.
: "${ACME_EMAIL:=}"
# Seconds gce-deploy.sh waits for https://<host>/healthz (first boot issues the certificate).
: "${HEALTH_TIMEOUT:=420}"

# ── B. Cloud Run ────────────────────────────────────────────────────────────
: "${SERVICE:=party-arena}"
: "${RUN_MEMORY:=1Gi}"
: "${RUN_CPU:=1}"
: "${RUN_CONCURRENCY:=1000}"
: "${RUN_TIMEOUT:=3600}"

# ── C. Firebase Hosting ─────────────────────────────────────────────────────
: "${FIREBASE_PROJECT:=$PROJECT_ID}"
# Which server the Firebase-hosted client talks to: auto | gce | cloudrun | an https:// URL.
: "${FIREBASE_BACKEND:=auto}"
: "${FIREBASE_TOOLS_VERSION:=latest}"

export PROJECT_ID REGION ZONE INSTANCE MACHINE_TYPE IMAGE_FAMILY IMAGE_PROJECT BOOT_DISK_SIZE \
  NETWORK NETWORK_TAG IP_NAME FW_WEB FW_SSH NODE_MAJOR APP_PORT DOMAIN ACME_EMAIL HEALTH_TIMEOUT \
  SERVICE RUN_MEMORY RUN_CPU RUN_CONCURRENCY RUN_TIMEOUT \
  FIREBASE_PROJECT FIREBASE_BACKEND FIREBASE_TOOLS_VERSION

# Never stop on an interactive gcloud prompt (key generation, API enabling, ...).
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

# ── helpers ─────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  _B=$'\e[1m' _G=$'\e[32m' _Y=$'\e[33m' _R=$'\e[31m' _C=$'\e[36m' _N=$'\e[0m'
else
  _B='' _G='' _Y='' _R='' _C='' _N=''
fi

step() { printf '\n%s==> %s%s\n' "$_B$_C" "$*" "$_N"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    %s✓%s %s\n' "$_G" "$_N" "$*"; }
warn() { printf '    %s!%s %s\n' "$_Y" "$_N" "$*" >&2; }
die() {
  printf '\n%s✗ %s%s\n' "$_R$_B" "$*" "$_N" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is not installed. ${2:-}"
}

# gcloud with the project always pinned (never a surprise from another config).
gc() { gcloud --project="$PROJECT_ID" "$@"; }

require_gcloud() {
  need_cmd gcloud "Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install"
  local account
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1 || true)"
  [[ -n "$account" ]] || die "gcloud is not logged in. Run:  gcloud auth login"
  [[ -n "$PROJECT_ID" ]] || die "No Google Cloud project chosen. Run:  gcloud config set project YOUR_PROJECT_ID   (list them: gcloud projects list)"
  info "account $account · project $PROJECT_ID · region $REGION"
}

# Enable APIs; a no-op for the ones already on.
enable_apis() {
  step "Enabling APIs: $*"
  gc services enable "$@"
  ok "APIs enabled"
}

# 34.77.1.2 -> 34-77-1-2.sslip.io (or $DOMAIN when set).
party_hostname() {
  local ip="$1"
  if [[ -n "$DOMAIN" ]]; then printf '%s' "$DOMAIN"; else printf '%s.sslip.io' "${ip//./-}"; fi
}

# Static IP of the VM, empty when it was never reserved.
vm_ip() {
  gc compute addresses describe "$IP_NAME" --region="$REGION" --format='value(address)' 2>/dev/null || true
}

cloudrun_url() {
  gc run services describe "$SERVICE" --region="$REGION" --format='value(status.url)' 2>/dev/null || true
}

# Print the party addresses and a QR code of the phone URL.
#   print_party_urls <phone-url> [<game-server-url>]
print_party_urls() {
  local url="${1%/}" server="${2:-${1%/}}"
  local qr="$PARTY_ROOT/node_modules/.bin/qrcode"
  printf '\n%s🎉  The party is live%s\n\n' "$_B$_G" "$_N"
  printf '   Phones (the QR on the TV points here):  %s%s/%s\n' "$_B" "$url" "$_N"
  printf '   TV host page (open on the laptop):      %s%s/host%s\n' "$_B" "$url" "$_N"
  printf '   Server health:                          %s/healthz\n\n' "$server"
  if [[ -x "$qr" ]]; then
    info "QR of the phone URL (the TV page shows its own QR too):"
    "$qr" --small "$url/" </dev/null || true
  fi
  info "QR in any terminal:  npx --yes qrcode --small \"$url/\""
  if [[ "$server" == "$url" ]]; then
    info "Check from outside:  deploy/smoke.sh $url"
  else
    info "Check from outside:  deploy/smoke.sh $url $server"
  fi
}
