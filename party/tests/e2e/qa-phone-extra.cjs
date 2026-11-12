// Phone QA, second pass: what the first scripts did not cover.
//  - the room code typed by hand on a HEBREW keyboard (Israeli guests), and sloppy typing
//  - launched from the home screen (standalone, no ?room): resume the last room / clean entry
//  - "room closed" → a fresh code field, no stale ?room, a reload stays clean
//  - a link that dies without the browser noticing (server frozen with SIGSTOP: the socket
//    stays open, nothing answers): how fast the "reconnecting" banner shows, and recovery
//  - a real Wi-Fi drop (offline event): banner time
//
// Starts its OWN fast game server on PARTY_SERVER_PORT (8812) serving a production build:
//   npx vite build --outDir /some/scratch/dist-client --emptyOutDir
//   QA_CLIENT_DIR=/some/scratch/dist-client node tests/e2e/qa-phone-extra.cjs
//
// Screenshots: tests/e2e/out/qa-phone/extra/
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PARTY_SERVER_PORT || '8812';
process.env.SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
process.env.CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;
if (!process.env.QA_CLIENT_DIR) {
  console.error('set QA_CLIENT_DIR to a production build of the client (see the header)');
  process.exit(2);
}
const L = require('./qa-phone-lib.cjs');

const OUT = path.join(L.OUT_ROOT, 'extra');
const { check, done } = L.makeChecker('extra');

// Israeli keyboard: the Hebrew letter on each Latin key.
const HEB = { A: 'ש', B: 'נ', C: 'ב', D: 'ג', E: 'ק', F: 'כ', G: 'ע', H: 'י', J: 'ח', K: 'ל', M: 'צ', N: 'מ', P: 'פ', Q: '/', R: 'ר', S: 'ד', T: 'א', U: 'ו', V: 'ה', W: "'", X: 'ס', Y: 'ט', Z: 'ז' };

const STANDALONE = `(() => {
  try { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); } catch {}
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => (/display-mode:\\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q));
})();`;

let server = null;
function startServer() {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, PARTY_SERVER_PORT: PORT, PARTY_CLIENT_DIR: process.env.QA_CLIENT_DIR, PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '30000' },
    stdio: 'ignore',
    detached: true,
  });
  return L.waitFor(async () => {
    try {
      return (await fetch(`${L.SERVER}/healthz`)).ok;
    } catch {
      return false;
    }
  }, 20000, 'server up');
}
function signalServer(sig) {
  try {
    process.kill(-server.pid, sig);
  } catch {}
}

