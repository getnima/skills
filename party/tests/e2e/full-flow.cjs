// full-flow: the release regression. One real TV host page (1920x1080) and four
// emulated phones (two iPhone 14, two Pixel 7) play a whole competition: all
// five games, the cutscenes, the round-winner ceremony after every round and
// the final podium.
//
// Run against a dev stack:
//   PORT=8809 PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8809 PARTY_CLIENT_PORT=5209 npx vite
//   BASE_URL=http://localhost:5209 node tests/e2e/full-flow.cjs
// or against the production build (one origin):
//   npm run build
//   PORT=8809 PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=20000 node dist/server/index.mjs
//   BASE_URL=http://localhost:8809 HOST_PATH=/host SINGLE_ORIGIN=1 node tests/e2e/full-flow.cjs
//
// Env:
//   BASE_URL       where the client is served            (default http://localhost:5209)
//   HOST_PATH      path of the TV page                   (default /host.html; /host on the built server)
//   SINGLE_ORIGIN  1 = also check /host, /show, /healthz and a cutscene video with a Range request
//
// What it asserts (exit code 1 when anything failed):
//   - no page can scroll at any phone screenshot point; no console error / page error anywhere
//   - every phone scores > 0 in every game and the server row equals the phone's own final score
//   - mid-game cutscenes (automatic in tap, manual from the host menu in icy): score and time left
//     are identical through the freeze and the 3-2-1, input while frozen is dropped
//   - the 'before' (ninja) and 'final' (podium) cutscenes play; a phone reload and a host reload
//     mid-round resume
//   - winner ceremony: no phone shows a result before results.revealAt; the TV shows the winner's
//     name and the prize, the winner's phone shows the WIN moment within the same beat, the other
//     phones show who won, the victory song started on the TV and on the winner's phone
//   - points and totals on the host equal shared/scoring.ts applied to the raw scores
// Plotzel (the word ladder to פלוץ) is typed on its on-screen Hebrew keyboard: every phone follows
// the shortest path the game itself would show (window.__plotzel.path()), at a different pace.
// Screenshots: tests/e2e/out/full-flow/ (look at them: a layout break is not an assertion).
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const DRESS = require('./dress-lib.cjs');

const ROOT = path.resolve(__dirname, '../..');
const BASE = (process.env.BASE_URL || 'http://localhost:5209').replace(/\/+$/, '');
const HOST_PATH = process.env.HOST_PATH || '/host.html';
const SINGLE_ORIGIN = process.env.SINGLE_ORIGIN === '1';
// No video plays by itself for now (shared/cutscenes.ts, AUTO = false). AUTO_CUTSCENES=1 when that is
// set back to true: the tap clip, the one before the ninja and the one before the podium are then
// expected to start by themselves, as this script was written.
const AUTO_CUTSCENES = process.env.AUTO_CUTSCENES === '1';
const OUT = path.join(__dirname, 'out', 'full-flow');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
let passed = 0;
function check(ok, msg, extra) {
  if (ok) {
    passed++;
    console.log('  ok  ', msg);
  } else {
    failures.push(msg + (extra !== undefined ? ' ' + JSON.stringify(extra) : ''));
    console.log('  FAIL', msg, extra !== undefined ? JSON.stringify(extra) : '');
  }
}
const log = (...a) => console.log('[flow]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(40);
  }
}

/** Bundle a TS module of the project (pure code only) and load it here. */
function loadTs(entry) {
  const esbuild = require(path.join(ROOT, 'node_modules/esbuild'));
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { computeRoundScores } = loadTs('shared/scoring.ts');
const { GAMES, GAME_IDS } = loadTs('shared/protocol.ts');

// ───────────────────────────── pages ─────────────────────────────
const pageErrors = [];
function watchErrors(page, name) {
  page.on('pageerror', (e) => pageErrors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    // The TV probes which cutscene files exist (they can be dropped in without a rebuild); on the
    // built server a missing one is a 404 the browser logs by itself. Nothing else is tolerated.
    if (m.type() === 'error' && /\/cutscenes\/[\w-]+\.(mp4|webm)$/.test(m.location().url || '') && /404/.test(m.text())) return;
    if (m.type() === 'error') pageErrors.push(`${name} console: ${m.text()} @ ${m.location().url || ''}`);
  });
}

let shotN = 0;
async function noScroll(page, label) {
  const m = await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    return { sh: se.scrollHeight, sw: se.scrollWidth, H: window.innerHeight, W: window.innerWidth, y: window.scrollY };
  });
  if (!(m.sh <= m.H && m.sw <= m.W && m.y === 0)) check(false, `${label}: page cannot scroll`, m);
  else passed++;
}
/** Screenshot of several pages at the same moment; phones are also checked for scroll. */
async function shots(stage, pages) {
  const n = String(++shotN).padStart(3, '0');
  await Promise.all(
    pages.map(async (p) => {
      try {
        await p.page.screenshot({ path: path.join(OUT, `${n}-${stage}-${p.label}.png`) });
        await noScroll(p.page, `${stage}/${p.label}`);
      } catch (e) {
        check(false, `screenshot ${stage}/${p.label}`, String(e.message).slice(0, 120));
      }
    }),
  );
}

