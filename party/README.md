# Party Arena

A Kahoot-style competition for a house party (10-40 guests). The TV shows the
**host page**: a QR code, the host controls and a live scoreboard show. Guests
scan the QR with their own phone, type a name and land in the lobby. The host
starts a mini game, every phone plays the same game at the same moment for about
a minute while the TV shows a live race, then the TV runs the **round-winner
ceremony** (the prize, a custom Shimi angel figurine, plus the victory song) and
the standings. After the last game: the final podium.

Five mini games: **tap** (mash the face), **icy** (ice-tower climber), **flappy**
(tap to fly), **plotzel** (Hebrew word game), **ninja** (slice everything except
the bomb). Short **cutscene videos** can interrupt at any moment: phones freeze
with "watch the TV" and the game continues exactly where it stopped.

All guest-facing text is Hebrew (RTL). Every picture, song and video is a named
file slot with a placeholder, so the real files drop in with no code change.

---

## Quick start (local, same Wi-Fi)

```bash
npm install
npm run dev            # game server :8787 + vite :5173 (listens on the LAN)
```

1. On the laptop open the TV page **by the laptop's LAN address**, not localhost:
   `http://192.168.x.x:5173/host.html` (vite prints the "Network" address).
   The QR is built from the address the TV page was opened from.
2. Scan the QR with a phone on the same Wi-Fi, type a name, play.

Other commands: `npm test` (unit tests), `npm run typecheck`, `npm run build`,
`npm start` (serves the built app on :8787, or `PORT`).
Fast rounds for testing: `PARTY_TEST_FAST=1 npm run dev` (12 s games).

End-to-end regression (Playwright + Chromium installed globally): a real TV page
and four emulated phones play all five games, the cutscenes, every round-winner
ceremony and the podium. How to start the stack is at the top of each script.
`npm run test:e2e` runs `tests/e2e/full-flow.cjs`; `npm run test:room` runs
`tests/e2e/full-room.cjs` (the TV with 30 bots). Screenshots land in
`tests/e2e/out/`.

Local Wi-Fi is fine for a rehearsal. For the party use a public HTTPS address
(below): phones need a secure page for screen wake lock, fullscreen and `wss`,
and then any guest on mobile data can join too.

## Project layout

| Path | What |
| --- | --- |
| `shared/` | The contract: `protocol.ts` (phases, room state, socket events, game list, timings), `round-clock.ts`, `cutscenes.ts`, `scoring.ts` |
| `server/` | Node game server: express + socket.io, rooms in memory, serves the built client |
| `client/index.html` → `client/src/player/` | The phone |
| `client/host.html` → `client/src/host/` | The TV host page (`/host`) |
| `client/show.html` → `client/src/host/show/` | TV show demo / control room (`/show`) |
| `client/dev.html` → `client/src/dev/` | Game harness (`/dev`) |
| `client/src/games/<game>/` | The five games (Canvas 2D), loaded lazily by `registry.ts` |
| `client/src/kit/` | Game kit: loop, canvas, input, sprites, sound, music, fx ([README](client/src/kit/README.md)) |
| `client/public/` | Drop-in files: `assets/<game>/`, `assets/host/`, `audio/`, `cutscenes/` |
| `tests/` | `unit/` (vitest), `load/bots.ts` (socket bots), `e2e/` (Playwright scripts) |
| `deploy/` | Google Cloud scripts (below) |
| `Dockerfile`, `firebase.json` | Cloud Run image, Firebase Hosting config |

## How a round works

The server owns the room; every change is broadcast to everyone as one
`RoomState` snapshot. Phases (`shared/protocol.ts`):

`lobby` → `intro` (title + instructions, 7 s) → `countdown` (3-2-1, 3 s) →
`playing` (`round.startAt` .. `round.endAt`) → `results` → back to `lobby` for
the next game, or `final` (podium).

