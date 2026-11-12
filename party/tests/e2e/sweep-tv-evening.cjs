// sweep-tv-evening: the TV page through a whole party evening, as it will really go.
//
// A 30-player room: 25 load bots + 2 scripted phones (sockets with planned scores that test the
// "who reached it first" rule on the TV) + 3 REAL phone pages that join through the name and
// dressing room and tap during play. All five games TWICE (two competitions) at the real
// timings, cutscenes on (the automatic ones, plus a joker fired by hand in each half). The
// owner's phone remote is attached and runs competition 1 (its big button), then it is closed
// and competition 2 runs from the TV keyboard.
//
// Every minute: JS heap (after a forced GC), DOM nodes (document + detached), listeners, timers.
// Every race: frame time of the live scoreboard at 1x and under a 4x CPU slowdown.
// Every round: the music slot that is audible (per game, the lobby, victory, final), the winner
// ceremony and the standings banner against the server's result, the podium against the
// server's ranks, readability (names / numbers under 28 px of a 1080p screen), console errors.
//
//   SWEEP_TREE=<temp tree> VIEWPORT=1920x1080 node tests/e2e/sweep-tv-evening.cjs
//   (EVENING_DURATION_MS=20000 shortens every game for a quick try; the default is the real length)
// Starts its own server (:8961) on the temp tree's build (sweep-tv-lib.cjs). Outputs:
// tests/e2e/out/sweep-tv-/evening-<W>x<H>/ (report.json, shots, run log).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { io } = require('socket.io-client');
const L = require('./sweep-tv-lib.cjs');
const D = require('./dress-lib.cjs');
const jsQR = require(path.join(L.ROOT, 'tools/qr/node_modules/jsqr'));

const [W, H] = (process.env.VIEWPORT || '1920x1080').split('x').map(Number);
const TAG = `${W}x${H}`;
const OUT = L.outDir(`evening-${process.env.EVENING_OUT || TAG}`);
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { force: true, recursive: true });
const DURATION = process.env.EVENING_DURATION_MS || '';
const GAMES = ['tap', 'icy', 'flappy', 'plotzel', 'ninja'];
const VOL = { lobby: 0.4, game: 0.6, intro: 0.3 };
const BOTS = 25;
const PHONE_NAMES = ['דנה', 'Yossi', 'מיכל'];
const PROBE_NAMES = ['עדי', 'נועה'];
const { check, failures, passed } = L.checker();
const errors = [];
const report = { tag: TAG, startedAt: L.stamp(), tree: L.TREE, samples: [], frames: [], scans: [], rounds: [], finals: [], music: [], cutscenes: [], notes: [] };
let shotN = 0;

// ───────────────────────── page instrumentation ─────────────────────────

/** Live timers of the page (installed before the app runs). */
const COUNTERS = () => {
  const live = new Set();
  const liveT = new Set();
  const si = window.setInterval.bind(window);
  const ci = window.clearInterval.bind(window);
  const st = window.setTimeout.bind(window);
  const ct = window.clearTimeout.bind(window);
  window.setInterval = (fn, ms, ...a) => {
    const id = si(fn, ms, ...a);
    live.add(id);
    return id;
  };
  window.clearInterval = (id) => {
    live.delete(id);
    ci(id);
  };
  window.setTimeout = (fn, ms, ...a) => {
    const id = st(
      (...b) => {
        liveT.delete(id);
        if (typeof fn === 'function') fn(...b);
      },
      ms,
      ...a,
    );
    liveT.add(id);
    return id;
  };
  window.clearTimeout = (id) => {
    liveT.delete(id);
    ct(id);
  };
  window.__timers = () => ({ intervals: live.size, timeouts: liveT.size });
};

/** Every 250 ms: which songs are audible, in which phase (read back at the end). */
const MUSIC_SAMPLER = () => {
  window.__aud = [];
  const tick = () => {
    const st = window.__host && window.__host.state();
    const m = window.__partyMusic;
    if (!m) return;
    const aud = m
      .live()
      .filter((x) => x.playing && x.level > 0.02 && !x.stopping && !x.muted)
      .map((x) => `${x.name}:${x.source}:${x.level.toFixed(2)}`);
    window.__aud.push([Date.now(), st ? st.phase : null, st && st.cutscene ? st.cutscene.id : null, st && st.round ? st.round.gameId : null, aud]);
    if (window.__aud.length > 20000) window.__aud.splice(0, 5000);
  };
  // (this one interval is the script's own: COUNTERS counts it)
  window.__audTimer = window.setInterval(tick, 250);
};

const cutInfo = (tv) =>
  tv.evaluate(() => {
    const c = document.querySelector('[data-testid=cutscene]');
    const v = document.querySelector('[data-testid=cutscene-video]');
    return { mode: c ? c.getAttribute('data-mode') : null, vsrc: v ? v.getAttribute('data-src') : null };
  });
