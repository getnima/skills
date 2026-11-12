# Handoff: put Party Arena on Google Cloud for the party

You are setting up the server for **Party Arena**, a Kahoot-style party competition, for the
owner's house party on **Saturday 14.11 (evening, Israel time)**. The app is done and tested;
your job is to deploy it on Google Cloud with **gcloud only (no Firebase)**, prove it works
from outside, rehearse, and hand the owner the addresses. Do not redesign or refactor anything.

## What you are deploying

- Repo `github.com/getnima/skills`, branch **`claude/party-game-competition-xbobpz`**, folder **`party/`**.
  Work from the newest commit on that branch.
- One Node 22 process (express 5 + socket.io) serves the built client (Vite, Preact) and the
  websockets. Pages: `/` (guests' phones), `/host` (the TV), `/remote` (the owner's phone),
  `/healthz`.
- **Rooms live in the memory of that one process.** Exactly one instance, ever. A restart or a
  deploy empties the room (everyone rescans, points are lost). So: deploy, rehearse, then
  **freeze**. No deploy and no restart during the party.
- A complete, tested deploy kit is already in `party/deploy/` and documented in `party/README.md`
  ("Tomorrow morning: the 10-minute checklist" and "Deploy to Google Cloud"). Read both sections
  first. Every script has `--help` and `--dry-run`, is safe to re-run, and stops with the exact
  fix when gcloud is not ready.

## The decision (already made)

- **Path A, a Compute Engine VM: `deploy/gce-up.sh`.** `e2-small`, Debian 12, Node 22 under
  systemd (`Restart=always`), Caddy in front with automatic HTTPS on
  `https://<ip-with-dashes>.sslip.io`, `https://<ip-with-dashes>.nip.io` and plain `http://<ip>`,
  static IP, region `europe-west1` (about 60 ms from Israel). Websockets have no time limit and
  nothing replaces the VM during the evening. About $0.60 a day.
- Cloud Run (`deploy/cloudrun-deploy.sh`) only as an optional cold standby, created and left
  idle; never point guests at both. It cuts websockets every 60 minutes (phones reconnect) and
  may replace its instance, which drops the room.
- **No Firebase** (the owner's call): do not run `deploy/firebase-deploy.sh`, ignore `firebase.json`.

## Needs the owner (ask, do not guess)

1. `gcloud auth login` in a browser on this computer (and `gcloud auth application-default login`
   only if a script asks for it).
2. Which **Google Cloud project** to use, and that **billing is on** for it. Do not create a
   project or link a billing account without the owner's yes.
3. An **e-mail for `ACME_EMAIL`** (lets Caddy fall back to a second certificate authority).
   Optional but recommended. Never invent one.
4. Optional: their own **domain**. Only then set `DOMAIN=` and create an A record to the static IP
   (`deploy/doctor.sh` prints it).
5. The **remote password** stays the server's built-in default (in `server/config.ts`, server side
   only). Never print it, log it, put it in a URL, a commit or a chat message. If the owner wants a
   different one: after `gce-up.sh`, `deploy/gce-ssh.sh`, then
   `echo 'PARTY_REMOTE_PASSWORD=<their choice>' | sudo tee /etc/party-arena.env >/dev/null && sudo systemctl restart party-arena`
   (before guests arrive; the service reads that file).
6. Songs and videos they still want to add (see "Media" below): each one needs a deploy, so get
   them **before** the rehearsal.

## Steps

```bash
# 0. Get the code (macOS: Node 22, git, gcloud CLI installed; python3 + Pillow optional)
git clone https://github.com/getnima/skills.git && cd skills
git checkout claude/party-game-competition-xbobpz && cd party
node -v                      # v22.x
npm ci

# 1. Prove the tree before shipping it
npx tsc --noEmit             # clean
npx vitest run               # all pass (about 490 tests)
npm run build                # "[assets] skipped" without Pillow is fine: the art is already WebP

# 2. Settings
cp .env.example .env         # set PROJECT_ID (or `gcloud config set project ...`), ACME_EMAIL, DOMAIN if any
deploy/doctor.sh             # changes nothing; do every fix it prints, re-run until clean

# 3. Deploy (5-8 min the first time; the first certificate can take 1-5 min more)
deploy/gce-up.sh --dry-run   # read what it will do
deploy/gce-up.sh             # prints the https address(es) at the end

# 4. Prove it from outside
deploy/smoke.sh https://<ip-with-dashes>.sslip.io      # must end "All good"
deploy/smoke.sh https://<ip-with-dashes>.nip.io
deploy/smoke.sh http://<ip>
deploy/gce-logs.sh status                               # server + Caddy running, /healthz ok
```

