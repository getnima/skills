#!/usr/bin/env bash
# Check everything the deploy scripts need, and say exactly what to run when
# something is missing. Read-only: changes nothing, costs nothing.
#
#   deploy/doctor.sh
set -euo pipefail
# shellcheck source=deploy/config.sh
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
# Read-only already: --dry-run changes nothing here.
DRY_RUN=0

problems=0
problem() {
  printf '    %s✗%s %s\n' "$_R" "$_N" "$1"
  shift
  for fix in "$@"; do printf '        run:  %s%s%s\n' "$_B" "$fix" "$_N"; done
  problems=$((problems + 1))
}

step "Local tools"
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if ((major >= 22)); then ok "node $(node --version)"; elif ((major >= 20)); then warn "node $(node --version): works, Node 22 recommended"; else problem "node $(node --version) is too old (need 20+, 22 recommended)" "install Node 22 from https://nodejs.org"; fi
else
  problem "node is not installed" "install Node 22 from https://nodejs.org"
fi
if command -v npm >/dev/null 2>&1; then ok "npm $(npm --version)"; else problem "npm is not installed" "install Node 22 from https://nodejs.org"; fi
for tool in curl tar ssh; do
  if command -v "$tool" >/dev/null 2>&1; then ok "$tool"; else problem "$tool is not installed" "install $tool with your package manager"; fi
done
if [[ -d "$PARTY_ROOT/node_modules" ]]; then ok "node_modules installed"; else problem "dependencies are not installed" "cd $PARTY_ROOT && npm install"; fi

step "Google Cloud CLI"
if ! command -v gcloud >/dev/null 2>&1; then
  problem "gcloud is not installed" "see https://cloud.google.com/sdk/docs/install"
  printf '\n%s%d problem(s).%s Fix them, then run deploy/doctor.sh again.\n' "$_R$_B" "$problems" "$_N"
  exit 1
fi
ok "$(gcloud --version 2>/dev/null | head -n1)"

account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1 || true)"
if [[ -z "$account" ]]; then
  problem "gcloud is not logged in" "gcloud auth login"
else
  if gcloud auth print-access-token >/dev/null 2>&1; then
    ok "logged in as $account"
  else
    problem "the gcloud login of $account has expired" "gcloud auth login"
    account=""
  fi
fi

project_ok=0
if [[ -z "$PROJECT_ID" ]]; then
  problem "no project chosen" "gcloud projects list                      (find your project id)" \
    "gcloud config set project YOUR_PROJECT_ID" \
    "gcloud projects create party-arena-$RANDOM --set-as-default   (only to make a NEW project)"
elif [[ -n "$account" ]]; then
  if gc projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null 2>&1; then
    ok "project $PROJECT_ID"
    project_ok=1
  else
    problem "project '$PROJECT_ID' does not exist or $account cannot see it" "gcloud projects list" "gcloud config set project YOUR_PROJECT_ID"
  fi
fi

if ((project_ok)); then
  step "Billing"
  billing="$(gc billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || echo unknown)"
  case "$billing" in
    True | true) ok "billing is enabled" ;;
    False | false)
      problem "billing is NOT enabled on $PROJECT_ID (VMs and Cloud Run need it)" \
        "gcloud billing accounts list" \
        "gcloud billing projects link $PROJECT_ID --billing-account=XXXXXX-XXXXXX-XXXXXX" \
        "or in the browser: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
      ;;
    *) warn "could not read the billing state (fine if you know billing is on): https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID" ;;
  esac

  step "APIs (the deploy scripts enable what they need)"
  enabled="$(gc services list --enabled --format='value(config.name)' 2>/dev/null || true)"
  for api in compute.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firebasehosting.googleapis.com; do
    if grep -qx "$api" <<<"$enabled"; then ok "$api"; else info "- $api is off (enabled automatically when a script needs it)"; fi
  done

  if grep -qx compute.googleapis.com <<<"$enabled"; then
    step "Compute quota in $REGION (for path A)"
    have_ip="$(vm_ip)"
    # shellcheck disable=SC2016 # a node program, not shell
    gc compute regions describe "$REGION" --format=json 2>/dev/null | HAVE_IP="$have_ip" node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const q = Object.fromEntries((JSON.parse(s).quotas ?? []).map((x) => [x.metric, x]));
        const free = (m) => (q[m] ? q[m].limit - q[m].usage : null);
        const need = { CPUS: 2, E2_CPUS: 2, IN_USE_ADDRESSES: 1, STATIC_ADDRESSES: process.env.HAVE_IP ? 0 : 1 };
        let bad = 0;
        for (const [m, n] of Object.entries(need)) {
          const f = free(m);
          if (f === null) continue;
          const okq = f >= n;
          if (!okq) bad++;
          console.log(`    ${okq ? "✓" : "✗"} ${m}: ${f} free${okq ? "" : " (need " + n + ")"}`);
        }
        process.exit(bad ? 3 : 0);
      });' || problem "not enough Compute quota in $REGION" "use another region:  REGION=europe-west4 deploy/gce-up.sh" \
      "or request more: https://console.cloud.google.com/iam-admin/quotas?project=$PROJECT_ID"

    if gc compute networks describe "$NETWORK" --format='value(name)' >/dev/null 2>&1; then ok "network '$NETWORK' exists"; else info "- network '$NETWORK' is missing (gce-up.sh creates it)"; fi
  fi

  step "What is deployed now"
  ip="$(vm_ip)"
  vm="$(gc compute instances describe "$INSTANCE" --zone="$ZONE" --format='value(status)' 2>/dev/null || true)"
  [[ -n "$ip" ]] && ok "static IP $IP_NAME: $ip  (for a custom DOMAIN, point its A record here)"
  if [[ -n "$vm" ]]; then
    ok "VM $INSTANCE: $vm, https://$(party_hostname "${ip:-0.0.0.0}")"
  else
    info "- no VM '$INSTANCE' in $ZONE (path A: deploy/gce-up.sh)"
  fi
  run_url="$(cloudrun_url)"
  if [[ -n "$run_url" ]]; then ok "Cloud Run $SERVICE: $run_url"; else info "- no Cloud Run service '$SERVICE' in $REGION (path B: deploy/cloudrun-deploy.sh)"; fi
fi

step "Firebase (only for path C)"
info "- one-time login for path C:  npx --yes firebase-tools login"

echo
if ((problems == 0)); then
  printf '%s%sAll set.%s Next: deploy/gce-up.sh (recommended) or deploy/cloudrun-deploy.sh\n' "$_G" "$_B" "$_N"
else
  printf '%s%s%d problem(s).%s Run the commands above, then deploy/doctor.sh again.\n' "$_R" "$_B" "$problems" "$_N"
  exit 1
fi