const tvState = (tv) => tv.evaluate(() => window.__host.state());
const tvNow = (tv) => tv.evaluate(() => window.__host.now());
const waitTv = (tv, fn, arg, ms = 60000) => tv.waitForFunction(fn, arg, { timeout: ms, polling: 200 });
const ORDER = ['lobby', 'intro', 'countdown', 'playing', 'results', 'final'];
/** Waits until the room is at `phase` or past it (short test phases may be gone before we look). */
const waitAtLeast = (tv, phase, ms = 60000) =>
  tv.waitForFunction(
    ([want, order]) => {
      const s = window.__host.state();
      return order.indexOf(s.phase) >= order.indexOf(want);
    },
    [phase, ORDER],
    { timeout: ms, polling: 200 },
  );
const phaseIs = async (tv, phase) => (await tvState(tv)).phase === phase;

async function shot(page, name, png = false) {
  const file = path.join(OUT, `${String(++shotN).padStart(3, '0')}-${name}.${png ? 'png' : 'jpg'}`);
  try {
    const buf = await page.screenshot(png ? { path: file } : { path: file, type: 'jpeg', quality: 70 });
    return { file, buf };
  } catch (e) {
    report.notes.push(`screenshot ${name} failed: ${e.message}`);
    return { file: null, buf: null };
  }
}

async function scan(tv, scene, round) {
  try {
    const s = await L.textScan(tv, 28);
    report.scans.push({ at: L.stamp(), scene, round, ...s });
    return s;
  } catch (e) {
    report.notes.push(`scan ${scene} failed: ${e.message}`);
    return null;
  }
}

function decodeQr(buf) {
  try {
    const png = PNG.sync.read(buf);
    const hit = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: 'attemptBoth' });
    return hit ? hit.data : null;
  } catch {
    return null;
  }
}

/** The songs audible right now (name → level), from the kit's own registry. */
const audible = (tv) =>
  tv.evaluate(() =>
    window.__partyMusic
      .live()
      .filter((x) => x.playing && x.level > 0.02 && !x.stopping)
      .map((x) => ({ name: x.name, source: x.source, volume: x.volume, level: +x.level.toFixed(2), time: +x.time.toFixed(2), duration: x.duration })),
  );

async function musicCheck(tv, label, want, volume, round) {
  // a fade may still be running: give it a second
  let a = [];
  for (let i = 0; i < 8; i++) {
    a = await audible(tv);
    const names = a.map((x) => x.name).sort();
    if (names.length === (want ? 1 : 0) && (!want || names[0] === want)) break;
    await L.sleep(400);
  }
  const t1 = a.find((x) => x.name === want);
  await L.sleep(1000);
  const b = await audible(tv);
  const t2 = b.find((x) => x.name === want);
  const advancing = t1 && t2 ? t2.time !== t1.time : false;
  const names = b.map((x) => x.name).sort();
  const okSet = want ? names.length === 1 && names[0] === want : names.length === 0;
  const okFile = !want || (t2 && t2.source === 'file');
  const okVol = volume === undefined || (t2 && Math.abs(t2.volume - volume) < 0.02);
  report.music.push({ at: L.stamp(), label, round, want, volume, audible: b, advancing });
  check(okSet && okFile && (want ? advancing : true) && okVol, `${label}: ${want ? `${want} plays (file, ${volume !== undefined ? `level ${volume}, ` : ''}moving)` : 'no song'} and nothing else`, b);
}

// ───────────────────────── the scripted phones (probes) ─────────────────────────

function roundTime(round, now) {
  let t = now;
  let resumeInMs = 0;
  if (round.frozenAt !== null) t = round.frozenAt;
  else if (round.resumeAt !== null && now < round.resumeAt) {
    t = round.resumeAt;
    resumeInMs = round.resumeAt - now;
  }
  return { elapsedMs: t - round.startAt, leftMs: Math.max(0, round.endAt - t), frozen: t !== now, resumeInMs };
}

/**
 * The probes' plan by (competition, game): [probe A, probe B] each { at, score, final? }.
 * at = round time (ms) at which the score is sent; out = elimination: final sent at `at`.
 */
const PROBE_PLAN = {
  '1:tap': [{ at: 3000, score: 300 }, { at: 1000, score: 300 }], // same raw: B reached it first → B wins
  '1:icy': [{ at: 5000, score: 900 }, { at: 6000, score: 700 }],
  '1:flappy': [{ at: 3000, score: 20, out: true }, { at: 3200, score: 22, out: true }],
  '1:plotzel': [{ at: 9000, score: 400, out: true }, null],
  '1:ninja': [{ at: 2000, score: 20000 }, { at: 2600, score: 20000 }], // same raw: A first → A wins
  '2:tap': [null, null],
  '2:icy': [{ at: 2000, score: 50 }, { at: 4000, score: 100000 }], // B: the cap → B wins
  '2:flappy': [{ at: 2800, score: 18, out: true }, { at: 2900, score: 19, out: true }],
  '2:plotzel': [{ at: 5000, score: 30000, out: true }, { at: 7000, score: 30000, out: true }], // both the cap, A first
  '2:ninja': [{ at: 3000, score: 2 }, { at: 3000, score: 1 }],
};
const PROBE_WINNER = { '1:tap': 1, '1:ninja': 0, '2:icy': 1, '2:plotzel': 0 };