If something fails, the README's "Troubleshooting" covers it: a busy zone
(`echo ZONE=europe-west1-c >> .env`), a certificate that is slow (`deploy/gce-logs.sh caddy`;
meanwhile nip.io or plain http), an IAM error (run the command the script prints, as a project Owner).

### 5. Rehearsal (before the guests, never during the party)

Open the TV page `https://<host>/host`, read the 4-letter room code, then:

```bash
npx tsx tests/load/bots.ts --url https://<host> --code <ROOM> --players 20 --play
```

Start a game from the TV (Space) and play it to the results with the bots; watch
`deploy/gce-logs.sh` for errors. Then **with the owner and real phones** (one iPhone, one
Android, one of them on mobile data): scan the QR, name, dress the doll, play one full round of
שימי טאפ to the winner ceremony. Afterwards open **☰ → חדר חדש** on the TV (a fresh room code) so
the party starts clean.

### 6. The room setup for the night (with the owner)

- The Mac: Chrome → `https://<host>/host` → click once on the page (allows sound) → `F`
  (fullscreen). Screen Mirroring to the Apple TV. Power cable in, `caffeinate -dis` in a terminal,
  notifications off.
- **Sound goes to the KEF LSX II over AirPlay.** AirPlay adds about 2 s of delay, so the TV has a
  sync screen (added on 12.11): press **`A`** on the TV, or on the remote ☰ → **סנכרון סאונד ותמונה**.
  1. Sound: press **AirPlay ≈ 2 שניות**, then −20 / +20 (or ±200) until the beep lands exactly on
     the disc's flash ("הביפ מאחר" → +).
  2. Picture: hold the remote phone next to the TV; −10 / +10 (or ±50) until both flash together
     (the TV flashes after the phone → +).
  3. Done. The 3-2-1 beeps, the start gong, the cutscenes' sound and the ceremony's drum roll and
     song are then all shifted by these numbers.
  The values are kept in that Chrome profile **for that exact address**: calibrate on the address
  the TV will use all night (sslip.io, nip.io and your domain are separate origins).
- The owner's phone: `https://<host>/remote` + the remote password. From then on the phone runs
  the show (the TV's keys keep working as a backup).
- Read the README's "Party-night checklist" with the owner.

### 7. Freeze, then after the party

- After the rehearsal: no `gce-deploy.sh`, no `gce-up.sh`, no restarts. If the server ever
  restarts it is back in 2 s with an empty room: everyone rescans the QR (photograph the
  standings after each round so totals can be carried by hand).
- Plan Z if the cloud fails on the night: README "Plan Z" (the laptop on the home Wi-Fi).
- After the party: `deploy/gce-down.sh` (and `deploy/cloudrun-down.sh` if you made the standby).
  Both ask first.

## Media (optional, the game works without them)

Already in: `audio/airhorn.mp3`, `audio/gong.mp3`, and the two test videos
`cutscenes/opening.*` and `cutscenes/tap_freeze.*`. Every missing song falls back to a built-in
synth tune. If the owner has them, drop in before step 3 (exact names, README step 1 table):
`client/public/audio/victory.mp3`, `final.mp3`, `lobby.mp3`, `tap.mp3`, `icy.mp3`, `flappy.mp3`,
`plotzel.mp3`, `ninja.mp3`; videos as H.264 + AAC `.mp4` in `client/public/cutscenes/` (delete the
`.webm` test clip of a video you replace). PNG art dropped into `client/public/assets/...` is
converted to WebP by `npm run build` when python3 + Pillow are installed (`pip3 install Pillow`),
and ships as PNG otherwise.

## Rules

- Do not change code. If a fix is truly needed, commit only to
  `claude/party-game-competition-xbobpz`, with the same tests green, and tell the owner what and why.
  Never push to `main`. Never run prettier.
- Never print, log or commit the remote password, tokens or the owner's personal details.
- Ask the owner before anything that costs money beyond the VM, or that deletes something.

## Report back to the owner

The three addresses (sslip.io, nip.io, http) and which one the TV uses; `smoke.sh` output for each;
the rehearsal result (bots + real phones, iPhone and Android, mobile data); the calibrated
sound / picture values; the commit you deployed (`git rev-parse --short HEAD`); and the teardown
command for after the party.