- Game lengths: tap 60 s, icy 75 s, flappy 60 s, plotzel 120 s, ninja 60 s.
- Every phone gets the same `seed`, so the same level.
- Phones send their live score every 250 ms and a final score at the end; the
  server waits 1.5 s after `endAt` for finals, then scores the round. Reported
  scores are clamped to each game's `maxRaw` (friends-only anti-cheat).
- Clients never time a round with their own clock or the game's nominal length:
  they read it from the round fields with `roundTime(round, serverNow)`
  (`shared/round-clock.ts`), with a clock synced to the server by ping.
- Joining is allowed at any time; a guest who joins mid-round plays from the next
  round. A phone that reloads or reconnects resumes as the same player.

**Freeze / cutscenes.** A cutscene is a video on the TV. While it plays,
`state.cutscene` is set and the round clock stands still at `round.frozenAt`.
When the video ends the server shifts `startAt` / `endAt` forward by the frozen
time and, during `playing`, sets `resumeAt` 3 s ahead: phones show a 3-2-1 and
the game continues at exactly the elapsed time where it stopped. A video the TV
never reports as finished is ended by the server after 90 s. A cutscene during
`results` before the winner reveal pushes the reveal back by its length.

Cutscene triggers (`shared/cutscenes.ts`): `manual` (host button only),
`before` a game (before its instructions), `during` a game at `atMs` of round
time (scaled when rounds are shortened for tests), `after` a game (before the
results), `final` (before the podium). Automatic triggers fire once per
competition (unless `repeat: true`) and only while the host's "אוטומטי" switch is
on. Defaults: `opening` (manual), `tap_freeze` (30 s into tap), `before_ninja`,
`before_podium`, `joker_1`, `joker_2` (manual).

**Scoring** (`shared/scoring.ts`). Per round each player's raw game score is
scaled against the round's best: `points = round(1000 × raw / best)`, plus a
podium bonus of 100 / 60 / 30 for round ranks 1 / 2 / 3. Ties share a rank and
a bonus; a raw score of 0 earns 0. Points add up to the overall total.
The **round winner** is every player with round rank 1 and a score above 0
(several on a tie, none if nobody scored): that is who gets the figurine. The
TV builds suspense for 8 s, reveals the winner with the prize and the victory
song, then shows the standings. Phones hide their own result until the reveal.

**Host keys** on the TV page: `Space`/`Enter` main action (next game, continue),
`N` next game, `E` end the round now, `C` cutscene menu, `S` skip the video,
`R` replay, `M` mute, `F` fullscreen.

## Adding the real graphics, songs and videos

Every slot is a file name. Drop the file in, then:
**dev:** reload the page. **Production:** re-run the build/deploy
(`deploy/gce-deploy.sh` or `deploy/cloudrun-deploy.sh`), because the list of
present files is taken at build time. Any of `.png .webp .jpg .jpeg .svg` works
for a picture slot with the same base name. Each folder's README has sizes and
framing rules.

| Folder | Slots (at the time of writing) |
| --- | --- |
| `client/public/assets/tap/` ([README](client/public/assets/tap/README.md)) | `face_normal`, `face_happy`, `face_surprised`, `face_angry`, `face_tongue`, `face_wink`, `face_nosepick` (.png), `background.jpg` |
| `client/public/assets/icy/` ([README](client/public/assets/icy/README.md)) | `face`, `face_jump`, `face_fall`, `platform`, `milestone`, `wall`, `bg` (.png) |
| `client/public/assets/flappy/` ([README](client/public/assets/flappy/README.md)) | `face`, `face_flap`, `face_dead`, `wing`, `halo`, `obstacle`, `obstacle_pole`, `ground`, `skyline` (.png), `background.jpg` |
| `client/public/assets/ninja/` ([README](client/public/assets/ninja/README.md)) | `target_1` .. `target_5`, `target_gold`, `bomb` (.png), `background.jpg` |
| `client/public/assets/plotzel/` ([README](client/public/assets/plotzel/README.md)) | `cloud`, `mascot`, `mascot-happy`, `mascot-oops` (.png) |
| `client/public/assets/host/` ([README](client/public/assets/host/README.md)) | **`prize.jpg` / `prize.png` = the figurine in the round-winner ceremony** (a transparent `prize.png` wins and looks best), `mascot_normal`, `mascot_happy`, `mascot_shocked`, `mascot_laugh`, `mascot_angry`, `sticker_1` .. `sticker_8`, `crown`, `last_place`, `podium_1` .. `podium_3` (.png), `bg_show.jpg` |
| `client/public/audio/` ([README](client/public/audio/README.md)) | **`victory.mp3` = the round winner's song** (a synth tune plays until it exists), `final.mp3` (champion), `lobby.mp3`, `round.mp3` (quiet loops). `.m4a` / `.ogg` also work |
| `client/public/cutscenes/` ([README](client/public/cutscenes/README.md)) | `opening.mp4`, `tap_freeze.mp4`, `before_ninja.mp4`, `before_podium.mp4`, `joker_1.mp4`, `joker_2.mp4` |

