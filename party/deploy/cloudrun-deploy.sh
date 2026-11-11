#!/usr/bin/env bash
# B. Cloud Run: build the Dockerfile in Cloud Build and run it as ONE always-on
# instance at https://<service>-<hash>.<region>.run.app (client + websocket).
#
#   deploy/cloudrun-deploy.sh            build + deploy (safe to re-run)
#   FORCE=1 deploy/cloudrun-deploy.sh    do not ask when players are connected
#
# Rooms live in memory: a deploy starts a new instance and drops every room.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

need_cmd curl
require_gcloud

URL="$(cloudrun_url)"
if [[ -n "$URL" ]] && health="$(curl -fsS --max-time 5 "$URL/healthz" 2>/dev/null)"; then
  players="$(printf '%s' "$health" | sed -n 's/.*"players":\([0-9]*\).*/\1/p')"
  if [[ "${players:-0}" -gt 0 && "${FORCE:-0}" != "1" ]]; then
    warn "The live service has $players player(s) in its rooms. A deploy replaces the instance and drops them."
    if [[ -t 0 ]]; then
      read -r -p "    Deploy anyway? [y/N] " answer
      [[ "$answer" =~ ^[Yy] ]] || die "Cancelled."
    else
      die "Not deploying over a live party. Re-run with FORCE=1 if you are sure."
    fi
  fi
fi

enable_apis run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# Source deploys build as the Compute Engine default service account. New
# projects no longer give it build rights, which fails the build with a
# PERMISSION_DENIED; this grant is what Google's docs prescribe (idempotent).
step "Build permissions"
PROJECT_NUMBER="$(gc projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
if gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$BUILD_SA" \
  --role=roles/run.builder --condition=None >/dev/null 2>&1; then
  ok "$BUILD_SA can build"
else
  warn "Could not grant roles/run.builder to $BUILD_SA (needs project Owner). If the build fails with PERMISSION_DENIED, an Owner runs:"
  info "gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$BUILD_SA --role=roles/run.builder"
fi

ENV_VARS="NODE_ENV=production"
if [[ -n "${CLIENT_ORIGIN:-}" ]]; then ENV_VARS="$ENV_VARS@CLIENT_ORIGIN=$CLIENT_ORIGIN"; fi

# Build-time client switches travel to Cloud Build in deploy/.build-env (read by the Dockerfile).
BUILD_ENV="$PARTY_ROOT/deploy/.build-env"
rm -f "$BUILD_ENV"
trap 'rm -f "$BUILD_ENV"' EXIT
for var in VITE_PLOTZEL_MODE VITE_PLOTZEL_URL VITE_PUBLIC_URL; do
  if [[ -n "${!var:-}" ]]; then
    printf '%s=%q\n' "$var" "${!var}" >>"$BUILD_ENV"
    info "build setting $var=${!var}"
  fi
done

step "Building and deploying '$SERVICE' to Cloud Run ($REGION). The first build takes 3-5 minutes."
cd "$PARTY_ROOT"
gc run deploy "$SERVICE" \
  --source=. \
  --region="$REGION" \
  --allow-unauthenticated \
  --port=8080 \
  --min-instances=1 \
  --max-instances=1 \
  --no-cpu-throttling \
  --cpu-boost \
  --cpu="$RUN_CPU" \
  --memory="$RUN_MEMORY" \
  --concurrency="$RUN_CONCURRENCY" \
  --timeout="$RUN_TIMEOUT" \
  --session-affinity \
  --execution-environment=gen2 \
  --labels=app=party-arena \
  --update-env-vars="^@^$ENV_VARS" \
  --quiet

URL="$(cloudrun_url)"
[[ -n "$URL" ]] || die "Deployed, but could not read the service URL: gcloud run services describe $SERVICE --region=$REGION"

step "Checking $URL/healthz"
for i in $(seq 1 30); do
  if curl -fsS --max-time 8 "$URL/healthz" >/dev/null 2>&1; then break; fi
  [[ "$i" == 30 ]] && die "No answer from $URL/healthz. Logs: gcloud run services logs read $SERVICE --region=$REGION --project=$PROJECT_ID"
  sleep 3
done
ok "$(curl -fsS --max-time 8 "$URL/healthz")"

print_party_urls "$URL"
info "Logs:  gcloud run services logs read $SERVICE --region=$REGION --project=$PROJECT_ID --limit=100"
