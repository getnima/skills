#!/usr/bin/env bash
# C. (Optional) The phone pages on Firebase Hosting: https://<project>.web.app
#
# Firebase Hosting serves static files only and cannot proxy websockets, so the
# game server stays where path A (VM) or B (Cloud Run) put it, at its own HTTPS
# address. This script:
#   1. finds that server (FIREBASE_BACKEND=auto | gce | cloudrun | https://...),
#   2. builds the client with VITE_SERVER_URL=<server>,
#   3. allows the web.app origin on the server (CLIENT_ORIGIN; restarts it only if it changed),
#   4. deploys dist/client to Firebase Hosting with npx firebase-tools.
# One-time: npx --yes firebase-tools login
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

need_cmd npm "Install Node.js 22: https://nodejs.org"
need_cmd node
need_cmd curl
require_gcloud
[[ -n "$FIREBASE_PROJECT" ]] || die "FIREBASE_PROJECT is empty (defaults to PROJECT_ID)."

fb() { npx --yes "firebase-tools@$FIREBASE_TOOLS_VERSION" --non-interactive "$@"; }

step "Firebase login"
if ! fb login:list 2>/dev/null | grep -q '@'; then
  die "firebase-tools is not logged in. Run once:  npx --yes firebase-tools login   (then re-run this script)"
fi
ok "logged in"

# ── 1. the game server ──
step "Game server (FIREBASE_BACKEND=$FIREBASE_BACKEND)"
SERVER_URL=""
BACKEND="$FIREBASE_BACKEND"
case "$BACKEND" in
  https://*) SERVER_URL="${BACKEND%/}"; BACKEND=url ;;
  gce | cloudrun | auto) ;;
  *) die "FIREBASE_BACKEND must be auto, gce, cloudrun or an https:// URL (got '$BACKEND')." ;;
esac
if [[ "$BACKEND" == auto || "$BACKEND" == gce ]]; then
  IP="$(vm_ip)"
  if [[ -n "$IP" ]] && gc compute instances describe "$INSTANCE" --zone="$ZONE" --format='value(name)' >/dev/null 2>&1; then
    SERVER_URL="https://$(party_hostname "$IP")"
    BACKEND=gce
  elif [[ "$BACKEND" == gce ]]; then
    die "No VM '$INSTANCE' / IP '$IP_NAME'. Run deploy/gce-up.sh first."
  fi
fi
if [[ -z "$SERVER_URL" && ( "$BACKEND" == auto || "$BACKEND" == cloudrun ) ]]; then
  SERVER_URL="$(cloudrun_url)"
  BACKEND=cloudrun
  [[ -n "$SERVER_URL" ]] || die "No game server found. Deploy one first: deploy/gce-up.sh (recommended) or deploy/cloudrun-deploy.sh"
fi
curl -fsS --max-time 8 "$SERVER_URL/healthz" >/dev/null || die "The game server at $SERVER_URL does not answer /healthz. Fix it first (deploy/smoke.sh $SERVER_URL)."
ok "$SERVER_URL ($BACKEND)"

# ── Firebase project + its default site ──
step "Firebase project $FIREBASE_PROJECT"
enable_apis firebase.googleapis.com firebasehosting.googleapis.com
if ! SITES_JSON="$(fb hosting:sites:list --project "$FIREBASE_PROJECT" --json 2>/dev/null)"; then
  info "adding Firebase to the Google Cloud project"
  fb projects:addfirebase "$FIREBASE_PROJECT"
  SITES_JSON="$(fb hosting:sites:list --project "$FIREBASE_PROJECT" --json)"
fi
SITE_URL="$(printf '%s' "$SITES_JSON" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try {
      const sites = JSON.parse(s).result?.sites ?? [];
      const site = sites.find((x) => x.type === "DEFAULT_SITE") ?? sites[0];
      process.stdout.write(site?.defaultUrl ?? "");
    } catch { process.stdout.write(""); }
  });')"
SITE_URL="${SITE_URL:-https://$FIREBASE_PROJECT.web.app}"
SITE_URL="${SITE_URL%/}"
SITE_HOST="${SITE_URL#https://}"
SITE_ID="${SITE_HOST%%.*}"
ORIGINS="https://$SITE_ID.web.app,https://$SITE_ID.firebaseapp.com,$SERVER_URL"
ok "site $SITE_URL"

# ── 2. build the client against the server ──
step "Building the client with VITE_SERVER_URL=$SERVER_URL"
cd "$PARTY_ROOT"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
VITE_SERVER_URL="$SERVER_URL" npm run build:client
[[ -f dist/client/index.html ]] || die "dist/client/index.html missing after the build."
ok "dist/client"

# ── 3. allow the web.app origin on the server ──
step "Allowing $SITE_URL on the game server (CLIENT_ORIGIN)"
if [[ "$BACKEND" == gce ]]; then
  gc compute ssh "$INSTANCE" --zone="$ZONE" --quiet --command="
    set -e
    want='CLIENT_ORIGIN=$ORIGINS'
    if [ \"\$(sudo cat /etc/party-arena.env 2>/dev/null)\" != \"\$want\" ]; then
      echo \"\$want\" | sudo tee /etc/party-arena.env >/dev/null
      sudo systemctl restart party-arena
      echo '    restarted the server with the new CLIENT_ORIGIN'
    else
      echo '    already set'
    fi"
elif [[ "$BACKEND" == cloudrun ]]; then
  CURRENT="$(gc run services describe "$SERVICE" --region="$REGION" --format=json | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const env = JSON.parse(s).spec?.template?.spec?.containers?.[0]?.env ?? [];
      process.stdout.write(env.find((e) => e.name === "CLIENT_ORIGIN")?.value ?? "");
    });')"
  if [[ "$CURRENT" == "$ORIGINS" ]]; then
    ok "already set"
  else
    gc run services update "$SERVICE" --region="$REGION" --update-env-vars="^@^CLIENT_ORIGIN=$ORIGINS" --quiet
    ok "updated (new revision)"
  fi
else
  warn "Custom server URL: set CLIENT_ORIGIN=$ORIGINS on it yourself."
fi

# ── 4. deploy ──
step "Deploying dist/client to Firebase Hosting"
fb deploy --only hosting --project "$FIREBASE_PROJECT"
ok "deployed"

# Put the same-origin build back, so a later local `npm start` does not point at the server.
step "Restoring the same-origin client build"
env -u VITE_SERVER_URL npm run build:client >/dev/null
ok "dist/client rebuilt without VITE_SERVER_URL"

print_party_urls "$SITE_URL" "$SERVER_URL"
info "The game server (websocket) stays at $SERVER_URL"
