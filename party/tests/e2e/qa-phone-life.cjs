// Phone QA: what a real party does to a phone. Lock / app switch (visibility hidden +
// page frozen) for 5 s, 30 s and 3 min at every moment of a round, network drops,
// a phone clock that is 3 h 7 s off, reloads, a server restart, sound while hidden.
//
// This script starts (and restarts) its OWN game server on PARTY_SERVER_PORT (8812),
// so stop any other server on that port first. It serves a PRODUCTION build (the vite
// dev client reloads the page when its own HMR socket drops, which a lock test hits):
//   npx vite build --outDir /some/scratch/dist-client --emptyOutDir
//   QA_CLIENT_DIR=/some/scratch/dist-client node tests/e2e/qa-phone-life.cjs
// (about 10 minutes; QUICK=1 skips the 3-minute lock)
//
// Screenshots: tests/e2e/out/qa-phone/life/
const { spawn } = require('child_process');
const path = require('path');

const PORT_ = process.env.PARTY_SERVER_PORT || '8812';
process.env.CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT_}`;
if (!process.env.QA_CLIENT_DIR) {
  console.error('set QA_CLIENT_DIR to a production build of the client (see the header)');
  process.exit(2);
}
const L = require('./qa-phone-lib.cjs');

const OUT = path.join(L.OUT_ROOT, 'life');
const { check, done } = L.makeChecker('life');
const PORT = process.env.PARTY_SERVER_PORT || '8812';
const GAME_MS = 40_000;
const SKEW_MS = 3 * 3600_000 + 7_000;

// Fake visibility (a lock / app switch), a controllable phone clock, and an audio log.
const INIT = `(() => {
  let vis = 'visible';
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => vis });
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => vis === 'hidden' });
  window.__setVis = (v) => { vis = v; document.dispatchEvent(new Event('visibilitychange')); };
  const realNow = Date.now.bind(Date);
  window.__skew = Number(localStorage.getItem('qa.skew') || 0);
  Date.now = () => realNow() + window.__skew;
  window.__audioLog = [];
  const AC = window.AudioContext;
  if (AC) {
    for (const m of ['suspend', 'resume']) {
      const orig = AC.prototype[m];
      AC.prototype[m] = function () { window.__audioLog.push(m); return orig.apply(this, arguments); };
    }
    const ctor = AC;
    window.AudioContext = function (o) { const c = new ctor(o); window.__audioCtx = c; return c; };
    window.AudioContext.prototype = ctor.prototype;
  }
  if (localStorage.getItem('qa.novibrate') === '1') { try { delete Navigator.prototype.vibrate; } catch (e) {} }
})();`;

let server = null;
function startServer() {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, PARTY_SERVER_PORT: PORT, PARTY_CLIENT_DIR: process.env.QA_CLIENT_DIR, PARTY_TEST_DURATION_MS: String(GAME_MS), PARTY_TEST_FAST: '' },
    stdio: 'ignore',
    detached: true,
  });
  return L.waitFor(async () => {
    try {
      const r = await fetch(`${L.SERVER}/healthz`);
      return r.ok;
    } catch {
      return false;
    }
  }, 20000, 'server up');
}
function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  server = null;
}

async function setVis(page, v) {
  await page.evaluate((x) => window.__setVis(x), v);
}

/** Lock the phone: hidden, then (optionally) offline and frozen; unlock in reverse. Returns ms from unlock until `ok()`. */
async function lock(page, ms, opts, ok, label) {
  const c = await L.cdp(page);
  await setVis(page, 'hidden');
  if (opts.offline) await page.__ctx.setOffline(true);
  if (opts.freeze) await c.send('Page.setWebLifecycleState', { state: 'frozen' });
  if (opts.during) await opts.during();
  await L.sleep(ms - (opts.duringMs || 0));
  if (opts.freeze) await c.send('Page.setWebLifecycleState', { state: 'active' });
  if (opts.offline) await page.__ctx.setOffline(false);
  await setVis(page, 'visible');
  const t0 = Date.now();
  try {
    await L.waitFor(ok, 8000, label);
    return Date.now() - t0;
  } catch {
    return -1;
  }
}

async function play(page) {
  return page.evaluate(() => {
    const p = window.__playerPlay;
    return p ? { score: p.stageScore, reported: p.reported, leftMs: p.leftMs, frozen: p.frozen, round: p.round } : null;
  });
}

async function tapN(page, n) {
  const vp = page.viewportSize();
  for (let i = 0; i < n; i++) await page.touchscreen.tap(vp.width / 2 + ((i * 37) % 60) - 30, vp.height * 0.55);
}

async function hudScore(page) {
  return page.evaluate(() => Number((document.querySelector('.pa-hud-num') || { textContent: '-1' }).textContent.replace(/,/g, '')));
}

/** Server time ≈ this machine's Date.now() (same host). */
function expectedLeft(host) {
  const r = host.state().round;
  return r ? Math.max(0, r.endAt - Date.now()) : 0;
}

(async () => {
  await startServer();
  const browser = await L.launch();
  let host = L.createHost();
  const { code } = await host.call('host:create', {});
  await host.call('host:setAutoCutscenes', { enabled: false });
  console.log('[life] room', code);
  const open = async (name, dev, setup) => {
    const p = await L.openPhone(browser, name, dev, { initScript: INIT }, check);
    if (setup) {
      await p.goto(`${L.CLIENT}/`);
      await p.evaluate(setup);
    }
    return p;
  };
  try {
    const A = await open('A-iphone14', L.PHONES.iphone14);
    const B = await open('B-pixel7', L.PHONES.pixel7);
    const C = await open('C-s8-skewed', L.PHONES.s8, `localStorage.setItem('qa.skew', '${SKEW_MS}')`);
    const D = await open('D-se375', L.PHONES.se375, `localStorage.setItem('qa.novibrate', '1')`);
    const E = await open('E-a360', L.PHONES.a360);
    for (const [p, n] of [[A, 'אלף'], [B, 'בית'], [C, 'גימל'], [D, 'דלת'], [E, 'הא']]) await L.join(p, code, n);
    check((await C.evaluate(() => Date.now() - performance.timeOrigin - performance.now())) > SKEW_MS - 5000, 'C really has a clock 3h7s off');
    check(!(await D.evaluate(() => 'vibrate' in navigator)), 'D has no navigator.vibrate (like an iPhone)');

    // mute persists across a reload
    await D.tap('.pp-mute');
    await D.reload();
    await L.waitScreen(D, 'lobby');
    check((await D.textContent('.pp-mute')) === '🔇', 'mute survives a reload');
    await D.tap('.pp-mute');

    // ───────── round 1 ─────────
    await host.call('host:start', { gameId: 'tap' });
    await L.waitScreen(A, 'countdown', 12000);
    // A locks for 5 s in the middle of the countdown
    const tCd = await lock(A, 5000, { freeze: true }, async () => (await L.screen(A)) === 'playing' && Math.abs((await play(A)).leftMs - expectedLeft(host)) < 400, 'A back in the game');
    check(tCd >= 0 && tCd < 1200, `lock 5s across the countdown → playing with the right clock in ${tCd} ms`);

    // skewed phone C vs reference D: same clock
    const diffs = [];
    for (let i = 0; i < 5; i++) {
      const [c, d] = await Promise.all([play(C), play(D)]);
      if (c && d) diffs.push(Math.abs(c.leftMs - d.leftMs));
      await L.sleep(300);
    }
    check(diffs.length >= 3 && Math.max(...diffs) < 250, `phone clock 3h7s off shows the same time left as a correct phone (diffs ${diffs.join(',')} ms)`);
    const cl = await play(C);
    check(Math.abs(cl.leftMs - expectedLeft(host)) < 300, `skewed phone matches the server clock (${Math.round(cl.leftMs)} vs ${expectedLeft(host)})`);

    await tapN(A, 8);
    await tapN(B, 6);
    await tapN(D, 4);
    // B: a 3 s network drop mid-round, tapping through it
    const bBefore = await hudScore(B);
    await B.__ctx.setOffline(true);
    await tapN(B, 5);
    await L.sleep(3000);
    await B.__ctx.setOffline(false);
    await L.sleep(500);
    const bAfter = await hudScore(B);
    check((await L.screen(B)) === 'playing' && bAfter > bBefore, `3 s offline: still playing, taps while offline count (${bBefore} → ${bAfter})`);
    await L.waitFor(() => host.state().players.find((p) => p.name === 'בית').connected, 5000, 'B connected').catch(() => {});

    // A: lock 5 s mid-round (frozen + offline, like an iPhone)
    const aBefore = await play(A);
    const tMid = await lock(A, 5000, { freeze: true, offline: true }, async () => {
      const s = await play(A);
      return (await L.screen(A)) === 'playing' && s && Math.abs(s.leftMs - expectedLeft(host)) < 400;
    }, 'A mid');
    const aAfter = await play(A);
    check(tMid >= 0 && tMid < 1200, `lock 5s mid-round → right screen + clock in ${tMid} ms`);
    check(aAfter.score >= aBefore.score, `score not lost over the lock (${aBefore.score} → ${aAfter.score})`);

    // E: taps, hides at once (an Android notification / app switch, not frozen) and stays hidden over the round end
    await L.waitFor(() => expectedLeft(host) < 6000, GAME_MS, '6 s left');
    await tapN(E, 7);
    const eScore = await hudScore(E);
    await setVis(E, 'hidden');
    // A: lock 30 s from ~5 s left: the round ends, the results run while it is away
    const aEnd = (await play(A)).score;
    const tEnd = await lock(A, 30000, { freeze: true, offline: true }, async () => ['suspense', 'reveal', 'results', 'win'].includes(await L.screen(A)), 'A after round end');
    check(tEnd >= 0 && tEnd < 1500, `lock 30s across the round end → results screens in ${tEnd} ms (${await L.screen(A)})`);
    await L.shot(A, OUT, '01-back-after-30s-lock', check);
    const res1 = host.state().results;
    const rowA = res1 && res1.rows.find((r) => r.name === 'אלף');
    check(rowA && rowA.raw === aEnd, `A's score before the lock counted (${rowA && rowA.raw} vs ${aEnd})`);
    const rowE = res1 && res1.rows.find((r) => r.name === 'הא');
    check(rowE && rowE.raw === eScore && eScore > 0, `E's taps just before hiding were flushed (${rowE && rowE.raw} vs ${eScore})`);
    const rowC = res1 && res1.rows.find((r) => r.name === 'גימל');
    check(rowC !== undefined, 'skewed phone C is in the results');
    await setVis(E, 'visible');
    await L.waitScreen(E, ['reveal', 'results', 'win'], 3000);
    // sound while hidden
    const aud = await E.evaluate(() => window.__audioLog.slice());
    check(aud.includes('suspend') && aud.lastIndexOf('resume') > aud.indexOf('suspend'), `audio suspended while hidden, resumed after (${aud.join(',')})`);

    // reload mid-results (D): straight back to the right moment
    await D.reload();
    await L.waitScreen(D, ['suspense', 'reveal', 'results', 'win'], 5000);
    check(true, `reload mid-results → ${await L.screen(D)}`);
    await L.waitFor(() => host.state().results && Date.now() > host.state().results.revealAt + 7000, 20000, 'reveal done');
    await host.call('host:lobby', {});
    await Promise.all([A, B, C, D, E].map((p) => L.waitScreen(p, 'lobby', 5000)));

    // ───────── round 2: cutscene, long network drop, reload ─────────
    await host.call('host:start', { gameId: 'tap' });
    await L.waitScreen(A, 'playing', 15000);
    await L.sleep(2500);
    await tapN(A, 5);
    await tapN(B, 5);
    await host.call('host:cutscene', { id: 'joker_1' });
    await L.waitFor(() => A.evaluate(() => window.__player.cutscene), 3000, 'cutscene');
    const aFrozen = await play(A);
    // A: lock 30 s during the cutscene; the TV ends the cutscene 10 s into it
    const tCut = await lock(
      A,
      20000,
      {
        freeze: true,
        offline: true,
        duringMs: 8000,
        during: async () => {
          await L.sleep(8000);
          await host.call('host:cutsceneEnd', {});
        },
      },
      async () => {
        const s = await play(A);
        return (await L.screen(A)) === 'playing' && s && !(await A.evaluate(() => window.__player.cutscene)) && Math.abs(s.leftMs - expectedLeft(host)) < 400;
      },
      'A after cutscene',
    );
    check(tCut >= 0 && tCut < 1500, `lock 20s over a cutscene that ended → playing, right clock in ${tCut} ms (${await L.screen(A)}, ${JSON.stringify(await play(A))}, expected ${expectedLeft(host)})`);
    const aCut = (await play(A)) || { score: -1 };
    check(aCut.score >= aFrozen.score, `score kept over the cutscene lock (${aFrozen.score} → ${aCut.score})`);
    // D: reload mid-round
        await D.reload();
    await L.waitScreen(D, 'playing', 6000);
    await L.sleep(400);
    const dAfter = await play(D);
    check(dAfter && Math.abs(dAfter.leftMs - expectedLeft(host)) < 400, `reload mid-round: right clock (${dAfter && Math.round(dAfter.leftMs)} vs ${expectedLeft(host)})`);
    // B: 20 s network drop mid-round
    await B.__ctx.setOffline(true);
    const tBan = Date.now();
    await L.waitFor(() => B.evaluate(() => window.__player.banner), 20000, 'banner').catch(() => {});
    const banAfter = Date.now() - tBan;
    check(banAfter < 12000, `offline banner within ${banAfter} ms of the drop`);
    await tapN(B, 4);
    await L.shot(B, OUT, '02-offline-banner-in-game', check, { allowSmall: true });
    await L.sleep(Math.max(0, 20000 - banAfter));
    const bScore = await hudScore(B);
    await B.__ctx.setOffline(false);
    const tBack = Date.now();
    await L.waitFor(async () => !(await B.evaluate(() => window.__player.banner)), 15000, 'banner gone').catch(() => {});
    check(Date.now() - tBack < 5000, `back online → banner gone in ${Date.now() - tBack} ms`);
    await L.waitFor(() => host.state().phase === 'results', 30000, 'round 2 results');
    const rowB = host.state().results.rows.find((r) => r.name === 'בית');
    check(rowB && rowB.raw >= bScore && bScore > 0, `B's score after the 20 s drop made it (${rowB && rowB.raw} ≥ ${bScore})`);

    // ───────── 3-minute lock across two phases ─────────
    if (!process.env.QUICK) {
      await L.waitFor(() => Date.now() > host.state().results.revealAt + 7000, 20000, 'reveal 2');
      await host.call('host:lobby', {});
      await L.waitScreen(A, 'lobby', 5000);
      await host.call('host:start', { gameId: 'tap' });
      await L.waitScreen(A, 'intro', 5000);
      // C: its clock jumps another 40 s while it is locked (NTP after a sleep)
      const t3 = await lock(
        A,
        180000,
        {
          freeze: true,
          offline: true,
          duringMs: 60000,
          during: async () => {
            await C.evaluate(() => {
              window.__skew += 40000;
            });
            await setVis(C, 'hidden');
            await L.sleep(1500);
            await setVis(C, 'visible');
            await L.waitFor(() => host.state().phase === 'results', 60000, 'round 3 results');
            await L.waitFor(() => Date.now() > host.state().results.revealAt + 7000, 20000, 'reveal 3');
            await host.call('host:lobby', {});
            await host.call('host:start', { gameId: 'tap' });
            await L.waitScreen(D, 'playing', 15000);
            const [c, d] = await Promise.all([play(C), play(D)]);
            check(c && d && Math.abs(c.leftMs - d.leftMs) < 300, `clock jump of 40 s during a sleep is re-synced on return (${c && Math.round(c.leftMs)} vs ${d && Math.round(d.leftMs)})`);
          },
        },
        async () => {
          const sc = await L.screen(A);
          const st = host.state();
          if (st.phase === 'playing') return sc === 'playing' && Math.abs((await play(A)).leftMs - expectedLeft(host)) < 400;
          if (st.phase === 'results') return ['suspense', 'reveal', 'results', 'win'].includes(sc) && (await A.evaluate(() => window.__player.snap.state.results.roundIndex)) === st.results.roundIndex;
          return sc === st.phase;
        },
        'A after 3 min',
      );
      check(t3 >= 0 && t3 < 2500, `lock 3 min over two whole rounds → the screen of the room's phase now (${host.state().phase} / ${await L.screen(A)}) in ${t3} ms`);
      await L.shot(A, OUT, '03-back-after-3min', check, { allowSmall: true });
    }

    // ───────── server restart: the room is gone ─────────
    host.close();
    stopServer();
    await L.sleep(1500);
    await startServer();
    await L.waitScreen(A, 'closed', 15000);
    await L.waitScreen(E, 'closed', 15000);
    await L.shot(A, OUT, '04-server-restarted', check);
    await A.tap('.pp-btn');
    await L.waitScreen(A, 'join', 3000);
    check((await A.locator('.pp-code-input').count()) === 1, 'after a server restart: a clean code entry');
    host = L.createHost();
    const { code: code2 } = await host.call('host:create', {});
    await A.fill('.pp-code-input', code2);
    await A.fill('.pp-name-input', 'אלף');
    await A.tap('.pp-btn-go');
    await L.waitScreen(A, 'lobby', 6000);
    check(true, 'joined the new room after the restart');
    for (const p of [A, B, C, D, E]) check(p.__errors.length === 0, `${p.__name}: no page errors ${p.__errors.slice(0, 2).join(' | ')}`);
  } catch (err) {
    check(false, 'flow: ' + err.message);
    console.error(err);
  } finally {
    host.close();
    await browser.close();
    stopServer();
  }
  process.exit(done() ? 1 : 0);
})();