Videos: MP4 (H.264 + AAC), 5-20 s. Convert anything with
`ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart joker_1.mp4`.
`opening` and `tap_freeze` ship as 4-second test patterns in `.mp4` **and**
`.webm`: when you add the real ones, delete the `.webm` copies or the player may
still pick the test clip. A missing video shows a 4-second placeholder card. A
new video = file here + one entry in `shared/cutscenes.ts`.

Preview without a party:
- **`/show.html`** (TV control room): race, results, the winner ceremony with the
  prize and `victory.mp3`, standings, podium, with simulated players.
- **`/dev.html`** (game harness): `/dev.html?game=tap&seed=1&duration=20000`
  plays one game on a phone-sized page (`&freezeAt=5000&freezeMs=4000` tests a
  freeze); `/dev.html?kit=1` shows every placeholder and plays every sound.

**Plotzel switch** ([client/src/games/plotzel/README.md](client/src/games/plotzel/README.md)):
by default Plotzel embeds the live site `https://plotzel.netlify.app` in an
iframe. If it misbehaves on phones, switch every phone to our built-in Hebrew
word game at build time: `VITE_PLOTZEL_MODE=builtin` (put it in `.env`, then
redeploy; all three deploy paths pass it on). One phone can switch on the spot
with `?plotzel=builtin`, and the embed offers a "play here instead" fallback.

## Tuning knobs

- `shared/protocol.ts` → `GAMES`: Hebrew titles, instructions and each game's
  `durationMs`; `INTRO_MS`, `COUNTDOWN_MS`, `WINNER_REVEAL_MS`,
  `RESUME_COUNTDOWN_MS`, `MAX_PLAYERS` (60), `NAME_MAX_LEN`.
- `shared/cutscenes.ts` → `CUTSCENES`: which video, when (`when`), the phone
  line (`phoneText`), `repeat`, `enabled`.
- `shared/scoring.ts` → `MAX_ROUND_POINTS`, `PODIUM_BONUS`.
- `.env` (copy `.env.example`): deploy settings and build switches
  (`VITE_PLOTZEL_MODE`, `VITE_PUBLIC_URL` to force the address in the QR).

---

## Deploy to Google Cloud

Three paths, all in Europe (`europe-west1` by default). Every script is safe to
re-run, prints the phone URL, the TV URL (`<url>/host`) and a QR in the
terminal. Rooms live in the memory of **one** server process: there is never
more than one instance.

| | Address | Recommended |
| --- | --- | --- |
| **A. VM** (`deploy/gce-up.sh`) | `https://34-77-1-2.sslip.io` (your static IP with dashes; or your own domain) | **Yes, for party night** |
| **B. Cloud Run** (`deploy/cloudrun-deploy.sh`) | `https://party-arena-xxxxx.europe-west1.run.app` | Backup / all-Google address |
| **C. Firebase Hosting** (`deploy/firebase-deploy.sh`) | `https://<project>.web.app` for the pages, on top of A or B | Optional, nicer address |

