#!/usr/bin/env bash
# Check a deployed party from the outside (works from any machine with curl + Node 22).
#
#   deploy/smoke.sh https://34-77-1-2.sslip.io
#   deploy/smoke.sh https://party-arena-abc123.europe-west1.run.app
#   deploy/smoke.sh https://my-project.web.app https://34-77-1-2.sslip.io   (pages, server)
#
# Checks: /healthz, the phone page / and its script bundle, /host, /show, and a
# real socket.io websocket (wss) round trip: handshake, a clock ping with ack,
# and a join to a room that cannot exist (no side effects on the server).
# Read-only, so there is no --dry-run: it changes nothing anywhere.
set -euo pipefail
case "${1:-}" in
  -h | --help | '')
    awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
    [[ -n "${1:-}" ]] && exit 0
    exit 2
    ;;
esac

if [[ -t 1 ]]; then G=$'\e[32m' R=$'\e[31m' Y=$'\e[33m' B=$'\e[1m' N=$'\e[0m'; else G='' R='' Y='' B='' N=''; fi
PAGES="${1%/}"
SERVER="${2:-$1}"
SERVER="${SERVER%/}"
fails=0
pass() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
fail() { printf '  %s✗ %s%s\n' "$R" "$*" "$N"; fails=$((fails + 1)); }
note() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }

command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
printf '%sSmoke test%s  pages %s  ·  server %s\n' "$B" "$N" "$PAGES" "$SERVER"

urls=("$PAGES")
[[ "$SERVER" == "$PAGES" ]] || urls+=("$SERVER")
for u in "${urls[@]}"; do
  case "$u" in
    https://*) ;;
    http://localhost* | http://127.0.0.1*) note "$u is plain http: fine for a local test, phones need https" ;;
    http://*) note "$u is plain http: the game works, but phones get no screen wake lock (use the https address when it works)" ;;
    *) fail "$u is not a URL (start it with https://)" ;;
  esac
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# get <url> <outfile> -> prints the HTTP status ("000" = no connection / TLS failure)
get() { curl -sS -L --max-time 15 -o "$2" -w '%{http_code}' "$1" 2>"$TMP/err" || true; }

# 1. health
code="$(get "$SERVER/healthz" "$TMP/health")"
if [[ "$code" == 200 ]] && grep -q '"ok":true' "$TMP/health"; then
  pass "/healthz  $(cat "$TMP/health")"
else
  fail "/healthz answered $code $(head -c 200 "$TMP/health" 2>/dev/null) $(head -c 300 "$TMP/err")"
fi

# 2. pages
check_page() {
  local path="$1" required="$2" code
  code="$(get "$PAGES$path" "$TMP/page")"
  if [[ "$code" == 200 ]] && grep -qi '<html' "$TMP/page"; then
    pass "$path  ($(wc -c <"$TMP/page") bytes)"
    return 0
  fi
  if [[ "$required" == 1 ]]; then fail "$path answered $code $(head -c 300 "$TMP/err")"; else note "$path answered $code"; fi
  return 1
}
if check_page / 1; then
  script="$(grep -o 'src="[^"]*\.js"' "$TMP/page" | head -n1 | sed 's/^src="//; s/"$//')"
  if [[ -n "$script" ]]; then
    [[ "$script" == http* ]] || script="$PAGES/${script#/}"
    code="$(get "$script" "$TMP/js")"
    if [[ "$code" == 200 ]]; then pass "phone bundle ${script##*/}  ($(wc -c <"$TMP/js") bytes)"; else fail "phone bundle $script answered $code"; fi
  else
    fail "/ has no <script src=...js>"
  fi
fi
check_page /host 1 || true
check_page /show 0 || true

# 3. websocket (raw socket.io protocol over Node's built-in WebSocket; falls back to socket.io-client)
if ! command -v node >/dev/null; then
  fail "node not found: cannot test the websocket (install Node 22)"
else
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if out="$(cd "$ROOT" && node -e '
    const base = process.argv[1];
    const done = (ok, msg) => { console.log(msg); process.exit(ok ? 0 : 1); };
    setTimeout(() => done(false, "no complete socket.io round trip within 15s"), 15000).unref();
    const u = new URL(base);
    const wsUrl = (u.protocol === "https:" ? "wss://" : "ws://") + u.host + u.pathname.replace(/\/$/, "") + "/socket.io/?EIO=4&transport=websocket";
    if (typeof WebSocket === "undefined") {
      let io;
      try { ({ io } = require("socket.io-client")); } catch { done(false, "this Node has no WebSocket and socket.io-client is not installed (use Node 22)"); }
      const s = io(base, { transports: ["websocket"], reconnection: false, timeout: 10000 });
      s.on("connect_error", (e) => done(false, "connect_error: " + e.message));
      s.on("connect", () => { const t = Date.now(); s.emit("time:ping", t, (r) => done(typeof r.serverNow === "number", "socket.io-client websocket ok, ping " + (Date.now() - t) + " ms")); });
    } else rawSocket();
    function rawSocket() {
    const ws = new WebSocket(wsUrl);
    let sent = 0, rtt = 0;
    ws.onerror = (e) => done(false, "websocket error at " + wsUrl + ": " + (e.message || e.error?.message || "connection failed"));
    ws.onclose = (e) => done(false, "websocket closed early (code " + e.code + ") at " + wsUrl);
    ws.onmessage = (e) => {
      const m = String(e.data);
      if (m === "2") return ws.send("3");
      if (m.startsWith("0{")) return ws.send("40");
      if (m.startsWith("40")) { sent = Date.now(); return ws.send("420" + JSON.stringify(["time:ping", sent])); }
      if (m.startsWith("44")) return done(false, "namespace refused: " + m);
      if (m.startsWith("430")) {
        rtt = Date.now() - sent;
        const [r] = JSON.parse(m.slice(3));
        if (typeof r?.serverNow !== "number") return done(false, "bad time:ping answer " + m);
        return ws.send("421" + JSON.stringify(["player:join", { code: "--", name: "smoke" }]));
      }
      if (m.startsWith("431")) {
        const [r] = JSON.parse(m.slice(3));
        ws.onclose = null; ws.close();
        if (r && r.ok === false) return done(true, "websocket " + wsUrl.split("/socket.io")[0] + " ok: handshake, ping " + rtt + " ms, game handlers answer (" + r.error + ")");
        return done(false, "unexpected join answer " + m);
      }
    };
    }
  ' "$SERVER" 2>&1)"; then
    pass "$out"
  else
    fail "$out"
  fi
fi

echo
if ((fails == 0)); then
  printf '%s%sAll good.%s Phones: %s/   TV: %s/host\n' "$G" "$B" "$N" "$PAGES" "$PAGES"
else
  printf '%s%s%d check(s) failed.%s See README.md > Troubleshooting.\n' "$R" "$B" "$fails" "$N"
  exit 1
fi
