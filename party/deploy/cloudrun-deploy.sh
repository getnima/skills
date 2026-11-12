#!/usr/bin/env bash
# B. Cloud Run: build the Dockerfile in Cloud Build and run it as ONE always-on
# instance at https://<service>-<hash>.<region>.run.app (client + websocket).
#
#   deploy/cloudrun-deploy.sh            build + deploy (safe to re-run)
#   deploy/cloudrun-deploy.sh --dry-run  print the gcloud commands, run nothing
#   FORCE=1 deploy/cloudrun-deploy.sh    do not ask when players are connected
#
# Works on a brand-new project (billing on): enables the APIs, lets the build
# service account build, deploys with min = max = 1 instance (rooms live in the
# memory of that one process), CPU always on (the round clock runs on server
# timers), 3600 s request timeout (websockets), session affinity, public access.
# Rooms live in memory: a deploy starts a new instance and drops every room.
set -euo pipefail
# shellcheck source=deploy/config.sh
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

need_cmd curl
require_gcloud

URL="$(cloudrun_url)"
[[ -z "$URL" ]] || guard_live_party "$URL" "A deploy replaces the instance and drops them."

# compute: makes sure the default service account (build + runtime identity) exists.
enable_apis run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com compute.googleapis.com

# Source deploys build as the Compute Engine default service account. New
# projects no longer give it build rights, which fails the build with a
# PERMISSION_DENIED; this grant is what Google's docs prescribe (idempotent).
step "Build permissions"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
granted=0
for attempt in 1 2 3 4; do
  if gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$BUILD_SA" \
    --role=roles/run.builder --condition=None >/dev/null 2>&1; then
    granted=1
    break
  fi
  # A service account made a few seconds ago (fresh project) is not visible to IAM yet.
  [[ "$attempt" == 4 ]] || sleep 10
done
if [[ "$granted" == 1 ]]; then
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
    printf "%s='%s'\n" "$var" "${!var}" >>"$BUILD_ENV"
    info "build setting $var=${!var}"
  fi
done

step "Building and deploying '$SERVICE' to Cloud Run ($REGION). The first build takes 3-5 minutes."
cd "$PARTY_ROOT"
# --min/--max-instances=1: one process holds every room (never two instances).
# --no-cpu-throttling: CPU always allocated, so server timers fire with no request in flight.
# --timeout=3600: the longest a websocket may stay open (phones reconnect by themselves after).
# --concurrency=1000: every phone and the TV hold one websocket each.
# --startup-probe: traffic only once /healthz answers.
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
  --startup-probe=httpGet.path=/healthz,httpGet.port=8080,periodSeconds=2,timeoutSeconds=2,failureThreshold=30 \
  --labels=app=party-arena \
  --update-env-vars="^@^$ENV_VARS" \
  --quiet

URL="$(cloudrun_url)"
if is_dry; then URL="https://$SERVICE-xxxxxxxxxx-ew.a.run.app"; fi
[[ -n "$URL" ]] || die "Deployed, but could not read the service URL: gcloud run services describe $SERVICE --region=$REGION"

health_code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "$URL/healthz" 2>/dev/null || true; }

step "Checking $URL/healthz"
if is_dry; then
  info "(dry run) would wait for $URL/healthz"
else
  code=000
  for i in $(seq 1 30); do
    code="$(health_code)"
    [[ "$code" == 200 || "$code" == 403 ]] && break
    sleep 3
  done
  if [[ "$code" == 403 ]]; then
    # An organization policy (Domain Restricted Sharing) refused the public "allUsers"
    # access. Turning the invoker check off makes the service public without it.
    warn "The service answers 403: public access was refused (organization policy). Turning off the invoker IAM check."
    gc run services update "$SERVICE" --region="$REGION" --no-invoker-iam-check --quiet ||
      die "Could not make the service public. A project Owner runs:  gcloud run services update $SERVICE --region=$REGION --no-invoker-iam-check"
    for i in $(seq 1 20); do
      code="$(health_code)"
      [[ "$code" == 200 ]] && break
      sleep 3
    done
  fi
  [[ "$code" == 200 ]] || die "No answer from $URL/healthz (HTTP $code). Logs: gcloud run services logs read $SERVICE --region=$REGION --project=$PROJECT_ID"
  ok "$(curl -fsS --max-time 8 "$URL/healthz")"
fi

print_party_urls "$URL"
info "Logs:  gcloud run services logs read $SERVICE --region=$REGION --project=$PROJECT_ID --limit=100"