const pinfo = (ph) =>
  ph.page.evaluate(() => {
    const p = window.__player;
    if (!p) return null;
    const pl = window.__playerPlay;
    const st = p.snap.state;
    // the score on the phone's HUD (the stage reports it to the app throttled, so stageScore can lag)
    const hud = document.querySelector('.pa-hud-num');
    const hudScore = hud ? Number(hud.textContent.replace(/[^\d]/g, '')) : null;
    // the best score this tab reported for the round (controller.sendScore keeps it in sessionStorage)
    const ri = st && st.round ? st.round.index : st && st.results ? st.results.roundIndex : null;
    let sent = null;
    try {
      const v = ri === null ? null : sessionStorage.getItem(`party.score.${p.snap.code}.${ri}`);
      sent = v === null ? null : Number(v);
    } catch {
      sent = null;
    }
    return {
      screen: p.screen,
      cutscene: p.cutscene,
      resuming: p.resuming,
      now: p.now(),
      id: p.snap.playerId,
      score: pl ? (hudScore ?? pl.stageScore) : null,
      leftMs: pl ? pl.leftMs : null,
      frozen: pl ? pl.frozen : null,
      endedRound: p.snap.endedRound,
      endedScore: p.snap.endedScore,
      sent,
      revealAt: st && st.results ? st.results.revealAt : null,
      phase: st ? st.phase : null,
    };
  });
const screenOf = async (ph) => {
  const i = await pinfo(ph).catch(() => null);
  return i ? i.screen : null;
};
const waitScreen = (ph, names, ms, label) =>
  waitFor(async () => names.includes(await screenOf(ph)), ms, `${ph.label} screen ${names.join('/')} (${label || ''})`).catch(async (e) => {
    throw new Error(`${e.message}; now ${await screenOf(ph)}`);
  });

// ───────────────────────────── game input ─────────────────────────────
/** Runs `step` again and again while the phone is in the live game; idles while frozen / held. */
function drive(ph, step) {
  const d = { alive: true };
  d.done = (async () => {
    while (d.alive) {
      try {
        const i = await pinfo(ph);
        // what the phone's HUD last showed in the game (an elimination round ends without a time-up on the phone)
        if (i && i.screen === 'playing' && typeof i.score === 'number') ph.hudFinal = i.score;
        if (!i || i.screen !== 'playing' || i.frozen !== false || i.cutscene || ph.hold) {
          await sleep(50);
          continue;
        }
        ph.lastLive = { score: i.score, leftMs: i.leftMs };
        await step(i);
      } catch {
        await sleep(80); // a reload in the middle of a step
      }
    }
  })();
  return d;
}
async function stopDrivers(list) {
  for (const d of list) d.alive = false;
  await Promise.all(list.map((d) => d.done));
}

const tapFace = (ph) => ph.page.evaluate(() => (window.__tap ? window.__tap() : null));
function tapDriver(ph, gapMs) {
  return drive(ph, async () => {
    const f = await tapFace(ph);
    if (!f) return sleep(50);
    ph.face = f;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * f.r * 0.55;
    await ph.page.touchscreen.tap(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r);
    await sleep(gapMs);
  });
}
function icyDriver(ph, holdMs) {
  let left = true;
  return drive(ph, async () => {
    const vp = ph.page.viewportSize();
    await ph.page.mouse.move(left ? vp.width * 0.2 : vp.width * 0.8, vp.height * 0.6);
    await ph.page.mouse.down();
    await sleep(holdMs);
    await ph.page.mouse.up();
    left = !left;
    await sleep(40);
  });
}
function flappyDriver(ph, skill) {
  let lastTap = 0;
  return drive(ph, async () => {
    const s = await ph.page.evaluate(() => {
      const f = window.__flappy;
      return f ? { mode: f.mode, y: f.birdY, vy: f.vy, next: f.next, hint: f.hint } : null;
    });
    if (!s) return sleep(30);
    const vp = ph.page.viewportSize();
    const tap = async () => {
      await ph.page.touchscreen.tap(vp.width * (0.3 + Math.random() * 0.4), vp.height * (0.4 + Math.random() * 0.3));
      lastTap = Date.now();
    };
    // one life (elimination): once the bird is down ('dead' / 'out') this phone only watches
    if (s.mode === 'fly' && s.hint > 0.5 && Date.now() - lastTap > 300) {
      await tap(); // the bird hangs until the first tap
    } else if (s.mode === 'fly') {
      const aim = (s.next.x < 30 ? s.next.gapY + s.next.gap * 0.18 : 48) + (1 - skill) * (Math.random() - 0.5) * 22;
      if (s.y > aim && s.vy > -25 && Date.now() - lastTap > 150) await tap();
    }
    await sleep(8);
  });
}
async function swipe(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6);
    await sleep(10);
  }
  await page.mouse.up();
}
function ninjaDriver(ph, restMs) {
  return drive(ph, async () => {
    const ts = await ph.page.evaluate(() => (window.__ninja ? window.__ninja.targets() : []));
    const vp = ph.page.viewportSize();
    const lead = 0.06;
    const pts = ts.map((t) => ({ ...t, px: t.x + t.vx * lead, py: t.y + (t.vy + 600) * lead }));
    const bombs = pts.filter((t) => t.kind === 'bomb');
    const fruit = pts.find(
      (t) => t.kind !== 'bomb' && t.py > 140 && t.py < vp.height - 50 && bombs.every((b) => Math.abs(b.py - t.py) > b.r * 2.4 || Math.abs(b.px - t.px) > b.r * 4),
    );
    if (!fruit) return sleep(40);
    await swipe(ph.page, fruit.px - fruit.r * 1.5, fruit.py, fruit.px + fruit.r * 1.5, fruit.py);
    await sleep(restMs);
  });
}