async function makeProbe(code, name) {
  const s = io(L.SERVER, { transports: ['websocket'], forceNew: true, reconnectionDelay: 200, reconnectionDelayMax: 1000 });
  await new Promise((res, rej) => {
    s.once('connect', res);
    s.once('connect_error', rej);
  });
  let offset = 0;
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await new Promise((res) => s.emit('time:ping', t0, res));
    const rtt = Date.now() - t0;
    if (rtt < best) {
      best = rtt;
      offset = r.serverNow + rtt / 2 - Date.now();
    }
  }
  const p = { name, s, offset, state: null, id: null, secret: null, comp: 1, sent: new Map() };
  const join = async () => {
    const ack = await new Promise((res) => s.emit('player:join', { code, name, playerId: p.id || undefined, secret: p.secret || undefined }, res));
    if (!ack.ok) throw new Error('probe join failed ' + JSON.stringify(ack));
    p.id = ack.playerId;
    p.secret = ack.secret;
    p.state = ack.state;
  };
  await join();
  s.on('state', (st) => (p.state = st));
  s.on('connect', () => void join().catch(() => undefined));
  return p;
}

function startProbes(probes, compRef) {
  return setInterval(() => {
    probes.forEach((p, k) => {
      const st = p.state;
      if (!st || st.phase !== 'playing' || !st.round || st.cutscene) return;
      const r = st.round;
      const now = Date.now() + p.offset;
      const rt = roundTime(r, now);
      const plan = (PROBE_PLAN[`${compRef.comp}:${r.gameId}`] || [])[k] || null;
      let rec = p.sent.get(r.index);
      if (!rec) {
        rec = { last: 0, final: false };
        p.sent.set(r.index, rec);
      }
      if (rec.final) return;
      if (plan && !rt.frozen && rt.elapsedMs >= plan.at && rec.last !== plan.score) {
        rec.last = plan.score;
        if (plan.out) {
          rec.final = true;
          p.s.emit('player:final', { round: r.index, score: plan.score }, () => undefined);
          return;
        }
        p.s.emit('player:score', { round: r.index, score: plan.score });
      }
      if (rt.leftMs <= 0 && !rt.frozen) {
        rec.final = true;
        p.s.emit('player:final', { round: r.index, score: rec.last }, () => undefined);
      }
    });
  }, 250);
}

// ───────────────────────── the remote ─────────────────────────

async function openRemote(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const r = await ctx.newPage();
  L.watchErrors(r, 'remote', errors);
  await r.goto(`${L.SERVER}/remote`);
  await r.waitForSelector('[data-testid=unlock]', { timeout: 30000 });
  await r.fill('[data-testid=unlock-input]', L.PW);
  await r.click('[data-testid=unlock-go]');
  await r.waitForSelector('[data-testid=main]', { timeout: 30000 });
  await r.waitForFunction(() => window.__remote && window.__remote.tv() === 'online' && !!window.__remote.model(), null, { timeout: 30000 });
  return { ctx, r };
}

async function remoteBig(r, expectAction) {
  await r.waitForFunction(
    (want) => {
      const b = document.querySelector('[data-testid=big]');
      return b && !b.disabled && (!want || b.getAttribute('data-action') === want);
    },
    expectAction || null,
    { timeout: 30000 },
  );
  await L.sleep(300);
  await r.click('[data-testid=big]');
  await L.sleep(500);
  if (await r.locator('[data-testid=confirm]').isVisible().catch(() => false)) {
    await L.sleep(400);
    const yes = r.locator('[data-testid=confirm-yes]');
    await yes.click();
    await L.sleep(450);
    if (await yes.isVisible().catch(() => false)) await yes.click();
    await r.waitForSelector('[data-testid=confirm]', { state: 'detached', timeout: 5000 }).catch(() => undefined);
  }
}

// ───────────────────────── the run ─────────────────────────