**Why the VM for party night.** It is one ordinary Node process under systemd
(restarted if it ever crashes) behind Caddy. Nothing replaces it during the
evening and websockets have no time limit. On Cloud Run the platform may
replace the instance at any time (maintenance, host moves), which **drops every
room**, and every websocket is cut at the 60-minute request limit (phones
reconnect within about 2 s and keep their place, but a cut that lands in a
round is a visible hiccup). Cloud Run is fine as a backup that is quick to
create.

### One-time setup (5 minutes)

1. Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install
2. Log in and pick (or create) the project. Billing must be enabled on it.
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```
3. From this folder:
   ```bash
   npm install
   deploy/doctor.sh
   ```
   `doctor.sh` changes nothing. It checks the login, project, billing, APIs,
   quota and local tools, and prints the exact command for anything missing.
   Optional: `cp .env.example .env` to change region, names or `DOMAIN`.

### A. Compute Engine VM (recommended)

```bash
deploy/gce-up.sh
```

That one command enables the Compute API, creates the `default` network if
missing, reserves the static IP `party-arena-ip`, opens 80/443 (and 22 for
deploys) to VMs tagged `party-arena-web`, creates an `e2-small` Debian 12 VM
`party-arena` whose startup script (`deploy/gce-startup.sh`, runs on every boot)
installs Node 22 and Caddy, a `party` system user and the `party-arena` systemd
service (`Restart=always`, `NODE_ENV=production`), and writes a Caddyfile that
gets an HTTPS certificate for `<ip-with-dashes>.sslip.io` and proxies to Node.
It then runs `deploy/gce-deploy.sh`: builds locally (`npm ci`, `npm run build`),
copies `dist` + package files with `gcloud compute scp`, runs
`npm ci --omit=dev` on the VM, restarts the service and waits until
`https://<host>/healthz` answers (the first certificate takes 1-5 minutes).
The first `gcloud compute ssh` creates an SSH key for you (no passphrase).

After a code or art change: `deploy/gce-deploy.sh` (asks before restarting a
server with players in it; `FORCE=1` skips the question).

Your own domain instead of sslip.io: create an A record pointing at the static
IP (`deploy/doctor.sh` prints it once `gce-up.sh` reserved it), then `DOMAIN=party.example.com deploy/gce-up.sh`
(or put `DOMAIN=` in `.env`).

Logs and access:
```bash
deploy/gce-logs.sh            # game server + Caddy, live
deploy/gce-logs.sh startup    # the boot script (Node / Caddy install)
deploy/gce-ssh.sh             # a shell on the VM
```

### B. Cloud Run

```bash
deploy/cloudrun-deploy.sh
```

Enables Run, Cloud Build and Artifact Registry, lets the build service account
build (`roles/run.builder`), then `gcloud run deploy --source .` builds the
`Dockerfile` (Node 22, non-root, client + server in one image) in Cloud Build
and deploys service `party-arena` with: min 1 / max 1 instance, CPU always
allocated (`--no-cpu-throttling`), 1 vCPU / 1 GiB, request timeout 3600 s,
session affinity, concurrency 1000, public access. The first build takes 3-5
minutes. Logs: `gcloud run services logs read party-arena --region=europe-west1`.

### C. Firebase Hosting (optional)

```bash
npx --yes firebase-tools login     # once
deploy/firebase-deploy.sh
```

Firebase Hosting only serves static files and **cannot proxy websockets**, so
the game server keeps its own HTTPS address from A or B. The script finds that
server (`FIREBASE_BACKEND=auto`: the VM first, then Cloud Run; or `gce`,
`cloudrun`, an `https://` URL), builds the client with
`VITE_SERVER_URL=<server>`, adds Firebase to the project if needed, allows the
`web.app` origin on the server (`CLIENT_ORIGIN`, which restarts it only if the
value changed), and deploys `dist/client` (`firebase.json`: `/host` and `/show`
rewrites, immutable cache for hashed `/assets/*.js|css`, no-cache for pages and
drop-in files). Open the TV at `https://<project>.web.app/host`; its QR then
points at `web.app`.

