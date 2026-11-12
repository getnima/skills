#!/usr/bin/env bash
# C. (Optional) The phone pages on Firebase Hosting: https://<project>.web.app
#
# Firebase Hosting serves static files only and cannot proxy websockets, so the
# game server stays where path A (VM) or B (Cloud Run) put it, at its own HTTPS
# address. This script:
#   1. finds that server (FIREBASE_BACKEND=auto | gce | cloudrun | https://...),
#   2. builds the client with VITE_SERVER_URL=<server>,
#   3. checks the server accepts the web.app origin (it does by default: nothing restarts),
#   4. deploys dist/client to Firebase Hosting with npx firebase-tools.
# One-time: npx --yes firebase-tools login
#
#   deploy/firebase-deploy.sh            find the server, build, deploy (safe to re-run)
#   deploy/firebase-deploy.sh --dry-run  print the commands, run nothing
#
# It buys a second, nicer address (<project>.web.app) and a CDN for the pages,
# nothing else: the single-origin address of A or B already serves everything.
set -euo pipefail
# shellcheck source=deploy/config.sh
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

need_cmd npm "Install Node.js 22: https://nodejs.org"
need_cmd node
need_cmd curl
require_gcloud
[[ -n "$FIREBASE_PROJECT" ]] || die "FIREBASE_PROJECT is empty (defaults to PROJECT_ID)."

fb() { run npx --yes "firebase-tools@$FIREBASE_TOOLS_VERSION" --non-interactive "$@"; }

step "Firebase login"
if is_dry; then
  info "(dry run) would check: npx --yes firebase-tools login:list"
elif ! fb login:list 2>/dev/null | grep -q '@'; then
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
  if is_dry; then IP="$DRY_IP"; fi
  if [[ -n "$IP" ]] && { is_dry || gc compute instances describe "$INSTANCE" --zone="$ZONE" --format='value(name)' >/dev/null 2>&1; }; then
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
is_dry || curl -fsS --max-time 8 "$SERVER_URL/healthz" >/dev/null || die "The game server at $SERVER_URL does not answer /healthz. Fix it first (deploy/smoke.sh $SERVER_URL)."
ok "$SERVER_URL ($BACKEND)"

# ── Firebase project + its default site ──
step "Firebase project $FIREBASE_PROJECT"
enable_apis firebase.googleapis.com firebasehosting.googleapis.com
if is_dry; then
  fb hosting:sites:list --project "$FIREBASE_PROJECT" --json
  info "(dry run) when that fails (Firebase not added to the project yet):"
  fb projects:addfirebase "$FIREBASE_PROJECT"
  SITES_JSON=''
elif ! SITES_JSON="$(fb hosting:sites:list --project "$FIREBASE_PROJECT" --json 2>/dev/null)"; then
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
[[ -d node_modules ]] || run npm ci --no-audit --no-fund
run env VITE_SERVER_URL="$SERVER_URL" npm run build:client
is_dry || [[ -f dist/client/index.html ]] || die "dist/client/index.html missing after the build."
ok "dist/client"

# ── 3. the server must accept the web.app origin ──
# The game server accepts every origin unless CLIENT_ORIGIN is set (the default
# is empty), so normally there is nothing to change and nothing restarts. Only a
# server that was locked to other origins gets web.app added (that restarts it).
step "Checking that the game server accepts $SITE_URL (CLIENT_ORIGIN)"
if [[ "$BACKEND" == gce ]]; then
  gc compute ssh "$INSTANCE" --zone="$ZONE" --quiet --command="
    set -e
    cur=\$(sudo sed -n 's/^CLIENT_ORIGIN=//p' /etc/party-arena.env 2>/dev/null | tail -n1)
    case \"\$cur\" in
      '') echo '    any origin is allowed (CLIENT_ORIGIN empty): nothing to change' ;;
      *$SITE_ID.web.app*) echo '    already allowed' ;;
      *)
        echo \"CLIENT_ORIGIN=\$cur,$ORIGINS\" | sudo tee /etc/party-arena.env >/dev/null
        sudo systemctl restart party-arena
        echo '    added web.app to CLIENT_ORIGIN and restarted the server' ;;
    esac"
elif [[ "$BACKEND" == cloudrun ]]; then
  CURRENT="$( (gc run services describe "$SERVICE" --region="$REGION" --format=json 2>/dev/null || echo '{}') | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const env = JSON.parse(s).spec?.template?.spec?.containers?.[0]?.env ?? [];
      process.stdout.write(env.find((e) => e.name === "CLIENT_ORIGIN")?.value ?? "");
    });')"
  case "$CURRENT" in
    '') ok "any origin is allowed (CLIENT_ORIGIN empty): nothing to change" ;;
    *"$SITE_ID.web.app"*) ok "already allowed" ;;
    *)
      guard_live_party "$SERVER_URL" "Adding web.app to CLIENT_ORIGIN makes a new revision and drops them."
      gc run services update "$SERVICE" --region="$REGION" --update-env-vars="^@^CLIENT_ORIGIN=$CURRENT,$ORIGINS" --quiet
      ok "added web.app to CLIENT_ORIGIN (new revision)"
      ;;
  esac
else
  warn "Custom server URL: if it sets CLIENT_ORIGIN, add $ORIGINS to it."
fi

# ── 4. deploy ──
step "Deploying dist/client to Firebase Hosting"
fb deploy --only hosting --project "$FIREBASE_PROJECT"
ok "deployed"

# Put the same-origin build back, so a later local `npm start` does not point at the server.
step "Restoring the same-origin client build"
run env -u VITE_SERVER_URL npm run build:client >/dev/null
ok "dist/client rebuilt without VITE_SERVER_URL"

print_party_urls "$SITE_URL" "$SERVER_URL"
info "The game server (websocket) stays at $SERVER_URL"
