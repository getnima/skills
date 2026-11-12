# Party Arena

A Kahoot-style competition for a house party (10-40 guests). The TV shows the
**host page**: a QR code, a live scoreboard and the show. Guests scan the QR with
their own phone, type a name, **dress their own Shimi doll** (it is their icon
everywhere) and wait in the lobby. The owner runs the show from **his own phone**
(`/remote`, password protected); the TV only shows and plays the music. Every phone
plays the same game at the same moment while the TV shows a live race, then the TV
runs the **round-winner ceremony** (the prize, a custom Shimi angel figurine, plus
the victory song) and the standings. After the last game: the final podium.

Five mini games:
- **שימי טאפ** (tap): 30 s to start, then your own 20 s of tapping on Shimi picking his nose. Score = taps.
- **אייסי שימי** (icy): a tower climber; hold a side to run, he jumps when he lands. Best run counts.
- **פלאפי תבורי** (flappy): last one in the air wins; when 3 are left a finale makes it harder.
- **פלוצל** (plotzel): the owner's word ladder to פלוץ, opening with חמוד, פוקי, נדיר, שימי; 80% speed, 20% steps, no hints.
- **נינג׳ה תבורי** (ninja): slice the Israeli food, never the two host bombs.

Short **cutscene videos** can interrupt at any moment: phones freeze with "watch the
TV" and the game continues exactly where it stopped.

All guest-facing text is Hebrew (RTL). Every picture, song and video is a named
file slot with a placeholder, so the real files drop in with no code change.

---

## Tomorrow morning: the 10-minute checklist

Do these in order, on the laptop, in this folder. `deploy/<script> --help` explains
any script; `--dry-run` prints its commands without running anything.