// plotzel: type the next word of the shortest path on the on-screen keys (finals have their own keys)
function plotzelDriver(ph, keyGapMs) {
  // a short timeout: when the round ends in the middle of a word the keyboard is gone, and a tap
  // that waited the default 30 s for it would hold stopDrivers() past the whole winner ceremony
  const key = (k) => ph.page.locator(`.pz-key[data-k="${k}"]`).tap({ timeout: 1200 });
  return drive(ph, async () => {
    const s = await ph.page.evaluate(() => {
      const p = window.__plotzel;
      return p && p.phase === 'play' ? { next: p.path()[1], typed: Array.from(p.typed).length } : null;
    });
    if (!s || !s.next) return sleep(80);
    for (let i = 0; i < s.typed; i++) await key('BACK');
    for (const ch of Array.from(s.next)) {
      await key(ch);
      await sleep(keyGapMs);
    }
    await key('ENTER');
    ph.mid = true;
    await sleep(keyGapMs);
  });
}

// ───────────────────────────── the run ─────────────────────────────
(async () => {
  const browser = await chromium.launch();
  const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const host = await hostCtx.newPage();
  watchErrors(host, 'host');
  const H = { page: host, label: 'host' };
  const hs = () => host.evaluate(() => (window.__host ? window.__host.state() : null));
  const hnow = () => host.evaluate(() => window.__host.now());
  const waitPhase = (phase, ms = 20000) =>
    host.waitForFunction((p) => window.__host && window.__host.state() && window.__host.state().phase === p, phase, { timeout: ms });
  const waitCut = (on, ms = 20000) =>
    host.waitForFunction((v) => !!(window.__host && window.__host.state() && window.__host.state().cutscene) === v, on, { timeout: ms });
  const music = (page) => page.evaluate(() => ({ started: window.__partyMusic.started.filter((n) => n === 'victory').length, playing: window.__partyMusic.playing('victory') }));

  const phones = [];
  const totals = new Map(); // playerId → points recomputed here
  let drivers = [];

  try {
    // ── host: fresh room ──
    await host.goto(BASE + HOST_PATH);
    await host.evaluate(() => localStorage.clear());
    await host.goto(BASE + HOST_PATH);
    await host.waitForSelector('[data-testid=room-code]', { timeout: 15000 });
    await sleep(600);
    const code = (await host.textContent('[data-testid=room-code]')).trim();
    check(/^[A-Z0-9]{4}$/.test(code), `room code ${code}`);
    await host.mouse.click(960, 60); // a first click unlocks the TV's sound
    const shown = (await host.textContent('[data-testid=join-url]')).trim();
    const qrUrl = await host.evaluate(() => {
      const s = window.__host.state();
      return s ? s.code : null;
    });
    check(shown.includes(code) && qrUrl === code, `host shows a join URL with the code (${shown})`);
    const join = new URL(/^https?:/.test(shown) ? shown : 'http://' + shown);
    const joinUrl = (extra) => `${BASE}${join.pathname}${join.search}${extra || ''}`;
    await shots('lobby-empty', [H]);

    // ── four phones join with Hebrew names ──
    const spec = [
      // the first phone goes through the real dressing room (dress=1); the others rely on the
      // test switch: an automated browser skips the step (tests/e2e/dress-lib.cjs)
      { label: 'iphone-a', device: 'iPhone 14', name: 'דנה', q: '&dress=1' },
      { label: 'iphone-b', device: 'iPhone 14', name: 'יוסי המלך', q: '' },
      { label: 'pixel-c', device: 'Pixel 7', name: 'מיכל', q: '' },
      { label: 'pixel-d', device: 'Pixel 7', name: 'אבי', q: '' },
    ];
    for (const s of spec) {
      const ctx = await browser.newContext({ ...devices[s.device] });
      const page = await ctx.newPage();
      watchErrors(page, s.label);
      const ph = { page, label: s.label, name: s.name, hold: false, lastLive: null, face: null, mid: false };
      phones.push(ph);
      await page.goto(joinUrl(s.q));
      await waitScreen(ph, ['join'], 15000, 'open');
      if (s.label === 'iphone-a') await shots('join', [ph]);
      await page.fill('.pp-name-input', s.name);
      if (s.label === 'pixel-c') await shots('join-typed', [ph]);
      await page.locator('.pp-btn-go').tap();
      if (s.q.includes('dress=1')) {
        await DRESS.waitDressing(page);
        await sleep(1000);
        await shots('dressing', [ph]);
        const look = await DRESS.tapItem(page, 'HEAD', 1);
        const onTv = await waitFor(async () => {
          const st = await host.evaluate(() => window.__host.state());
          return st && st.players.some((p) => p.look === look);
        }, 3000, 'the TV hears the look').catch(() => false);
        check(onTv === true, `${s.label}: the look dressed on the phone reaches the TV (${look})`);
        await DRESS.finishDressing(page);
      }
      await waitScreen(ph, ['lobby'], 10000, 'joined');
      ph.id = (await pinfo(ph)).id;
      totals.set(ph.id, 0);
    }
    const [A, B, C, D] = phones;
    const byId = new Map(phones.map((p) => [p.id, p]));
    await waitFor(async () => (await hs()).players.length === 4, 8000, 'host sees 4 players');
    const names = (await hs()).players.map((p) => p.name).sort();
    check(JSON.stringify(names) === JSON.stringify(phones.map((p) => p.name).sort()), 'host lists the four Hebrew names', names);
    await sleep(700);
    await shots('lobby-4', [H, A, C]);

    // ── one round ──
    async function playRound(gameId, opt) {
      const game = GAMES[gameId];
      log(`── ${gameId} ──`);
      const tag = (s) => `${gameId}-${s}`;
      for (const p of phones) {
        p.lastLive = null;
        p.mid = false;
        p.hudFinal = 0;
      }

      // start: round 1 from the game card, the rest from the primary button
      if (opt.startByCard) await host.click(`[data-testid=game-${gameId}]`, { force: true });
      else {
        const label = await host.textContent('[data-testid=btn-primary]');
        check(label.includes(game.title), `primary button offers ${game.title}`, label);
        await host.click('[data-testid=btn-primary]', { force: true });
      }

      if (opt.beforeCutscene) {
        await waitCut(true, 5000);
        check((await hs()).cutscene.id === opt.beforeCutscene, `'before' cutscene ${opt.beforeCutscene} fires`);
        await waitFor(async () => (await pinfo(A)).cutscene, 4000, 'phone sees the before cutscene');
        await sleep(700);
        await shots(tag('cutscene-before'), [H, A, C]);
        check((await host.locator('[data-testid=cutscene]').count()) === 1, 'TV shows the cutscene player');
        await waitCut(false, 12000);
      }

      await waitPhase('intro', 8000);
      // read the TV's intro first: with test timing it is on screen for 1.5 s only, and three
      // screenshots on a busy machine can take longer than that
      const introText = await host.textContent('[data-testid=intro]', { timeout: 5000 }).catch(() => '');
      await Promise.all([A, C].map((p) => waitScreen(p, ['intro'], 5000, 'intro')));
      await shots(tag('intro'), [H, A, C]);
      check(introText.includes(game.title), `TV intro shows ${game.title}`);

      // countdown: the TV and a phone show the same digit from the same clock
      await waitPhase('countdown', 12000);
      await Promise.all([
        host.waitForSelector('[data-testid=countdown-num]', { timeout: 4000 }),
        ...[A, C].map((p) => p.page.waitForFunction(() => { const n = document.querySelector('.pp-cd-num'); return n && /\d/.test(n.textContent); }, null, { timeout: 4000 })),
      ]);
      // Both pages are asked at the same moment; on a busy machine the two answers can still be
      // taken far apart, so the pair is sampled a few times and one clean pair is enough.
      const digitOk = (c) => [c.now - 120, c.now, c.now + 120].some((t) => String(Math.ceil((c.startAt - t) / 1000)) === c.num);
      let cd = [];
      let cdOk = false;
      for (let i = 0; i < 5 && !cdOk; i++) {
        if (i > 0) await sleep(70);
        cd = await Promise.all([
          host.evaluate(() => ({ num: document.querySelector('[data-testid=countdown-num]')?.textContent.trim(), now: window.__host.now(), startAt: window.__host.state().round?.startAt })),
          A.page.evaluate(() => ({ num: document.querySelector('.pp-cd-num')?.textContent.trim(), now: window.__player.now(), startAt: window.__player.snap.state.round?.startAt })),
        ]).catch(() => []);
        cdOk = cd.length === 2 && cd[0].startAt === cd[1].startAt && digitOk(cd[0]) && digitOk(cd[1]) && Math.abs(cd[0].now - cd[1].now) < 250;
      }
      check(cdOk, 'countdown: TV and phone on the same clock and digit', cd);
      await shots(tag('countdown'), [H, A, C]);

      // GO
      await Promise.all(phones.map((p) => waitScreen(p, ['playing'], 8000, 'go')));
      const st0 = await hs();
      check(st0.phase === 'playing' && st0.round.gameId === gameId, `host is playing ${gameId}`);
      const round = st0.round;
      const durationMs = round.endAt - round.startAt;

      // input
      if (gameId === 'tap') drivers = [tapDriver(A, 45), tapDriver(B, 110), tapDriver(C, 170), tapDriver(D, 260)];
      else if (gameId === 'icy') drivers = [icyDriver(A, 700), icyDriver(B, 1000), icyDriver(C, 850), icyDriver(D, 550)];
      else if (gameId === 'flappy') drivers = [flappyDriver(A, 0.75), flappyDriver(B, 0.95), flappyDriver(C, 0.85), flappyDriver(D, 0.6)];
      else if (gameId === 'ninja') drivers = [ninjaDriver(A, 260), ninjaDriver(B, 420), ninjaDriver(C, 120), ninjaDriver(D, 60)];
      else if (gameId === 'plotzel') {
        drivers = [plotzelDriver(A, 60), plotzelDriver(B, 140), plotzelDriver(C, 220), plotzelDriver(D, 320)];
        // every phone plays the same ladders in the same order
        const seqs = await Promise.all(phones.map((p) => p.page.evaluate(() => (window.__plotzel ? window.__plotzel.sequence(12).join(',') : null))));
        check(seqs[0] !== null && seqs.every((q) => q === seqs[0]), 'plotzel: the same ladder sequence on every phone', seqs.map((q) => (q || '').slice(0, 20)));
      }

      // mid-game shots
      if (gameId === 'plotzel') {
        await waitFor(() => A.mid && C.mid, 12000, 'plotzel mid');
        await sleep(300);
        await shots(tag('mid'), [H, A, B, C]);
      } else {
        await sleep(Math.min(3200, durationMs * 0.22));
        await shots(tag('mid'), [H, A, C]);
      }

      // a phone reload in the middle of the round
      if (opt.phoneReload) {
        const ph = opt.phoneReload;
        ph.hold = true;
        await sleep(150);
        const before = await pinfo(ph);
        await ph.page.reload();
        await waitScreen(ph, ['playing'], 8000, 'after reload');
        // the game is mounted again (it may come back straight into a cutscene)
        const after = await waitFor(async () => { const i = await pinfo(ph); return i && i.leftMs !== null && i.leftMs <= before.leftMs && i.frozen !== null ? i : null; }, 6000, 'game back after reload');
        check(after.id === before.id && after.leftMs > 0 && after.leftMs <= before.leftMs, `${ph.label} reload mid-round resumes the same round`, { before: before.leftMs, after: after.leftMs });
        ph.reloadScore = before.score;
        ph.hold = false;
      }

      // a mid-game cutscene: automatic (tap) or from the host's menu
      if (opt.freeze) {
        const ph = opt.freeze.phone;
        if (opt.freeze.manual) {
          await host.click('[data-testid=btn-cutscenes]', { force: true });
          await host.waitForSelector('[data-testid=cutscene-menu]');
          await host.waitForFunction((id) => document.querySelector(`[data-testid=cm-${id}] [data-status=ok]`) !== null, opt.freeze.id, { timeout: 5000 });
          await shots(tag('cutscene-menu'), [H]);
          await host.click(`[data-testid=cm-play-${opt.freeze.id}]`, { force: true });
        }
        await waitCut(true, durationMs);
        check((await hs()).cutscene.id === opt.freeze.id, `mid-game cutscene ${opt.freeze.id} (${opt.freeze.manual ? 'host menu' : 'automatic'})`);
        const s1 = await waitFor(async () => { const i = await pinfo(ph); return i && i.frozen && i.cutscene ? i : null; }, 3000, 'phone frozen');
        const pre = ph.lastLive;
        check(pre !== null && s1.score >= pre.score && (gameId !== 'tap' || s1.score - pre.score <= 12) && s1.leftMs <= pre.leftMs && pre.leftMs - s1.leftMs < 1500, `${ph.label}: frozen where it was playing`, { pre, at: { score: s1.score, leftMs: s1.leftMs } });
        // input while frozen is dropped
        const vp = ph.page.viewportSize();
        for (let i = 0; i < 12; i++) await ph.page.touchscreen.tap(ph.face ? ph.face.x : vp.width / 2, ph.face ? ph.face.y : vp.height * 0.6);
        await swipe(ph.page, vp.width * 0.2, vp.height * 0.5, vp.width * 0.8, vp.height * 0.55);
        await host.waitForFunction(() => { const v = document.querySelector('[data-testid=cutscene-video]'); return v && v.currentTime > 0.8; }, null, { timeout: 8000 }).catch(() => check(false, 'cutscene video is playing on the TV'));
        const src = await host.getAttribute('[data-testid=cutscene-video]', 'data-src').catch(() => null);
        check(src !== null && src.includes(opt.freeze.id), 'TV plays the cutscene file', src);
        await shots(tag('cutscene'), [H, A, C]);
        const overlay = await ph.page.evaluate(() => { const e = document.querySelector('.pp-cutscene'); return e ? e.textContent : null; });
        check(overlay !== null && overlay.includes('טלוויזיה'), `${ph.label}: "watch the TV" screen`, overlay);
        const s2 = await pinfo(ph);
        check(s2.score === s1.score && s2.leftMs === s1.leftMs && s2.frozen, `${ph.label}: taps while frozen are dropped, the clock stands`, { s1: [s1.score, s1.leftMs], s2: [s2.score, s2.leftMs] });
        await waitCut(false, 15000); // the TV ends it when the video ends
        await waitFor(async () => (await pinfo(ph)).resuming, 3000, 'resume 3-2-1 on the phone');
        await host.waitForSelector('[data-testid=resume]', { timeout: 3000 });
        await shots(tag('resume-321'), [H, A, C]);
        const s3 = await pinfo(ph);
        check(s3.frozen && s3.score === s1.score && Math.abs(s3.leftMs - s1.leftMs) <= 2, `${ph.label}: same score and time left in the 3-2-1`, { s1: [s1.score, s1.leftMs], s3: [s3.score, s3.leftMs] });
        const hostLeft = await host.evaluate(() => { const r = window.__host.state().round; return r.endAt - (r.resumeAt ?? window.__host.now()); });
        check(Math.abs(hostLeft - s1.leftMs) <= 2, 'TV and phone agree on the time left after the cutscene', { hostLeft, phone: s1.leftMs });
        ph.hold = true; // nothing is pressed until we have read the first live frame
        const s4 = await waitFor(async () => { const i = await pinfo(ph); return i && i.frozen === false ? i : null; }, 6000, 'play continues');
        ph.hold = false;
        check(s4.score === s1.score && s4.leftMs <= s1.leftMs && s4.leftMs > s1.leftMs - 700, `${ph.label}: continues exactly where it stopped`, { before: [s1.score, s1.leftMs], after: [s4.score, s4.leftMs] });
        await sleep(1500);
        const s5 = await pinfo(ph);
        check(s5.leftMs < s4.leftMs && s5.score >= s4.score, `${ph.label}: the game runs again after the resume`, { s4: [s4.score, s4.leftMs], s5: [s5.score, s5.leftMs] });
      }

      // a TV refresh in the middle of the round
      if (opt.hostReload) {
        const before = await hs();
        await host.reload();
        await host.waitForFunction(() => window.__host && window.__host.state() !== null, null, { timeout: 10000 });
        const after = await hs();
        check(after.code === before.code && after.phase === 'playing' && after.round.index === before.round.index && after.players.length === 4, 'host reload mid-round re-attaches to the running round', { phase: after.phase });
        await host.mouse.click(960, 60);
        await sleep(900);
        await shots(tag('host-after-reload'), [H]);
      }

      // end of round → results. From here no phone may show a result before revealAt.
      await waitPhase('results', durationMs + 30000);
      await stopDrivers(drivers);
      drivers = [];
      const res = (await hs()).results;
      const spoiled = [];
      const watch = { on: true };
      const watcher = (async () => {
        while (watch.on) {
          for (const p of phones) {
            const i = await pinfo(p).catch(() => null);
            if (i && ['win', 'reveal', 'results'].includes(i.screen) && i.now < res.revealAt) spoiled.push(`${p.label}:${i.screen}@${Math.round(i.now - res.revealAt)}`);
          }
          await sleep(60);
        }
      })();

      // scores: every phone scored, the server row is the phone's own final score, points = shared/scoring.ts
      // No ties anywhere: equal raw scores are ordered by the server's reachedAt stamp (in the rows), then join order.
      const joinOrder = new Map((await hs()).players.map((pl, k) => [pl.id, k]));
      const expect = computeRoundScores(
        res.rows.map((r) => ({ playerId: r.playerId, id: r.playerId, raw: r.raw, reachedAt: r.reachedAt, joinOrder: joinOrder.get(r.playerId), totalBefore: totals.get(r.playerId) || 0 })),
      );
      const byRound = [...res.rows].sort((x, y) => x.roundRank - y.roundRank);
      const scorers = byRound.filter((r) => r.raw > 0);
      check(
        res.rows.every((r, k) => r.rank === k + 1) && byRound.every((r, k) => r.roundRank === k + 1) && byRound.every((r, k) => k === 0 || r.raw <= byRound[k - 1].raw),
        `${gameId}: strict ranks 1..n overall and in the round, round order follows the raw score`,
        res.rows.map((r) => [r.name, r.raw, r.roundRank, r.rank]),
      );
      check(scorers.every((r, k) => k === 0 || r.points < scorers[k - 1].points) && new Set(res.rows.map((r) => r.total).filter((t) => t > 0)).size === res.rows.filter((r) => r.total > 0).length, `${gameId}: no two scorers on the same points, no two players on the same total`, res.rows.map((r) => [r.name, r.points, r.total]));
      let prevTotalsOk = true;
      for (const p of phones) {
        const row = res.rows.find((r) => r.playerId === p.id);
        const i = await pinfo(p);
        check(row !== undefined && row.raw > 0, `${p.label} scored in ${gameId} (raw ${row && row.raw})`);
        // A game that finished early never hits the round's end on the phone (and the server ends the round as soon as
        // every final is in): then the phone's final is the larger of its HUD's last reading (polled, it can miss the
        // last tap) and the best score the tab reported.
        const own = i.endedRound === res.roundIndex ? i.endedScore : Math.max(p.hudFinal ?? 0, i.sent ?? 0);
        if (GAMES[gameId].mode === 'elimination' && row !== undefined && row.playerId === res.winnerIds[0] && i.endedRound !== res.roundIndex) {
          // the last one standing never sends a final: the server has its last live report (or one more than the best final)
          check(row.raw > 0 && row.raw <= own + 10 && res.rows.every((r) => r === row || r.raw < row.raw), `${p.label}: the last one standing is above every final`, { phone: own, server: row.raw });
        } else check(row !== undefined && own === row.raw, `${p.label}: server raw = the phone's final score`, { phone: own, server: row && row.raw });
        const e = expect.get(p.id);
        if (!(row && e && e.points === row.points && e.roundRank === row.roundRank)) prevTotalsOk = false;
        totals.set(p.id, totals.get(p.id) + (e ? e.points : 0));
        if (!(row && row.total === totals.get(p.id))) prevTotalsOk = false;
        if (p.reloadScore !== undefined) {
          check(row.raw >= p.reloadScore, `${p.label}: the score from before its reload was kept`, { before: p.reloadScore, final: row.raw });
          delete p.reloadScore;
        }
      }
      check(prevTotalsOk, `${gameId}: points, ranks and totals equal shared/scoring.ts`, res.rows.map((r) => [r.name, r.raw, r.points, r.total]));
      check(res.winnerIds.length === 1 && expect.get(res.winnerIds[0]).roundRank === 1 && res.winnerIds[0] === scorers[0].playerId, `${gameId}: exactly one round winner (${res.winnerIds.map((id) => byId.get(id).name).join(', ')})`);
      const winner = byId.get(res.winnerIds[0]);
      const loser = phones.find((p) => !res.winnerIds.includes(p.id) && (winner === A ? p === C : p === A)) || phones.find((p) => !res.winnerIds.includes(p.id));
      const songsBefore = (await music(host)).started;

      // suspense
      await Promise.all(phones.map((p) => waitScreen(p, ['suspense'], 6000, 'suspense')));
      await sleep(Math.max(0, res.revealAt - 4200 - (await hnow())));
      await shots(tag('suspense'), [H, A, C]);
      check((await host.locator('.sh-results--suspense').count()) === 1 && (await host.locator('.sh-cer-name').count()) === 0, 'TV: suspense, the winner is still hidden');

      // the reveal: TV name + prize, winner's phone WIN, other phones who won: on the same beat
      const stamp = async (p, fn, ms) => { await waitFor(fn, ms, `${p.label} reveal`); return p === H ? hnow() : (await pinfo(p)).now; };
      const [tTv, tWin, ...tOthers] = await Promise.all([
        stamp(H, async () => (await host.locator('.sh-cer-name').count()) > 0, 12000),
        stamp(winner, async () => (await screenOf(winner)) === 'win', 12000),
        ...phones.filter((p) => !res.winnerIds.includes(p.id)).map((p) => stamp(p, async () => (await screenOf(p)) === 'reveal', 12000)),
      ]);
      watch.on = false;
      await watcher;
      check(spoiled.length === 0, 'no phone shows a result before revealAt', spoiled.slice(0, 6));
      const rel = [tTv, tWin, ...tOthers].map((t) => Math.round(t - res.revealAt));
      check(rel.every((r) => r >= 0 && r < 1600) && Math.max(...rel) - Math.min(...rel) < 700, `reveal lands together on TV and phones (ms after revealAt: TV ${rel[0]}, winner ${rel[1]}, others ${rel.slice(2).join('/')})`);
      await sleep(1300);
      await shots(tag('ceremony'), [H, { page: winner.page, label: `${winner.label}-WIN` }, { page: loser.page, label: `${loser.label}-reveal` }]);
      const tvName = await host.textContent('.sh-cer-name');
      const tvLine = await host.textContent('.sh-cer-line');
      check(tvName.includes(winner.name) && tvLine.includes('שימי אנג׳ל') && (await host.locator('.sh-cer-prize .sh-prize').count()) === 1, `TV ceremony: ${winner.name} + the prize`, { tvName, tvLine });
      const mh = await music(host);
      check(mh.started === songsBefore + 1 && mh.playing, 'TV: the victory song started with the ceremony', mh);
      const mw = await music(winner.page);
      check(mw.playing, `${winner.label}: victory song on the winner's phone`, mw);
      const winText = await winner.page.textContent('.pp-win');
      check(winText.includes('זכית בשימי אנג׳ל'), `${winner.label}: WIN moment`, winText.slice(0, 60));
      const revText = await loser.page.textContent('.pp-reveal');
      check(revText.includes(winner.name), `${loser.label}: sees who won`, revText.slice(0, 60));
      await sleep(2600);
      await shots(tag('ceremony-prize'), [H]);

      // personal results on the phones, standings on the TV
      await winner.page.locator('.pp-btn-ghost').tap();
      await Promise.all(phones.map((p) => waitScreen(p, ['results'], 9000, 'personal results')));
      await sleep(1900);
      await shots(tag('results'), [H, A, C]);
      await host.waitForSelector('.sh-results--standings', { timeout: 15000 });
      await sleep(2600);
      await shots(tag('standings'), [H]);
      check(!(await music(winner.page)).playing, `${winner.label}: the song stopped after the WIN moment`);
    }

    // ── the competition ──
    // (without the automatic videos the tap clip is played from the TV's menu, mid-round)
    await playRound('tap', { startByCard: true, phoneReload: D, freeze: { id: 'tap_freeze', manual: !AUTO_CUTSCENES, phone: A } });
    await host.click('[data-testid=btn-primary]', { force: true });
    await waitPhase('lobby');
    await Promise.all(phones.map((p) => waitScreen(p, ['lobby'], 5000, 'lobby')));
    await sleep(1000);
    await shots('lobby-standings', [H, A, C]);

    await playRound('icy', { freeze: { id: 'opening', manual: true, phone: C }, hostReload: true });
    await host.click('[data-testid=btn-primary]', { force: true });
    await waitPhase('lobby');

    await playRound('flappy', {});
    await host.keyboard.press('Space'); // the main action from the keyboard
    await waitPhase('lobby');

    await playRound('plotzel', {});
    await host.click('[data-testid=btn-primary]', { force: true });
    await waitPhase('lobby');
    await sleep(800);
    await shots('lobby-before-last', [H]);

    await playRound('ninja', AUTO_CUTSCENES ? { beforeCutscene: 'before_ninja' } : {});

    // ── final podium, after its cutscene ──
    const st = await hs();
    check(GAME_IDS.every((g) => st.played.includes(g)), 'all five games played', st.played);
    const label = await host.textContent('[data-testid=btn-primary]');
    check(label.includes('פודיום'), 'primary button offers the podium', label);
    await host.click('[data-testid=btn-primary]', { force: true });
    if (AUTO_CUTSCENES) {
      await waitCut(true, 5000);
      check((await hs()).cutscene.id === 'before_podium', "'final' cutscene before the podium");
      await waitFor(async () => (await pinfo(A)).cutscene, 4000, 'phone sees the final cutscene');
      await sleep(700);
      await shots('final-cutscene', [H, A, C]);
      await waitCut(false, 12000);
    } else {
      await waitPhase('final');
      await sleep(1500);
      check((await hs()).cutscene === null, 'no video plays by itself before the podium');
    }
    await waitPhase('final');
    await Promise.all(phones.map((p) => waitScreen(p, ['final'], 6000, 'final')));
    await sleep(2500);
    await shots('final-1', [H]);
    await sleep(5000);
    await shots('final-2', [H, A, C]);
    await sleep(6000);
    await shots('final-3', [H, B, D]);
    const end = await hs();
    const hostTotals = Object.fromEntries(end.players.map((p) => [p.name, p.total]));
    const mine = Object.fromEntries(phones.map((p) => [p.name, totals.get(p.id)]));
    check(JSON.stringify(Object.entries(hostTotals).sort()) === JSON.stringify(Object.entries(mine).sort()), 'host totals = sum over rounds of shared/scoring.ts points', { hostTotals, mine });
    check([...end.players].map((p) => p.rank).sort((a, b) => a - b).every((r, k) => r === k + 1), 'final: the server ranks are 1..n, nobody shares a place', end.players.map((p) => [p.name, p.total, p.rank]));
    const champ = end.players.find((p) => p.rank === 1);
    const finalText = await host.textContent('[data-testid=final]');
    check(finalText.includes(champ.name), `podium shows the champion ${champ.name}`);
    const place = await byId.get(champ.id).page.textContent('.pp-final-place').catch(() => '');
    check(/1|ראשון|🥇/.test(place || ''), "champion's phone shows first place", place);

    if (SINGLE_ORIGIN) {
      log('── single-origin server checks ──');
      for (const p of ['/', '/host', '/show', '/healthz']) {
        const r = await fetch(BASE + p);
        check(r.status === 200, `GET ${p} → ${r.status}`);
      }
      const r = await fetch(`${BASE}/cutscenes/opening.webm`, { headers: { Range: 'bytes=0-99' } });
      const body = await r.arrayBuffer();
      check(r.status === 206 && body.byteLength === 100 && /^bytes 0-99\//.test(r.headers.get('content-range') || ''), `cutscene video answers a Range request (${r.status} ${r.headers.get('content-range')})`);
      const show = await hostCtx.newPage();
      watchErrors(show, 'show');
      await show.goto(`${BASE}/show`);
      await show.waitForSelector('.sh-scene', { timeout: 10000 });
      await sleep(1500);
      await shots('show-page', [{ page: show, label: 'show' }]);
      await show.close();
    }
  } catch (err) {
    failures.push('flow: ' + (err && err.message));
    console.error(err);
    await shots('ERROR', [H, ...phones]).catch(() => {});
  } finally {
    await stopDrivers(drivers).catch(() => {});
    check(pageErrors.length === 0, 'no console errors or page errors on any page', pageErrors.slice(0, 12));
    await browser.close();
  }
  console.log(failures.length ? `\nFAILED (${failures.length}), ${passed} ok:\n - ${failures.join('\n - ')}` : `\nALL OK (${passed} checks), screenshots in ${OUT}`);
  process.exit(failures.length ? 1 : 0);
})();