(async () => {
  await startServer();
  const browser = await L.launch();
  const host = L.createHost();
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    console.log('[extra] room', code);

    // ── 1. hand-typed code on a Hebrew keyboard (Galaxy S8 360x740) ──
    const heb = await L.openPhone(browser, 's8-hebrew-kb', L.PHONES.s8, {}, check);
    await heb.goto(`${L.CLIENT}/`);
    await L.waitScreen(heb, 'join');
    await heb.tap('.pp-code-input');
    await heb.keyboard.type(code.split('').map((c) => HEB[c]).join(''), { delay: 40 });
    const typed = await heb.inputValue('.pp-code-input');
    check(typed === code, `Hebrew-keyboard code "${code.split('').map((c) => HEB[c]).join('')}" reads as ${code} (${typed})`);
    await heb.tap('.pp-name-input');
    await heb.keyboard.type('עברית', { delay: 30 });
    await heb.keyboard.press('Enter');
    await L.waitScreen(heb, 'lobby', 8000);
    check(true, 'joined with the Hebrew-typed code');
    check(new URL(heb.url()).searchParams.get('room') === code, `the URL now carries ?room=${code} (a reload lands in the room)`);
    await L.shot(heb, OUT, '01-lobby', check);

    // lowercase + spaces + a dash (sloppy typing) on an iPhone SE 320
    const sloppy = await L.openPhone(browser, 'se320-sloppy', L.PHONES.se320, {}, check);
    await sloppy.goto(`${L.CLIENT}/`);
    await L.waitScreen(sloppy, 'join');
    await sloppy.tap('.pp-code-input');
    await sloppy.keyboard.type(` ${code.slice(0, 2).toLowerCase()}-${code.slice(2).toLowerCase()}`, { delay: 30 });
    check((await sloppy.inputValue('.pp-code-input')) === code, `sloppy " ab-cd" reads as ${code}`);
    // a wrong code: a clear error, the code stays editable
    await sloppy.fill('.pp-code-input', 'ZZZZ');
    await sloppy.fill('.pp-name-input', 'טעות');
    await sloppy.tap('.pp-btn-go');
    await L.waitFor(() => sloppy.evaluate(() => !!document.querySelector('.pp-error')), 8000, 'error');
    await L.shot(sloppy, OUT, '02-wrong-code', check);
    check((await sloppy.locator('.pp-code-input').count()) === 1, 'wrong code: the code field stays editable');
    // the same crowded form (tip + code + name + error) with the keyboard up / other sizes
    for (const vp of [{ width: 375, height: 667 }, { width: 390, height: 480 }, { width: 320, height: 330 }, { width: 430, height: 520 }]) {
      await L.resize(sloppy, vp);
      await L.sleep(200);
      sloppy.__name = `crowded-${vp.width}x${vp.height}`;
      await L.shot(sloppy, OUT, '02-wrong-code', check);
    }
    await sloppy.fill('.pp-code-input', '');
    await L.sleep(100);
    for (const vp of [{ width: 390, height: 480 }, { width: 320, height: 568 }]) {
      await L.resize(sloppy, vp);
      await L.sleep(200);
      sloppy.__name = `codeentry-${vp.width}x${vp.height}`;
      await L.shot(sloppy, OUT, '02b-code-entry', check);
    }

    // ── 2. launched from the home screen (standalone, no ?room) ──
    // a) a phone that is in the room → resumes it
    const home = await L.openPhone(browser, 'iphone14-home', L.PHONES.iphone14, { initScript: STANDALONE }, check);
    await L.join(home, code, 'מסך הבית');
    const homeId = await home.evaluate(() => window.__player.snap.playerId);
    await home.goto(`${L.CLIENT}/`);
    await L.waitScreen(home, 'lobby', 8000);
    check((await home.evaluate(() => window.__player.snap.playerId)) === homeId, 'standalone launch with no ?room resumes the same player in the last room');
    check((await home.locator('.pp-tip').count()) === 0, 'no add-to-home-screen tip when already on the home screen');
    // b) a fresh home-screen app (iPhone gives it its own empty storage) → a clean code entry
    const fresh = await L.openPhone(browser, 'iphone14-home-fresh', L.PHONES.iphone14, { initScript: STANDALONE }, check);
    await fresh.goto(`${L.CLIENT}/`);
    await L.waitScreen(fresh, 'join');
    const f = await fresh.evaluate(() => ({ code: document.querySelector('.pp-code-input')?.value, err: !!document.querySelector('.pp-error'), tip: !!document.querySelector('.pp-tip') }));
    check(f.code === '' && !f.err && !f.tip, `fresh standalone launch: empty code field, no error, no tip ${JSON.stringify(f)}`);
    await L.shot(fresh, OUT, '03-standalone-fresh', check);
    // c) last room remembered but the seat is gone (kicked earlier) → no stale code offered
    await fresh.evaluate(() => localStorage.setItem('party.lastRoom', 'QQQQ'));
    await fresh.reload();
    await L.waitScreen(fresh, 'join');
    check((await fresh.inputValue('.pp-code-input')) === '', 'a remembered room without a seat is not pre-filled');

    // ── 3. room closed → fresh code field, URL clean, reload clean ──
    const cl = await L.openPhone(browser, 'pixel7-closed', L.PHONES.pixel7, {}, check);
    await cl.goto(`${L.CLIENT}/?room=QQQQ`);
    await cl.evaluate(() => {
      localStorage.setItem('party.player.QQQQ', JSON.stringify({ playerId: 'x', secret: 'y', name: 'רוני', lateRound: null }));
      localStorage.setItem('party.lastRoom', 'QQQQ');
    });
    await cl.reload();
    await L.waitScreen(cl, 'closed', 8000);
    await L.shot(cl, OUT, '04-closed', check);
    await cl.tap('.pp-btn');
    await L.waitScreen(cl, 'join', 3000);
    const after = await cl.evaluate(() => ({ code: document.querySelector('.pp-code-input')?.value, url: location.search, name: document.querySelector('.pp-name-input')?.value }));
    check(after.code === '' && !/room=/.test(after.url), `after "room closed": empty code field and no ?room ${JSON.stringify(after)}`);
    await cl.reload();
    await L.waitScreen(cl, 'join', 5000);
    check((await cl.inputValue('.pp-code-input')) === '', 'a reload after "room closed" stays on a clean code entry');
    await cl.fill('.pp-code-input', code);
    await cl.fill('.pp-name-input', 'חוזר');
    await cl.tap('.pp-btn-go');
    await L.waitScreen(cl, 'lobby', 8000);
    check(true, 'and joins the new room from there');

    // ── tablet held sideways (no rotate overlay on a tablet: the layout must hold) ──
    const tab = await L.openPhone(browser, 'ipadmini-landscape', { ...L.PHONES.ipadmini, viewport: { width: 1024, height: 768 }, screen: { width: 1024, height: 768 } }, check);
    await tab.goto(`${L.CLIENT}/?room=${code}`);
    await L.waitScreen(tab, 'join');
    await L.shot(tab, OUT, '06-join', check);
    await tab.fill('.pp-name-input', 'טאבלט');
    await tab.tap('.pp-btn-go');
    await L.waitScreen(tab, 'lobby', 8000);
    await L.exitFs(tab);
    check(!(await tab.evaluate(() => document.documentElement.classList.contains('pp-landscape'))), 'tablet sideways: no "turn the phone" overlay');
    await L.shot(tab, OUT, '07-lobby', check);

    // ── 4. a link that dies silently mid-round (server frozen: no offline event, socket open) ──
    await host.call('host:start', { gameId: 'tap' });
    const players = [heb, home, cl];
    await Promise.all(players.map((p) => L.waitScreen(p, 'playing', 20000)));
    await L.sleep(1500);
    await L.shot(tab, OUT, '08-playing', check, { allowSmall: true });
    await L.sleep(800);
    const t0 = Date.now();
    signalServer('SIGSTOP');
    let bannerAt = null;
    try {
      await L.waitFor(() => cl.evaluate(() => window.__player.banner), 20000, 'banner');
      bannerAt = Date.now() - t0;
    } catch {}
    console.log(`[extra] silent dead link: banner after ${bannerAt} ms`);
    check(bannerAt !== null && bannerAt < 9000, `silent dead link: "reconnecting" shows within 9 s (${bannerAt} ms)`);
    await L.shot(cl, OUT, '05-dead-link-banner', check, { allowSmall: true });
    await L.sleep(Math.max(0, 9000 - (Date.now() - t0)));
    signalServer('SIGCONT');
    const t1 = Date.now();
    await L.waitFor(() => cl.evaluate(() => !window.__player.banner && window.__player.snap.online), 20000, 'recovered');
    console.log(`[extra] recovered ${Date.now() - t1} ms after the server came back`);
    check(Date.now() - t1 < 8000, `back online ${Date.now() - t1} ms after the link returns`);
    const [sv, ph] = await Promise.all([host.state(), cl.evaluate(() => ({ s: window.__player.screen, left: window.__playerPlay && window.__playerPlay.leftMs }))]);
    check(ph.s === 'playing' && sv.phase === 'playing', `still in the round after the dead link (${ph.s}, server ${sv.phase})`);

    // ── 5. a real Wi-Fi drop (the browser fires "offline") ──
    const t2 = Date.now();
    await heb.__ctx.setOffline(true);
    await L.waitFor(() => heb.evaluate(() => window.__player.banner), 20000, 'offline banner');
    const off = Date.now() - t2;
    console.log(`[extra] offline event: banner after ${off} ms`);
    check(off < 2500, `Wi-Fi drop: banner within 2.5 s (${off} ms)`);
    await heb.__ctx.setOffline(false);
    await L.waitFor(() => heb.evaluate(() => !window.__player.banner && window.__player.snap.online), 20000, 'back');
    check(true, 'banner gone after the Wi-Fi is back');

    // no false alarm on a healthy link during 10 s of play
    const flaps = await home.evaluate(
      () =>
        new Promise((res) => {
          let n = 0;
          const id = setInterval(() => {
            if (window.__player.banner) n++;
          }, 100);
          setTimeout(() => {
            clearInterval(id);
            res(n);
          }, 10000);
        }),
    );
    check(flaps === 0, `healthy link: no reconnect banner during 10 s of play (${flaps})`);
    const errs = players.flatMap((p) => p.__errors);
    check(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  } catch (err) {
    check(false, 'flow: ' + err.message);
    console.error(err);
  } finally {
    signalServer('SIGCONT');
    host.close();
    await browser.close();
    signalServer('SIGTERM');
  }
  process.exit(done() ? 1 : 0);
})();