**0. Once per laptop** (skip what is done): Node 22 from https://nodejs.org, the
Google Cloud CLI (https://cloud.google.com/sdk/docs/install), then
`gcloud auth login`, `gcloud config set project YOUR_PROJECT_ID` (billing must be
on), `npm ci`, `deploy/doctor.sh` (checks everything, changes nothing, prints the
exact fix for anything missing).

**1. Drop in the pictures, songs and videos.** Exact names; lower-case is safest.
Everything is baked in when the app is built, so **a file added or changed after
a deploy needs the deploy again** (step 3).

| What | Folder | File name |
| --- | --- | --- |
| The prize (figurine) in every winner ceremony | `client/public/assets/host/` | `prize.png` (transparent cut-out, best) or `prize.jpg` |
| Round winner's song | `client/public/audio/` | `victory.mp3` |
| Champion's song (final podium) | `client/public/audio/` | `final.mp3` |
| Lobby song, quiet loop | `client/public/audio/` | `lobby.mp3` |
| One song per game | `client/public/audio/` | `tap.mp3`, `icy.mp3`, `flappy.mp3`, `plotzel.mp3`, `ninja.mp3` (`round.mp3` plays for a game without its own) |
| Videos (H.264 + AAC MP4, 5-20 s) | `client/public/cutscenes/` | `opening.mp4`, `tap_freeze.mp4`, `before_ninja.mp4`, `before_podium.mp4`, `joker_1.mp4`, `joker_2.mp4` |
| Faces and game art | `client/public/assets/<game>/` | see the table under "Adding the real graphics" below |

Songs may also be `.m4a`, `.ogg` or `.wav` (same base name). When the real
`opening.mp4` / `tap_freeze.mp4` arrive, **delete `opening.webm` and
`tap_freeze.webm`** (test clips). A video with a new name also needs one line in
`shared/cutscenes.ts`.

**2. Test locally (3 minutes).**
```bash
npm run build && npm start
```
Open `http://localhost:8787/host` in Chrome. The QR shows the laptop's Wi-Fi
address (`http://192.168.x.x:8787/...`); scan it with your phone on the same
Wi-Fi and play one round of שימי טאפ. Check the prize and `victory.mp3` in the
ceremony. macOS asks *"Do you want the application node to accept incoming
network connections?"*: **Allow**. Ctrl+C when done.

**3. Deploy (one command, about 5-8 minutes the first time).**
```bash
deploy/gce-up.sh
```
It ends with the addresses, for example `https://34-77-1-2.sslip.io` (phones)
and `https://34-77-1-2.sslip.io/host` (TV). Then `deploy/smoke.sh <that https
address>` must say *All good*. After changing files later: `deploy/gce-deploy.sh`
(only the app, about 1 minute). Do not deploy during the party: it empties the room.

**4. The TV and your phone.** On the laptop, Chrome → `https://<address>/host` → click once
anywhere (allows sound) → `F` (fullscreen). On **your own phone** open
`https://<address>/remote` and enter the remote password (the default is set in
`server/config.ts`, server side only; to use another one set `PARTY_REMOTE_PASSWORD`
on the server). From then on the phone is the remote: the TV hides its own buttons
and the keyboard keys below keep working as a backup.

**Optional, the Shimi QR code.** A designed QR with Shimi's face (made with QRocodile):
after step 3, run the two commands in `tools/qr/README.md` with your address, then
`deploy/gce-deploy.sh` again. The TV shows it only when it matches its own address;
otherwise it keeps its normal QR. Control Center → Screen Mirroring →
the Apple TV, and set the Mac's sound output to the Apple TV. Plug in the
charger and run `caffeinate -dis` in a terminal so the Mac never sleeps.

**5. Run of show.** Guests scan the QR (or type the address and the 4-letter room
code), type a name and dress their Shimi. The remote's big button (or `Space`) starts
the next game → instructions → 3-2-1 → 50 s to 2 min of play (TV shows the race) → 8 s of suspense → the round winner, the prize and the
victory song: hand over the figurine → `Space` for the next game. After the last
game the final podium. `C` = videos menu (jokers), `S` skips a video, `M` mutes.
Guests can join any time; they play from the next round.

**6. When something goes wrong.**
- **One phone is stuck or black:** refresh the page on that phone. Same name, same
  points; mid-round it plays again from the next round.
- **The TV is stuck:** refresh the TV page. Safe: the room lives on the server
  and the TV picks it up again.
- **Wi-Fi blip / everyone shows "connecting":** wait 2-3 s, phones reconnect by
  themselves (tested by cutting every connection mid-round: same player, score kept).
- **The server restarted** (crash, or someone deployed): it is back by itself in
  2 s, but **the room and the points are gone**: everyone scans the new QR. Take a
  photo of the standings after every round so you can carry the totals by hand.
- **The `https://...sslip.io` address does not open** (certificate not ready, or a
  Wi-Fi filter): the same server also answers on `https://<ip-with-dashes>.nip.io`
  and on plain `http://<ip>`. Open `/host` on the one that works; the QR follows it.
- **The cloud is down / no time to debug:** plan Z below, on the laptop.
- Diagnose: `deploy/smoke.sh <address>`, `deploy/gce-logs.sh status`, `deploy/gce-logs.sh`.

### Plan Z: no cloud at all (laptop on the home Wi-Fi)

```bash
npm ci && npm run build && npm start
```
Open `http://localhost:8787/host` on the laptop. The QR points at the laptop's
Wi-Fi address (`http://192.168.x.x:8787`), from `GET /api/info`. Guests must be
on the **same** Wi-Fi (a "guest network" usually isolates phones from the laptop:
use the main one). macOS firewall: answer **Allow** to the "accept incoming
network connections" prompt; if it was denied, System Settings → Network →
Firewall → Options → `node` → Allow incoming connections. If the QR shows a
wrong address (a VPN), open the TV as `http://localhost:8787/host?join=http://192.168.x.x:8787`.
Plain `http` works for the whole game (tested); what phones lose is the screen
wake lock (screens may dim between rounds) and nothing else the game needs.

---

## Quick start (local development, same Wi-Fi)

```bash
npm install
npm run dev            # game server :8787 + vite :5173 (listens on the LAN)
```

1. On the laptop open the TV page **by the laptop's LAN address**, not localhost:
   `http://192.168.x.x:5173/host.html` (vite prints the "Network" address).
   The QR is built from the address the TV page was opened from.
2. Scan the QR with a phone on the same Wi-Fi, type a name, play.

Other commands: `npm test` (unit tests), `npm run typecheck`, `npm run build`,
`npm start` (serves the built app on :8787, or `PORT`; open `http://localhost:8787/host`,
its QR uses the laptop's LAN address).
Fast rounds for testing: `PARTY_TEST_FAST=1 npm run dev` (12 s games).

End-to-end regression (Playwright + Chromium installed globally): a real TV page
and four emulated phones play all five games, the cutscenes, every round-winner
ceremony and the podium. How to start the stack is at the top of each script.
`npm run test:e2e` runs `tests/e2e/full-flow.cjs`; `npm run test:room` runs
`tests/e2e/full-room.cjs` (the TV with 30 bots). Screenshots land in
`tests/e2e/out/`.

Local Wi-Fi is fine for a rehearsal (and as plan Z). For the party prefer the
public HTTPS address (below): any guest on mobile data can join too, and phones
keep their screen awake (the wake lock needs https; everything else works on http).

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

- Game lengths: tap 53 s (a 30 s start window, then each guest's own 20 s; the round ends
  early when everybody is done), icy 75 s, flappy until one is left (90 s at most),
  plotzel 120 s, ninja 60 s.
- Every phone gets the same `seed`, so the same level.
- Phones send their live score every 250 ms and a final score at the end; the
  server waits 1.5 s after `endAt` for finals, then scores the round. Reported
  scores are clamped to each game's `maxRaw` (friends-only anti-cheat).
- Clients never time a round with their own clock or the game's nominal length:
  they read it from the round fields with `roundTime(round, serverNow)`
  (`shared/round-clock.ts`), with a clock synced to the server by ping.
- Joining is allowed at any time; a guest who joins mid-round plays from the next
  round. A phone that reloads or reconnects resumes as the same player.
- **Closing the browser and opening it again** lands in the same seat: the phone keeps
  its seat (room, player id, secret, name) in localStorage and mirrors it in a small
  first-party cookie (`pa_…`, 2 days), so it comes back even where localStorage is blocked.
  Opening the bare address (a home-screen icon, history) resumes the last room this phone
  still has a seat in. The server keeps a closed phone's seat and points for the room's
  life (6 idle hours). Tested in a real Chromium profile on disk:
  `node tests/e2e/reopen-browser.cjs` (with the link, from the bare address, mid-round,
  storage blocked).

**40 guests (and more).** Measured on 2026-11-12 with the production server bundle and
real party timing: 40 phones played all five games (`tests/load/bots.ts --players 40
--rounds 5 --churn 0.02 --storm`: every phone also drops at random ~2% of seconds, and in
every round all 40 drop at once mid-round and come back 0.5-3 s later), with every row,
point, rank and total equal to `shared/scoring.ts` and nobody ever becoming a second
player: 503 random drops plus five storms (38-40 phones at once), and all 40 ended in their
own seats. The server used 1.6% of one core on average (9% in its busiest second), at most
91 MB of memory, and answered a ping in 0.5 ms (p99 2.2 ms, slowest 24 ms, none lost); a room
update reached the phones in 2 ms (p99 7 ms). One phone received 24 KB/s on average in that
churn-heavy run (the biggest room update is 13 KB with 40 guests). The room's cap, 60
phones, also passes the same run (461 drops and five storms, all 60 back in their seats,
every total right, room updates in 3.5 ms, p99 25 ms). So the e2-small VM (2 shared vCPUs,
2 GB) has room to spare. Phones send a live score
every 250 ms; the server merges them into one `scores` message per 250 ms for the whole
room, and dolls into one `looks` message per 200 ms, so traffic grows gently with the
head count. The TV shows 40: the lobby grid holds every name, the race shows the top 5 and
rotates the rest. Re-run: start a server, then
`npx tsx tests/load/bots.ts --url <server> --players 40 --rounds 5 --churn 0.02 --storm`
next to `npx tsx tests/load/watch-server.ts --pid <server pid> --url <server>`
(CPU, memory, ping); `BASE_URL=… SERVER_URL=… node tests/e2e/tv-40.cjs` checks the TV.

**The way in: name, dressing room, waiting room.** A guest opens the link, types a
name (`client/src/player/welcome.tsx`, `JoinScreen`), and lands in the dressing room
(`DressingScreen`, the room of `client/src/avatar/`, its own lazy chunk) where they dress
their own Shimi doll; "מוכן!" leads to the waiting room (`LobbyScreen`) with the dressed
doll, who else is here, and a button back to the dressing room. The doll is the guest's
icon everywhere: TV lobby, live scoreboard, results, podium, the phone's lists and its
bottom bar, the remote.

- A look is a short string on `PlayerPublic.look` / `ResultRow.look` (`shared/avatar.ts`).
  The phone sends it with `player:join` (a new player only) and with `player:look`; the
  server stores `encodeLook(decodeLook(text, ITEM_IDS))` (`server/looks.ts`), never the
  text itself. A guest who has not dressed gets a random doll nobody else in the room
  wears. A reload / reconnect keeps the server's look.
- A change is announced with the small `looks` event (`[playerId, look]` pairs, at most
  one message per 200 ms per room), not with a `RoomState`; clients patch their snapshot
  with `applyLooks` (`shared/room-looks.ts`). The phone sends at most one `player:look`
  per 250 ms (`client/src/player/look-sender.ts`).
- The server accepts a look in every phase. The phone offers the dressing room only in
  the `lobby` phase (before the first round and between rounds). A round that starts
  while a guest is dressing takes over at once and the latest look is sent; that guest
  counts as dressed. A guest who joins mid-round is not interrupted: the dressing room
  opens for them at the next lobby. The rules are in `client/src/player/dressing-state.ts`.
- **Test switch** (the only one): `?dress=0` in the phone's URL skips the dressing-room
  step, `?dress=1` forces it; without the parameter it is skipped only in an automated
  browser (`navigator.webdriver`), so end-to-end scripts that expect the waiting screen
  right after the join keep working. Scripts that test the real flow use
  `tests/e2e/dress-lib.cjs` (`withDressing(url)`, `passDressing(page)`); the flow itself
  is `tests/e2e/dress-flow.cjs`.

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
on. Defaults: `opening` (manual), `tap_freeze` (8 s into tap), `before_ninja`,
`before_podium`, `joker_1`, `joker_2` (manual).

**Scoring** (`shared/scoring.ts`). **There are no ties, anywhere.** Per round each
player's raw game score is scaled against the round's best: `points = round(1000 × raw /
best)`, plus a podium bonus of 100 / 60 / 30 for the first three places. On the same raw
score, whoever reached it first is ahead (server time), then whoever joined first; every
scorer gets at least one point less than the one above, and a new total that would equal
somebody else's is nudged down by a point. A raw score of 0 earns 0. The overall rank
is strict too: total, then round wins, best round, latest round, join order.
The **round winner** is the one player in first place with a score above 0 (nobody if
nobody scored): that is who gets the figurine. The
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
for a picture slot with the same base name (the game art ships as `.webp`, made with
`tools/assets/to_webp.py`; a file with the exact slot name wins). Each folder's README
has sizes and framing rules.

| Folder | Slots (at the time of writing) |
| --- | --- |
| `client/public/assets/tap/` ([README](client/public/assets/tap/README.md)) | 19 faces and nose-picking frames (`face_*`, `pick_*`), `hand`, `fist`, `fingertip_ear`, `squeegee`, `splat`, six boogers `booger_*`, `background.jpg` |
| `client/public/assets/icy/` ([README](client/public/assets/icy/README.md)) | the climber, the tower and the ledges per zone: see its README |
| `client/public/assets/flappy/` ([README](client/public/assets/flappy/README.md)) | `face`, `face_flap`, `face_dead`, `wing`, `halo`, `obstacle`, `obstacle_pole`, `ground`, `skyline` (.png), `background.jpg` |
| `client/public/assets/ninja/` ([README](client/public/assets/ninja/README.md)) | `food/` 11 foods + `garden_chair`, `flip_flop`, `gold_falafel`; `bombs/bomb_host_a`, `bomb_host_b`; `background.jpg` |
| `client/public/assets/plotzel/` ([README](client/public/assets/plotzel/README.md)) | `puff`, `mascot` |
| `client/public/assets/intro/` ([README](client/public/assets/intro/README.md)) | one picture per game for its intro and lobby card (`tap`, `icy`, `flappy`, `plotzel`, `ninja`) and `show` (the host) |
| `client/public/assets/host/` ([README](client/public/assets/host/README.md)) | **`prize.jpg` / `prize.png` = the figurine in the round-winner ceremony** (a transparent `prize.png` wins and looks best), `mascot_normal`, `mascot_happy`, `mascot_shocked`, `mascot_laugh`, `mascot_angry`, `sticker_1` .. `sticker_8`, `crown`, `last_place`, `podium_1` .. `podium_3` (.png), `bg_show.jpg` |
| `client/public/audio/` ([README](client/public/audio/README.md)) | **`victory.mp3` = the round winner's song** (a synth tune plays until it exists), `final.mp3` (champion), `lobby.mp3`, one song per game `tap.mp3` `icy.mp3` `flappy.mp3` `plotzel.mp3` `ninja.mp3`, `round.mp3` (fallback for a game without its own; levels and start offsets in `client/src/host/music-config.ts`). `.m4a` / `.ogg` / `.wav` also work |
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

**Plotzel:** how Plotzel is played (and how to switch it) is in
[client/src/games/plotzel/README.md](client/src/games/plotzel/README.md). Any
`VITE_*` build switch put in `.env` reaches every deploy path (the VM build, the
Cloud Run image through `deploy/.build-env`, the Firebase build).

## Tuning knobs

- `shared/protocol.ts` → `GAMES`: Hebrew titles, instructions and each game's
  `durationMs`; `INTRO_MS`, `COUNTDOWN_MS`, `WINNER_REVEAL_MS`,
  `RESUME_COUNTDOWN_MS`, `MAX_PLAYERS` (60), `NAME_MAX_LEN`.
- `shared/cutscenes.ts` → `CUTSCENES`: which video, when (`when`), the phone
  line (`phoneText`), `repeat`, `enabled`.
- `shared/scoring.ts` → `MAX_ROUND_POINTS`, `PODIUM_BONUS`.
- `.env` (copy `.env.example`): deploy settings and build switches
  (`VITE_*`, e.g. `VITE_PUBLIC_URL` to force the address in the QR).

---

## Deploy to Google Cloud

Everything is in Europe: `europe-west1` (Belgium) by default, Tier 1 price, every
product, about 60 ms from Israel. `europe-west3` (Frankfurt) is about 10 ms closer
but dearer; the game does not need it (the server keeps the time, phones sync
their clock by ping). Change with `REGION=` in `.env`.

Rooms live in the memory of **one** server process, so there is never more than
one instance, and a restart empties the room.

| | Address | Use |
| --- | --- | --- |
| **A. VM** (`deploy/gce-up.sh`) | `https://34-77-1-2.sslip.io` (your static IP with dashes) | **Party night.** One ordinary Node process under systemd behind Caddy |
| **B. Cloud Run** (`deploy/cloudrun-deploy.sh`) | `https://party-arena-xxxxx-ew.a.run.app` | Backup, quick to create |
| **C. Firebase Hosting** (`deploy/firebase-deploy.sh`) | `https://<project>.web.app` for the pages, on top of A or B | Not recommended (below) |

Every script: safe to re-run, `--help`, `--dry-run` (prints the gcloud commands
as a run on a brand-new project would send them, runs nothing), stops with the
exact fix when gcloud is not logged in, the login expired, no project is chosen
or billing is off, and refuses to restart a server that has players unless
`FORCE=1`. Written for the bash 3.2 that macOS ships.

**Why the VM for party night.** Nothing replaces it during the evening (Google
live-migrates e2 VMs during host maintenance, no reboot), websockets have no
time limit, and it restarts itself 2 s after a crash and after a reboot. On
Cloud Run the platform may replace the instance at any time, which drops the
room, and every websocket is cut at the 60-minute request limit (phones
reconnect in under a second and keep their place: tested by cutting every
connection mid-round).

### One-time setup (5 minutes)

1. Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install
2. Log in and pick (or create) the project. Billing must be enabled on it.
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   # a brand-new project instead:
   #   gcloud projects create party-arena-12345 --set-as-default
   #   gcloud billing accounts list
   #   gcloud billing projects link party-arena-12345 --billing-account=XXXXXX-XXXXXX-XXXXXX
   ```
3. From this folder: `npm ci`, then `deploy/doctor.sh`. It changes nothing; it
   checks the login, project, billing, APIs, quota and local tools, and prints
   the exact command for anything missing. Optional: `cp .env.example .env` to
   change region, names, `DOMAIN` or `ACME_EMAIL`.

### A. Compute Engine VM (recommended)

```bash
deploy/gce-up.sh
```

That one command enables the Compute API, creates the `default` network if
missing, reserves the static IP `party-arena-ip`, opens 80/443 (and 22 for
deploys) to VMs tagged `party-arena-web`, creates an `e2-small` Debian 12 VM
`party-arena` whose startup script (`deploy/gce-startup.sh`, runs on every boot)
installs Node 22 (NodeSource; if that fails, the official nodejs.org tarball,
checksum verified) and Caddy (its apt repo; if that fails, Debian's package), a
`party` system user and the `party-arena` systemd service (`Restart=always`, never
gives up), and writes a Caddyfile. It then runs `deploy/gce-deploy.sh`: builds
locally (`npm ci`, `npm run build`), copies the release with `gcloud compute scp`,
runs `npm ci --omit=dev` on the VM, restarts the service and waits until
`https://<host>/healthz` answers (the first certificate takes 1-5 minutes). The
first `gcloud compute ssh` creates an SSH key for you (no passphrase). Re-running
`gce-up.sh` on a running VM restarts nothing whose settings did not change.

**Addresses.** Caddy serves the same server on all of these at once, each name
with its own Let's Encrypt certificate, so a problem with one does not block the
others:

1. `https://<ip-with-dashes>.sslip.io`: the one the scripts print.
2. `https://<ip-with-dashes>.nip.io`: a second free name for the same IP. sslip.io
   and nip.io are shared domains, so Let's Encrypt's per-domain weekly limit is
   shared with everybody using them; a second name halves the risk.
3. `https://your.domain`: create an A record pointing at the static IP
   (`deploy/doctor.sh` prints it), then `DOMAIN=party.example.com deploy/gce-up.sh`
   (or `DOMAIN=` in `.env`).
4. `http://<ip>`: plain http, no certificate needed. The whole game works over it
   (tested); phones only lose the screen wake lock.

Set `ACME_EMAIL=you@example.com` in `.env` before `gce-up.sh`: with an e-mail
Caddy also falls back to a second certificate authority (ZeroSSL) when Let's
Encrypt refuses (seen in a local test: without an e-mail it only tries Let's Encrypt).

Logs and access:
```bash
deploy/gce-logs.sh status     # are the server and Caddy running, /healthz on the VM
deploy/gce-logs.sh            # game server + Caddy, live (Ctrl+C)
deploy/gce-logs.sh caddy      # certificates, proxy errors
deploy/gce-logs.sh startup    # the boot script (Node / Caddy install)
deploy/gce-ssh.sh             # a shell on the VM
```

### B. Cloud Run

```bash
deploy/cloudrun-deploy.sh
```

Enables Run, Cloud Build, Artifact Registry and Compute (for the default service
account), lets that account build (`roles/run.builder`, retried while a new
account appears), then `gcloud run deploy --source .` builds the `Dockerfile`
(Node 22, non-root, client + server in one image, about 88 MB compressed, ready
0.3 s after start) in Cloud Build and deploys service `party-arena` with: min 1 /
max 1 instance, CPU always allocated (`--no-cpu-throttling`: the round clock runs
on server timers), 1 vCPU / 1 GiB, request timeout 3600 s, session affinity,
concurrency 1000, a startup probe on `/healthz`, public access. If an
organization policy refuses public access (the URL answers 403) it turns off the
invoker IAM check instead. The first build takes 3-5 minutes. Build switches
(`VITE_*` in `.env`) travel in `deploy/.build-env`. Logs:
`gcloud run services logs read party-arena --region=europe-west1`.

### C. Firebase Hosting (optional; not recommended)

It buys a nicer address (`<project>.web.app`) and a CDN for the pages. It costs a
second deploy and a second origin, and Firebase Hosting cannot proxy websockets,
so the game server stays at its own address from A or B anyway. The single
address of A (or B) already serves the pages, the videos with Range requests and
the websocket. Use it only if you want the web.app name.

```bash
npx --yes firebase-tools login     # once
deploy/firebase-deploy.sh
```

The script finds the server (`FIREBASE_BACKEND=auto`: the VM first, then Cloud
Run; or `gce`, `cloudrun`, an `https://` URL), builds the client with
`VITE_SERVER_URL=<server>`, adds Firebase to the project if needed, and deploys
`dist/client` (`firebase.json`: `/host`, `/show`, `/dev` rewrites, immutable cache
for hashed `/assets/*.js|css`, no-cache for pages and drop-in files). The server
accepts any origin by default, so nothing on it changes or restarts (only a
server you locked with `CLIENT_ORIGIN` gets web.app added). Open the TV at
`https://<project>.web.app/host`; its QR then points at web.app. At the end the
script rebuilds `dist/client` for the single-origin server again.

### Check from outside

```bash
deploy/smoke.sh https://34-77-1-2.sslip.io
deploy/smoke.sh https://<project>.web.app https://34-77-1-2.sslip.io   # path C: pages, server
```
Checks `/healthz`, the phone page and its script, `/host`, `/show`, and opens a
real socket.io websocket with a clock ping and a harmless join. Run it from a
phone's hotspot too: that is what guests on mobile data see.

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

### How the deploy was tested (without a Google Cloud account)

- The Docker image was built and run as Cloud Run runs it (`PORT=8080`): the full
  end-to-end regression (`tests/e2e/full-flow.cjs`, 294 checks), `deploy/smoke.sh`,
  `tests/e2e/deploy-prod.cjs` (websocket transport, no polling) and
  `tests/e2e/qa-deploy-reconnect.cjs` (every connection cut in the lobby, mid-round
  and in the results; phones and TV come back over websocket in under 0.5 s, same
  player, score kept) all pass.
- `gce-startup.sh` and `gce-install.sh` ran in a Debian 12 container booting
  systemd: first boot, reboot, re-run (restarts nothing), `kill -9` of the server
  (back in 2 s), `systemd-analyze verify`, `caddy validate`, websockets through Caddy.
- Every script ran end to end against a recording stub `gcloud` (new project and
  re-run), and every recorded command was replayed through the real gcloud's
  argument parser: all flags exist and parse. `shellcheck` is clean.
- Not testable here: the real Google APIs, a real Let's Encrypt certificate,
  NodeSource and the Caddy apt repo (blocked in the test sandbox; the fallbacks ran).

---

## Party-night checklist

- [ ] Steps 1-3 of the morning checklist done; `deploy/smoke.sh <url>`: all green.
- [ ] Play one full round with **one iPhone and one Android**, one of them on
      mobile data. Check the round-winner ceremony shows the prize and plays
      `victory.mp3`.
- [ ] Laptop: on power, `caffeinate -dis` running, notifications off.
- [ ] TV page `https://<host>/host` in Chrome, **fullscreen** (`F`), click once
      on the page so sound is allowed, sound through the TV (AirPlay / HDMI
      output set to the TV), volume up.
- [ ] iPhone guests: Share → **Add to Home Screen** opens the game without the
      Safari bars. Android goes fullscreen by itself when the guest joins.
- [ ] Ask guests to keep the screen on between rounds (iPhone: Low Power Mode
      off).
- [ ] Do not deploy during the party: a deploy restarts the server and empties
      the room.

## Troubleshooting

- **The QR shows `localhost`.** The QR uses the address the TV page was opened
  from (on `localhost` the server's LAN address instead). Force it with
  `?join=http://192.168.x.x:8787` on the TV URL, or `VITE_PUBLIC_URL` at build time.
- **HTTPS fails right after `gce-up.sh`.** Caddy gets the certificates on first
  boot; it needs ports 80 and 443 open (the script's firewall rule) and can take
  a few minutes. Watch `deploy/gce-logs.sh caddy`. Meanwhile use
  `https://<ip-with-dashes>.nip.io` or `http://<ip>` (both served by the same
  Caddy). Still stuck: `deploy/gce-logs.sh startup` shows whether Node and Caddy
  were installed.
- **`wss` blocked** (smoke.sh fails only on the websocket line, or phones sit on
  "connecting"). Some guest / corporate Wi-Fi blocks websockets or `sslip.io`:
  the phone joins fine on mobile data, or try the nip.io name.
- **A phone slept or the browser was closed.** Open the same page again: it
  rejoins as the same player (same name, same points) and plays from the next
  round. Keep phones awake (above).
- **`gcloud ... PERMISSION_DENIED` on the Cloud Run build.** A project Owner
  runs the `add-iam-policy-binding` command `cloudrun-deploy.sh` prints.
- **The VM cannot be created ("ZONE_RESOURCE_POOL_EXHAUSTED").** Another zone:
  `echo ZONE=europe-west1-c >> .env && deploy/gce-up.sh`.
- **Anything else:** `deploy/doctor.sh`, then the logs (`deploy/gce-logs.sh`,
  or `gcloud run services logs read party-arena --region=europe-west1`).