(async () => {
  await L.startServer({ ...(DURATION ? { PARTY_TEST_DURATION_MS: DURATION } : {}), ...(process.env.EVENING_FAST === '1' ? { PARTY_TEST_FAST: '1' } : {}) });
  const browser = await chromium.launch();
  let bots = null;
  let probeTimer = null;
  let phoneLoop = null;
  let sampler = null;
  const probes = [];
  const phones = [];
  const compRef = { comp: 1 };
  let remote = null;
  try {
    // ── the TV ──
    const tvCtx = await browser.newContext({ viewport: { width: W, height: H } });
    await tvCtx.addInitScript(COUNTERS);
    const tv = await tvCtx.newPage();
    L.watchErrors(tv, 'tv', errors);
    await tv.goto(`${L.SERVER}/host`);
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 60000 });
    const code = await tv.evaluate(() => window.__host.state().code);
    console.log(L.stamp(), `TV ${TAG} room ${code}`);
    await tv.mouse.click(W / 2, 6); // the one click that allows sound
    await tv.evaluate(MUSIC_SAMPLER);
    const cdp = await tvCtx.newCDPSession(tv);
    await cdp.send('Performance.enable');
    const t0 = Date.now();
    const takeSample = async (label) => {
      try {
        await cdp.send('HeapProfiler.collectGarbage');
        const heap = await cdp.send('Runtime.getHeapUsage');
        const dom = await cdp.send('Memory.getDOMCounters');
        const s = await L.sample(tv);
        const timers = await tv.evaluate(() => (window.__timers ? window.__timers() : null));
        const st = await tvState(tv);
        const row = {
          min: +((Date.now() - t0) / 60000).toFixed(1),
          at: L.stamp(),
          label,
          comp: compRef.comp,
          phase: st.phase,
          game: st.round ? st.round.gameId : null,
          heapMB: +(heap.usedSize / 1048576).toFixed(2),
          docNodes: s.nodes,
          allNodes: dom.nodes,
          documents: dom.documents,
          listeners: dom.jsEventListeners,
          ...timers,
          media: s.media,
          imgs: s.imgs,
          blobImgs: s.blobImgs,
          tracks: s.music ? s.music.live : null,
        };
        report.samples.push(row);
        console.log(L.stamp(), '   sample', JSON.stringify(row));
      } catch (e) {
        report.notes.push(`sample failed: ${e.message}`);
      }
    };
    await takeSample('empty lobby');
    await musicCheck(tv, 'empty lobby', 'lobby', VOL.lobby, null);

    // the sound check panel finds every slot (two of them are .ogg)
    await tv.click('[data-testid=btn-more]');
    await tv.click('[data-testid=btn-sound-check]');
    await tv.waitForSelector('[data-testid=sound-check]', { timeout: 5000 });
    const found = await tv.$$eval('[data-testid^=sc-]', (els) => els.filter((e) => e.hasAttribute('data-found')).map((e) => [e.getAttribute('data-testid').slice(3), e.getAttribute('data-found')]));
    await shot(tv, 'sound-check');
    check(found.length === 9 && found.every(([, f]) => f === 'yes'), 'sound check: all 9 song slots found (.mp3 and .ogg)', found);
    await tv.keyboard.press('Escape');
    await L.sleep(500);

    // ── the room fills: 3 real phones (name + dressing room), 2 probes, 25 bots ──
    for (const name of PHONE_NAMES) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      page.__name = name;
      L.watchErrors(page, `phone ${name}`, errors);
      await page.goto(D.withDressing(`${L.SERVER}/?room=${code}`));
      await page.waitForSelector('.pp-name-input', { timeout: 30000 });
      await page.fill('.pp-name-input', name);
      await page.locator('.pp-btn-go').tap();
      await D.passDressing(page, { taps: 2, timeout: 40000 }).catch((e) => report.notes.push(`dressing ${name}: ${e.message}`));
      phones.push({ name, page });
    }
    for (const n of PROBE_NAMES) probes.push(await makeProbe(code, n));
    probeTimer = startProbes(probes, compRef);
    bots = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', L.SERVER, '--code', code, '--players', String(BOTS), '--play', '--churn', '0.01', '--quiet'], {
      cwd: L.TREE,
      stdio: 'ignore',
      detached: true,
    });
    await waitTv(tv, (n) => window.__host.state().players.length >= n, 30, 90000);
    const dollsT0 = Date.now();
    const drawn = await tv
      .waitForFunction(() => [...document.querySelectorAll('.hs-chip-av')].length >= 30 && [...document.querySelectorAll('.hs-chip-av')].every((el) => el.getAttribute('data-drawn') === '1'), null, { timeout: 60000, polling: 100 })
      .then(() => true)
      .catch(() => false);
    check(drawn, `lobby: the 30 guests' dolls are drawn (${Date.now() - dollsT0} ms after the 30th joined, warm)`);
    await L.sleep(1500);
    const lobbyShot = await shot(tv, 'lobby-30', true);
    const qr0 = decodeQr(lobbyShot.buf);
    check(qr0 !== null && qr0.endsWith(`/?room=${code}`), 'lobby with 30 guests: the QR decodes to the room', qr0);
    await scan(tv, 'lobby-first', 0);
    await takeSample('lobby 30');

    // phones tap while their round is on
    let tapping = true;
    phoneLoop = (async () => {
      while (tapping) {
        await Promise.all(
          phones.map(async (ph, i) => {
            const info = await ph.page.evaluate(() => (window.__player ? { screen: window.__player.screen, cut: window.__player.cutscene } : null)).catch(() => null);
            if (!info || info.screen !== 'playing' || info.cut) return;
            const x = 120 + ((i * 97 + Date.now() / 7) % 150);
            await ph.page.touchscreen.tap(x, 430 + (i % 2) * 120).catch(() => undefined);
          }),
        );
        await L.sleep(320);
      }
    })();

    // every minute
    let nextSample = Date.now() + 60_000;
    let sampling = false;
    sampler = setInterval(() => {
      if (sampling || Date.now() < nextSample) return;
      sampling = true;
      nextSample += 60_000;
      void takeSample('minute').finally(() => (sampling = false));
    }, 1000);

    // ── the remote joins (competition 1) ──
    remote = await openRemote(browser);
    await waitTv(tv, () => window.__host.state().remotes === 1, null, 20000);
    await L.sleep(800);
    const disp = await tv.evaluate(() => ({ root: document.querySelector('.hs-root').className, strip: document.querySelector('[data-testid=strip]').className }));
    check(/is-display/.test(disp.root) && /is-gone/.test(disp.strip), 'remote attached: the TV is a display (strip hidden)', disp);
    await shot(tv, 'lobby-remote-attached');

    const press = async (what) => {
      // what: 'next' | 'continue' | 'podium' | 'reset'
      if (remote) {
        await remoteBig(remote.r, what === 'reset' ? 'reset' : what);
        return;
      }
      // the TV: Space for the next step (the key guard is 1.5 s after a screen change)
      await L.sleep(1800);
      if (what === 'reset') {
        await tv.keyboard.press('Enter');
        await tv.waitForSelector('.hs-confirm, [role=dialog]', { timeout: 5000 }).catch(() => undefined);
        await L.sleep(900);
        await tv.keyboard.press('Enter');
        return;
      }
      await tv.keyboard.press('Space');
    };

    for (const comp of [1, 2]) {
      compRef.comp = comp;
      for (const game of GAMES) {
        const label = `c${comp}-${game}`;
        const rec = { comp, game, label };
        report.rounds.push(rec);
        console.log(L.stamp(), `── competition ${comp}: ${game} (${remote ? 'remote' : 'TV keys'}) ──`);
        try {
          const before = await tvState(tv);
          await press('next');
          await waitTv(tv, (prev) => {
            const s = window.__host.state();
            return s.round !== null && s.round.index !== prev;
          }, before.round ? before.round.index : (before.results ? before.results.roundIndex : -1), 20000);
          let st = await tvState(tv);
          check(st.round.gameId === game, `${label}: the next game is ${game}`, st.round.gameId);
          // a cutscene before the instructions (ninja)
          if (st.cutscene) {
            const { mode } = await cutInfo(tv);
            report.cutscenes.push({ at: L.stamp(), id: st.cutscene.id, phase: st.phase, round: label, mode });
            await L.sleep(1200);
            await musicCheck(tv, `${label} cutscene ${st.cutscene.id} (before the game)`, null, undefined, label);
            await shot(tv, `${label}-cutscene-${st.cutscene.id}-${mode}`);
            await waitTv(tv, () => window.__host.state().cutscene === null, null, 60000);
          }
          await waitAtLeast(tv, 'intro', 20000);
          await L.sleep(1500);
          if (await phaseIs(tv, 'intro')) {
            await musicCheck(tv, `${label} intro`, game, VOL.intro, label);
            await scan(tv, 'intro', label);
            if (comp === 1) await shot(tv, `${label}-intro`);
          }
          await waitAtLeast(tv, 'countdown', 30000);
          await L.sleep(800);
          if (await phaseIs(tv, 'countdown')) {
            await scan(tv, 'countdown', label);
            if (comp === 1) await shot(tv, `${label}-countdown`);
          }
          await waitAtLeast(tv, 'playing', 20000);
          await L.sleep(2500);
          st = await tvState(tv);
          if (!st.cutscene && st.phase === 'playing') await musicCheck(tv, `${label} playing`, game, VOL.game, label);

          // the cutscenes of this round: tap_freeze (auto), joker_1 from the remote (c1 icy), joker_2 from the TV (c2 plotzel)
          const handleCut = async (why) => {
            const s0 = await tvState(tv);
            const id = s0.cutscene.id;
            const frozen = s0.round && s0.round.frozenAt !== null;
            const leftAt = s0.round ? roundTime(s0.round, s0.round.frozenAt).leftMs : null;
            await L.sleep(700);
            const aud = await audible(tv);
            const { mode, vsrc } = await cutInfo(tv);
            const tp = Date.now();
            const phonesFrozen = await Promise.all(
              phones.map((p) => Promise.race([p.page.evaluate(() => window.__player && window.__player.cutscene).catch(() => null), L.sleep(5000).then(() => 'slow')])),
            );
            if (Date.now() - tp > 2000) report.notes.push(`${label}: reading the phones during ${id} took ${Date.now() - tp} ms`);
            await shot(tv, `${label}-cut-${id}`);
            check(frozen, `${label}: cutscene ${id} (${why}) freezes the round clock`, s0.round);
            check(phonesFrozen.every((x) => x === true), `${label}: every real phone shows "watch the TV" during ${id}`, phonesFrozen);
            check(aud.length === 0, `${label}: the game song pauses during ${id}`, aud);
            const t1 = Date.now();
            await waitTv(tv, () => window.__host.state().cutscene === null, null, 95000);
            const s1 = await tvState(tv);
            const atResume = s1.round && s1.round.resumeAt !== null ? roundTime(s1.round, s1.round.resumeAt).leftMs : null;
            check(atResume === leftAt, `${label}: after ${id} the round continues with the same time left (${leftAt} ms)`, { leftAt, atResume, phase: s1.phase });
            report.cutscenes.push({ at: L.stamp(), id, why, mode, vsrc, round: label, playedMs: Date.now() - t1 + 700 });
            if (s1.round && s1.round.resumeAt !== null) {
              await tv.waitForFunction(() => {
                const s = window.__host.state();
                return !s.round || s.round.resumeAt === null || window.__host.now() > s.round.resumeAt + 1200;
              }, null, { timeout: 15000 }).catch(() => undefined);
              if ((await tvState(tv)).phase === 'playing') await musicCheck(tv, `${label} after ${id}`, game, VOL.game, label);
            }
          };

          if (game === 'tap') {
            // tap_freeze at 8 s of round time (scaled when rounds are shortened)
            const cut = await waitTv(tv, () => !!window.__host.state().cutscene, null, 20000).then(() => true).catch(() => false);
            check(cut, `${label}: the automatic tap_freeze cutscene fires`);
            if (cut) await handleCut('auto during tap');
          }
          // the race: frame time with 30 guests' cards, 1x and 4x CPU
          await L.sleep(1500);
          const playingNow = (await tvState(tv)).phase === 'playing';
          if (playingNow) {
            const rows = await tv.evaluate(() => document.querySelectorAll('[data-testid=race-card]').length);
            const f1 = await L.frames(tv, 4000);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
            const f4 = await L.frames(tv, 4000);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
            report.frames.push({ round: label, rows, x1: f1, x4: f4 });
            console.log(L.stamp(), `   race ${label} rows=${rows}  1x: ${f1.fps} fps p50 ${f1.p50} p95 ${f1.p95} worst ${f1.worst} long ${f1.long} | 4x: ${f4.fps} fps p50 ${f4.p50} p95 ${f4.p95} worst ${f4.worst} long ${f4.long}`);
            await scan(tv, 'playing', label);
            await shot(tv, `${label}-race`);
          }
          if (comp === 1 && game === 'icy' && remote && (await tvState(tv)).phase === 'playing') {
            await remote.r.click('[data-testid=tray-cutscenes]');
            await remote.r.waitForSelector('[data-testid=cut-joker_1]', { timeout: 5000 });
            await remote.r.click('[data-testid=cut-joker_1]');
            const cut = await waitTv(tv, () => window.__host.state().cutscene && window.__host.state().cutscene.id === 'joker_1', null, 10000).then(() => true).catch(() => false);
            check(cut, `${label}: joker_1 fired from the remote plays on the TV`);
            if (cut) await handleCut('remote joker');
          }
          if (comp === 2 && game === 'plotzel' && (await tvState(tv)).phase === 'playing') {
            await L.sleep(1800);
            await tv.keyboard.press('KeyC');
            await tv.waitForSelector('[data-testid=cutscene-menu]', { timeout: 5000 });
            await tv.click('[data-testid=cm-joker_2] button');
            const cut = await waitTv(tv, () => window.__host.state().cutscene && window.__host.state().cutscene.id === 'joker_2', null, 10000).then(() => true).catch(() => false);
            check(cut, `${label}: joker_2 fired from the TV's cutscene menu plays`);
            if (cut) await handleCut('TV joker');
          }

          // ── results ──
          await waitTv(tv, () => window.__host.state().phase === 'results' && window.__host.state().results !== null, null, 200000);
          st = await tvState(tv);
          const res = st.results;
          rec.results = res.rows.map((r) => ({ name: r.name, raw: r.raw, points: r.points, roundRank: r.roundRank, total: r.total, rank: r.rank, reachedAt: r.reachedAt }));
          const scorers = res.rows.filter((r) => r.raw > 0);
          const first = res.rows.find((r) => r.roundRank === 1);
          const expectWinner = scorers.length > 0 ? first : null;
          rec.winner = expectWinner ? expectWinner.name : null;
          check(
            (expectWinner === null && res.winnerIds.length === 0) || (expectWinner !== null && res.winnerIds.length === 1 && res.winnerIds[0] === expectWinner.playerId),
            `${label}: the server names exactly one winner, roundRank 1 (${rec.winner})`,
            res.winnerIds,
          );
          const pts = scorers.map((r) => r.points);
          check(new Set(pts).size === pts.length, `${label}: no two scorers share round points`, pts.slice(0, 10));
          const totals = st.players.map((p) => p.total).filter((t) => t > 0);
          check(new Set(totals).size === totals.length, `${label}: no two players share a total`);
          const ranks = st.players.map((p) => p.rank).sort((a, b) => a - b);
          check(ranks.every((r, i) => r === i + 1), `${label}: overall ranks are 1..${st.players.length}`);
          const planned = PROBE_WINNER[`${comp}:${game}`];
          if (planned !== undefined) {
            check(rec.winner === PROBE_NAMES[planned], `${label}: the planned winner wins (${PROBE_NAMES[planned]}: same score, reached first / the cap)`, { winner: rec.winner, rows: rec.results.slice(0, 4) });
          }
          // ceremony
          const reveal = res.revealAt;
          const now0 = await tvNow(tv);
          await L.sleep(Math.max(0, reveal - now0 + 1800));
          await scan(tv, 'results-suspense-end', label);
          if (expectWinner) {
            const cer = await tv.waitForSelector('.sh-cer-name', { timeout: 15000 }).then(() => true).catch(() => false);
            const cerName = cer ? (await tv.textContent('.sh-cer-name')).trim() : null;
            rec.ceremonyName = cerName;
            check(cerName === expectWinner.name, `${label}: the winner ceremony names ${expectWinner.name}`, cerName);
            const v = await tv.evaluate(() => window.__partyMusic.info('victory'));
            check(v && v.source === 'file' && v.playing, `${label}: victory.mp3 plays at the reveal`, v);
            await L.sleep(1200);
            await scan(tv, 'ceremony', label);
            await shot(tv, `${label}-ceremony`);
          } else {
            const nobody = await tv.waitForSelector('.sh-cer--nobody', { timeout: 15000 }).then(() => true).catch(() => false);
            check(nobody, `${label}: nobody scored → "nobody won" card`);
            await shot(tv, `${label}-nobody`);
          }
          // standings
          const standAt = reveal + (expectWinner ? 10600 : 6000);
          await L.sleep(Math.max(0, standAt - (await tvNow(tv)) + 2500));
          const banner = await tv.textContent('.sh-banner-text').catch(() => null);
          rec.banner = banner;
          if (expectWinner) check(banner !== null && banner.includes(expectWinner.name), `${label}: the standings banner names ${expectWinner.name}`, banner);
          await scan(tv, 'standings', label);
          await shot(tv, `${label}-standings`);
          await L.sleep(5500);
          await scan(tv, 'standings-rest', label);
          // live board's last order = round order? (the results rows are by overall rank)
          const isLast = game === 'ninja';
          if (!isLast) {
            await press('continue');
            await waitTv(tv, () => window.__host.state().phase === 'lobby', null, 20000);
            await L.sleep(2200);
            await musicCheck(tv, `${label} → lobby`, 'lobby', VOL.lobby, label);
            const ls = await shot(tv, `${label}-lobby-between`, true);
            const q = decodeQr(ls.buf);
            check(q !== null && q.endsWith(`/?room=${code}`), `${label} → lobby: the compact QR still decodes`, q);
            await scan(tv, 'lobby-between', label);
          }
        } catch (e) {
          check(false, `${label}: round flow`, String(e && e.message));
          await shot(tv, `${label}-ERROR`);
          // get back to a known place: end the round / go to the lobby from the TV's own keys
          rec.error = String(e && e.message);
        }
      }

      // ── the podium ──
      const label = `c${comp}-podium`;
      try {
        await press('podium');
        await waitTv(tv, () => window.__host.state().phase === 'final' || !!window.__host.state().cutscene, null, 20000);
        let st = await tvState(tv);
        if (st.cutscene) {
          const id = st.cutscene.id;
          const mode = await tv.evaluate(() => {
            const c = document.querySelector('[data-testid=cutscene]');
            return c ? c.getAttribute('data-mode') : null;
          });
          report.cutscenes.push({ at: L.stamp(), id, phase: st.phase, round: label, mode });
          await L.sleep(1200);
          await shot(tv, `${label}-cutscene-${id}-${mode}`);
          check(id === 'before_podium', `${label}: before_podium plays before the podium`, id);
          await waitTv(tv, () => window.__host.state().cutscene === null, null, 95000);
        }
        await waitTv(tv, () => window.__host.state().phase === 'final', null, 20000);
        st = await tvState(tv);
        const byRank = [...st.players].sort((a, b) => a.rank - b.rank);
        const tot = byRank.map((p) => p.total);
        check(tot.every((t, i) => i === 0 || t <= tot[i - 1]), `${label}: the server's ranks follow the totals`, tot.slice(0, 6));
        await L.sleep(9000);
        const pod = await tv.evaluate(() => {
          const t = (sel) => {
            const e = document.querySelector(sel);
            return e ? e.textContent.trim() : null;
          };
          return { p1: t('.sh-pod--1 .sh-pod-name'), p2: t('.sh-pod--2 .sh-pod-name'), p3: t('.sh-pod--3 .sh-pod-name'), champ: t('.sh-champ-name'), t1: t('.sh-pod--1 .sh-pod-total') };
        });
        const want = { p1: byRank[0].name, p2: byRank[1].name, p3: byRank[2].name };
        report.finals.push({ comp, at: L.stamp(), pod, want, top: byRank.slice(0, 5).map((p) => ({ name: p.name, total: p.total, rank: p.rank })) });
        check(pod.p1 === want.p1 && pod.p2 === want.p2 && pod.p3 === want.p3, `${label}: the podium shows 1 ${want.p1}, 2 ${want.p2}, 3 ${want.p3}`, pod);
        check(pod.champ !== null && pod.champ.includes(want.p1), `${label}: the champion banner names ${want.p1}`, pod.champ);
        const f = await tv.evaluate(() => window.__partyMusic.info('final'));
        check(f && f.source === 'file' && f.playing, `${label}: final.ogg plays for the champion`, f);
        const aud = await audible(tv);
        check(aud.every((a) => a.name === 'final'), `${label}: only the champion song is audible`, aud);
        await scan(tv, 'podium', label);
        await shot(tv, `${label}-podium`);
        await L.sleep(6500);
        await scan(tv, 'final-table', label);
        await shot(tv, `${label}-table`);
        await takeSample('podium');
      } catch (e) {
        check(false, `${label}: podium flow`, String(e && e.message));
        await shot(tv, `${label}-ERROR`);
      }

      if (comp === 1) {
        // a new competition from the remote, then the remote goes away (pocket, battery)
        try {
          await press('reset');
          await waitTv(tv, () => window.__host.state().phase === 'lobby' && window.__host.state().played.length === 0, null, 20000);
          check(true, 'remote: "תחרות חדשה" resets the competition');
          await L.sleep(2000);
          await musicCheck(tv, 'new competition lobby', 'lobby', VOL.lobby, 'c2');
          await remote.ctx.close();
          remote = null;
          await waitTv(tv, () => window.__host.state().remotes === 0, null, 30000);
          await L.sleep(1500);
          await tv.mouse.move(W / 2, H / 2);
          await L.sleep(300);
          const d2 = await tv.evaluate(() => ({ root: document.querySelector('.hs-root').className, strip: document.querySelector('[data-testid=strip]').className, primary: !!document.querySelector('[data-testid=btn-primary]') }));
          check(!/is-display/.test(d2.root) && !/is-gone/.test(d2.strip) && d2.primary, 'remote closed: the TV shows its own controls again', d2);
          await shot(tv, 'c2-lobby-remote-gone');
          await takeSample('remote detached');
        } catch (e) {
          check(false, 'reset + detach the remote', String(e && e.message));
        }
      }
    }

    // the evening's leftovers: the final podium stays on; let it sit a minute (the TV is left on)
    await L.sleep(60_000);
    await takeSample('end');
    tapping = false;
    await phoneLoop;
    clearInterval(sampler);
    report.audTimeline = await tv.evaluate(() => window.__aud).catch(() => []);
  } catch (e) {
    console.error(e);
    check(false, 'run', String(e && e.stack));
  } finally {
    if (probeTimer) clearInterval(probeTimer);
    if (sampler) clearInterval(sampler);
    for (const p of probes) p.s.close();
    if (bots) {
      try {
        process.kill(-bots.pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    await browser.close().catch(() => undefined);
    L.stopAll();
  }

  // ── trends ──
  const minutes = report.samples.filter((s) => s.label === 'minute' || s.label === 'end' || s.label === 'podium');
  const slope = (key) => {
    const pts = minutes.filter((s) => s[key] !== undefined && s[key] !== null).map((s) => [s.min, s[key]]);
    if (pts.length < 3) return null;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p[0], 0) / n;
    const my = pts.reduce((a, p) => a + p[1], 0) / n;
    const num = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
    const den = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
    return den === 0 ? 0 : +(num / den).toFixed(3);
  };
  report.trend = { heapMBPerMin: slope('heapMB'), allNodesPerMin: slope('allNodes'), docNodesPerMin: slope('docNodes'), listenersPerMin: slope('listeners'), intervalsPerMin: slope('intervals'), timeoutsPerMin: slope('timeouts') };
  const lobbies = report.samples.filter((s) => s.phase === 'lobby');
  report.lobbyCompare = lobbies.length >= 2 ? { first: lobbies[1] || lobbies[0], last: lobbies[lobbies.length - 1] } : null;
  report.errors = errors;
  report.failures = failures;
  report.passed = passed.length;
  report.endedAt = L.stamp();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(L.stamp(), 'trend', JSON.stringify(report.trend));
  const bad = errors.filter((e) => e.kind !== 'warning');
  console.log(L.stamp(), `errors: ${bad.length} (warnings ${errors.length - bad.length})`, JSON.stringify(bad.slice(0, 12)));
  console.log(failures.length === 0 ? `sweep-tv-evening ${TAG}: ALL OK (${passed.length} checks)` : `sweep-tv-evening ${TAG}: ${failures.length} FAILED, ${passed.length} ok`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