### Check from outside

```bash
deploy/smoke.sh https://34-77-1-2.sslip.io
deploy/smoke.sh https://<project>.web.app https://34-77-1-2.sslip.io   # path C: pages, server
```
Checks `/healthz`, the phone page and its script, `/host`, `/show`, and opens a
real socket.io websocket (`wss`) with a clock ping and a harmless join. Run it
from a phone's hotspot too: that is what guests on mobile data see.

Rehearsal with fake players (they join a real room, so not during the party):
`npx tsx tests/load/bots.ts --url https://<host> --code ABCD --players 20 --play`.

### Costs

Roughly, at list prices: VM ≈ $0.60/day (e2-small + static IP), Cloud Run ≈
$1.70/day (an always-on instance), Firebase Hosting free tier; tear down after
the party.

### Teardown

```bash
deploy/gce-down.sh        # VM, its disk, the static IP, the two firewall rules (asks first)
deploy/cloudrun-down.sh   # the Cloud Run service (asks first)
npx --yes firebase-tools hosting:disable --project YOUR_PROJECT_ID   # path C
```

---

## Party-night checklist

- [ ] **The day before:** drop in the real files, `deploy/gce-up.sh` (or
      `deploy/gce-deploy.sh`), then `deploy/smoke.sh <url>`: all green.
- [ ] Play one full round with **one iPhone and one Android**, one of them on
      mobile data. Check the round-winner ceremony shows the prize and plays
      `victory.mp3`.
- [ ] Laptop: on power, sleep off (macOS: `caffeinate -dis` in a terminal;
      Windows: Power settings → Never), notifications off.
- [ ] TV page `https://<host>/host` in Chrome, **fullscreen** (`F`), click once
      on the page so sound is allowed, sound through the TV (HDMI / AirPlay
      output set to the TV), volume up.
- [ ] iPhone guests: Share → **Add to Home Screen** opens the game without the
      Safari bars. Android goes fullscreen by itself when the guest joins.
- [ ] Ask guests to keep the screen on between rounds (iPhone: Low Power Mode
      off).
- [ ] Do not deploy during the party: a deploy restarts the server and empties
      the rooms.

## Troubleshooting

- **The QR shows `localhost`.** The QR uses the address the TV page was opened
  from. Locally open `http://<LAN-IP>:5173/host.html` (or add
  `?join=http://192.168.x.x:5173` to the TV URL); in production open
  `https://<host>/host`. `VITE_PUBLIC_URL` at build time forces it.
- **"Certificate not ready" / HTTPS fails right after `gce-up.sh`.** Caddy gets
  the certificate on first boot; it needs ports 80 and 443 open (the script's
  firewall rule) and can take a few minutes. Watch `deploy/gce-logs.sh caddy`.
  If Let's Encrypt is rate-limited for `sslip.io`, Caddy retries and falls back
  to ZeroSSL by itself; a custom `DOMAIN` avoids shared limits. Still stuck:
  `deploy/gce-logs.sh startup` shows whether Node and Caddy were installed.
- **`wss` blocked** (smoke.sh fails only on the websocket line, or phones sit on
  "connecting"). Some guest / corporate Wi-Fi blocks websockets or `sslip.io`:
  the phone joins fine on mobile data. A custom `DOMAIN` helps with filters that
  block sslip.io.
- **A phone slept or the browser was closed.** Open the same page again: it
  rejoins as the same player (same name, same points) and plays from the next
  round. Keep phones awake (above).
- **`gcloud ... PERMISSION_DENIED` on the Cloud Run build.** A project Owner
  runs the `add-iam-policy-binding` command `cloudrun-deploy.sh` prints.
- **Anything else:** `deploy/doctor.sh`, then the logs (`deploy/gce-logs.sh`,
  or `gcloud run services logs read party-arena --region=europe-west1`).
