# shellcheck shell=bash
# Shared settings for every deploy script. Sourced, never run.
#
# Every value below is an environment variable with a default. Override one of
# three ways (first wins):
#   1. on the command line:      ZONE=europe-west1-c deploy/gce-up.sh
#   2. in the project's .env:    copy .env.example to .env and edit it
#   3. the defaults right here.
# PROJECT_ID defaults to the active gcloud project (gcloud config set project ...).
#
# Every script that sources this file understands:
#   -h, --help      print the script's header and exit
#   -n, --dry-run   print the gcloud / build commands instead of running them
#                   (also DRY_RUN=1). Reads answer "not found", so a dry run
#                   shows what a run on a brand-new project would do.
# Written for bash 3.2 (macOS) and newer: no associative arrays, no mapfile,
# no GNU-only flags.

PARTY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PARTY_ROOT

# ── command line (sourced without arguments, so "$@" is the script's own) ───
party_usage() {
  # The comment block under the shebang of the script that was run.
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  printf '\nCommon options:  -h, --help   this text      -n, --dry-run   print the commands, run nothing\n'
}
: "${DRY_RUN:=0}"
_party_rest=()
for _party_arg in "$@"; do
  case "$_party_arg" in
    -h | --help)
      party_usage
      exit 0
      ;;
    -n | --dry-run) DRY_RUN=1 ;;
    *) _party_rest+=("$_party_arg") ;;
  esac
done
# Give the script its other arguments back (bash 3.2 safe for an empty list).
set -- ${_party_rest[@]+"${_party_rest[@]}"}
unset _party_arg _party_rest
export DRY_RUN
is_dry() { [[ "$DRY_RUN" == 1 ]]; }

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
# europe-west1 (Belgium): Tier 1 price, every product, about 60 ms from Israel.
# europe-west3 (Frankfurt) is ~10 ms closer but Tier 2 (dearer); the game does not
# need it (the server keeps time, phones sync their clock by ping).
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
# Node major version installed on the VM (NodeSource, or the nodejs.org tarball as a fallback).
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
  _B=$'\e[1m' _G=$'\e[32m' _Y=$'\e[33m' _R=$'\e[31m' _C=$'\e[36m' _D=$'\e[2m' _N=$'\e[0m'
else
  _B='' _G='' _Y='' _R='' _C='' _D='' _N=''
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
  command -v "$1" >/dev/null 2>&1 && return 0
  if is_dry; then
    warn "'$1' is not installed (dry run goes on). ${2:-}"
    return 0
  fi
  die "'$1' is not installed. ${2:-}"
}

# Print a command the way a shell would read it back.
_party_show() {
  local out='' a
  for a in "$@"; do
    case "$a" in
      *[!A-Za-z0-9_./:=@%+,^-]* | '') out="$out $(printf '%q' "$a")" ;;
      *) out="$out $a" ;;
    esac
  done
  printf '    %s[dry-run]%s$%s\n' "$_D" "$_N" "$out" >&2
}

# Run a command, or only print it under --dry-run.
run() {
  if is_dry; then
    _party_show "$@"
    return 0
  fi
  "$@"
}

# gcloud with the project always pinned (never a surprise from another config).
# Under --dry-run it prints the command; a read (describe / list / ...) then
# answers "not found" and a write answers "done".
gc() {
  if is_dry; then
    _party_show gcloud --project="$PROJECT_ID" "$@"
    local a
    for a in "$@"; do
      case "$a" in describe | list | get-value | read | get-iam-policy) return 1 ;; esac
    done
    return 0
  fi
  gcloud --project="$PROJECT_ID" "$@"
}

# Login and project: stop early with the exact fix instead of a gcloud stack of errors.
require_gcloud() {
  if is_dry; then
    command -v gcloud >/dev/null 2>&1 || warn "gcloud is not installed (dry run goes on): https://cloud.google.com/sdk/docs/install"
    [[ -n "$PROJECT_ID" ]] || PROJECT_ID=YOUR_PROJECT_ID
    FIREBASE_PROJECT="${FIREBASE_PROJECT:-$PROJECT_ID}"
    PROJECT_NUMBER=123456789012
    info "dry run: nothing is created or changed · project $PROJECT_ID · region $REGION"
    return 0
  fi
  need_cmd gcloud "Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install"
  local account
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1 || true)"
  [[ -n "$account" ]] || die "gcloud is not logged in. Run:  gcloud auth login"
  gcloud auth print-access-token >/dev/null 2>&1 ||
    die "The gcloud login of $account has expired or is broken. Run:  gcloud auth login"
  [[ -n "$PROJECT_ID" ]] || die "No Google Cloud project chosen. Run:  gcloud config set project YOUR_PROJECT_ID   (list them: gcloud projects list)"
  PROJECT_NUMBER="$(gc projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || true)"
  [[ -n "$PROJECT_NUMBER" ]] ||
    die "Project '$PROJECT_ID' does not exist or $account cannot open it. See:  gcloud projects list   then  gcloud config set project THE_ID"
  info "account $account · project $PROJECT_ID · region $REGION"
}

# Billing must be on before anything is created (VMs, Cloud Run, Cloud Build).
require_billing() {
  is_dry && return 0
  local billing
  billing="$(gc billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || true)"
  case "$billing" in
    True | true) ;;
    False | false)
      die "Billing is OFF for project $PROJECT_ID (VMs and Cloud Run need it). Link a billing account:
      gcloud billing accounts list
      gcloud billing projects link $PROJECT_ID --billing-account=XXXXXX-XXXXXX-XXXXXX
   or in the browser: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
      ;;
    *) warn "Could not read the billing state of $PROJECT_ID (fine if you know billing is on)." ;;
  esac
}

# Enable APIs; a no-op for the ones already on. The first time on a new project
# this takes a minute.
enable_apis() {
  step "Enabling APIs: $*"
  if ! gc services enable "$@"; then
    die "Could not enable $*. Usually billing is off on $PROJECT_ID or your account is not Owner/Editor of it. Check with:  deploy/doctor.sh"
  fi
  ok "APIs enabled"
}

# A documentation-range address (RFC 5737) stands in for the VM's IP in a dry run.
DRY_IP=203.0.113.10
export DRY_IP

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

# The live server's player count from /healthz, empty when it does not answer.
live_players() {
  local health
  is_dry && return 0
  health="$(curl -fsS --max-time 5 "$1/healthz" 2>/dev/null)" || return 0
  printf '%s' "$health" | sed -n 's/.*"players":\([0-9]*\).*/\1/p'
}

# Stop before a deploy that would drop a running party (FORCE=1 skips the question).
guard_live_party() {
  local url="$1" what="$2" players
  players="$(live_players "$url")"
  [[ "${players:-0}" -gt 0 && "${FORCE:-0}" != "1" ]] || return 0
  warn "The live server has $players player(s) in its rooms. $what"
  if [[ -t 0 ]]; then
    local answer
    read -r -p "    Deploy anyway? [y/N] " answer
    [[ "$answer" =~ ^[Yy] ]] || die "Cancelled."
  else
    die "Not deploying over a live party. Re-run with FORCE=1 if you are sure."
  fi
}

# Print the party addresses and a QR code of the phone URL.
#   print_party_urls <phone-url> [<game-server-url>]
print_party_urls() {
  local url="${1%/}" server="${2:-${1%/}}"
  local qr="$PARTY_ROOT/node_modules/.bin/qrcode"
  if is_dry; then
    printf '\n%sDry run finished: nothing was changed.%s A real run ends with:\n' "$_B" "$_N"
  else
    printf '\n%s🎉  The party is live%s\n\n' "$_B$_G" "$_N"
  fi
  printf '   Phones (the QR on the TV points here):  %s%s/%s\n' "$_B" "$url" "$_N"
  printf '   TV host page (open on the laptop):      %s%s/host%s\n' "$_B" "$url" "$_N"
  printf '   Server health:                          %s/healthz\n\n' "$server"
  if [[ -x "$qr" ]] && ! is_dry; then
    info "QR of the phone URL (the TV page shows its own QR with the room code too):"
    "$qr" --small "$url/" </dev/null || true
  fi
  info "QR in any terminal:  npx --yes qrcode --small \"$url/\""
  if [[ "$server" == "$url" ]]; then
    info "Check from outside:  deploy/smoke.sh $url"
  else
    info "Check from outside:  deploy/smoke.sh $url $server"
  fi
}
