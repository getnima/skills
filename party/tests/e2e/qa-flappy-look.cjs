// qa-flappy-look: every guest flies their own dressed Shimi head in flappy (GameContext.myLook),
// and the "out" view shows the dressed heads of who is still in the air (FieldPlayer.look).
//
//   A. dev harness (no server): no look -> the round token; ?look= -> the dressed head; the doll
//      picture or an accessory picture missing -> the round token, no error.
//   B. a real room: a socket host, three phones (430x932, 390x844, 320x568) that dress differently
//      in the real dressing room (?dress=1), one flappy round:
//        430 flies with the game's pilot (the last one standing), 390 lets go after a while,
//        320 never taps (out first). Each phone flies ITS OWN head (the look the server has for it);
//        the out phones show the others' heads next to their names, and the winner's head.
//      Screenshots: mid-flight, the crash, the out view, the finale, the winner line.
//
//   PORT=8981 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8981 PARTY_CLIENT_PORT=5381 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   SERVER_URL=http://localhost:8981 CLIENT_URL=http://localhost:5381 node tests/e2e/qa-flappy-look.cjs
// Env: ONLY=harness | room. Screenshots: tests/e2e/out/qa-flappy-look/ (look at them).
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const D = require('./dress-lib.cjs');

const SERVER = process.env.SERVER_URL || 'http://localhost:8981';
const CLIENT = process.env.CLIENT_URL || 'http://localhost:5381';
const ONLY = process.env.ONLY || '';
const OUT = path.join(__dirname, 'out', 'qa-flappy-look');
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
let passed = 0;
function check(ok, msg, extra) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (ok) passed++;
  else fails.push(msg);
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label, every = 40) {
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
    await sleep(every);
  }
}
const phoneCtx = (browser, w, h) => browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
function watch(page, name, errors, ignore) {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (ignore && ignore.test(m.text() + ' ' + (m.location().url || ''))) return;
    errors.push(`${name} console: ${m.text()}`);
  });
}

// ───────────────────────── A. dev harness ─────────────────────────
const LOOK = '1.5.10-8-17.201.13.229.325';

async function harnessCase(browser, label, query, block) {
  const ctx = await phoneCtx(browser, 390, 844);
  const page = await ctx.newPage();
  const errors = [];
  // a blocked picture is a failed request on purpose: only that console line is expected
  watch(page, label, errors, block ? /Failed to load resource|ERR_FAILED/ : null);
  if (block) await page.route(block, (r) => r.abort());
  await page.goto(`${CLIENT}/dev.html?game=flappy&seed=5&pilot=1${query}`);
  await page.waitForFunction(() => window.__flappy, null, { timeout: 30000 });
  // the head is made after the boot in the harness (GO has passed): give it time
  await sleep(2500);
  const head = await page.evaluate(() => window.__flappy.head);
  const mode = await page.evaluate(() => window.__flappy.mode);
  await ctx.close();
  return { head, mode, errors };
}

async function harness(browser) {
  console.log('[look] A. dev harness');
  const none = await harnessCase(browser, 'no-look', '');
  check(none.head.look === null && none.head.dressed === false, 'no look: the round token', none.head);
  check(none.errors.length === 0, 'no look: no errors', none.errors);
  const dressed = await harnessCase(browser, 'look', `&look=${LOOK}`);
  // the bird wears no hats (13.11): the look has a three-hat tower, the sprite is just the head (a tower made it far taller than wide)
  check(dressed.head.look === LOOK && dressed.head.dressed === true && dressed.head.w > 20 && dressed.head.h < dressed.head.w * 1.5, '?look=: the dressed head, without the hat tower', dressed.head);
  check(dressed.mode === 'fly' && dressed.errors.length === 0, '?look=: flying, no errors', { mode: dressed.mode, errors: dressed.errors });
  const noDoll = await harnessCase(browser, 'no-doll', `&look=${LOOK}`, '**/assets/shimi/doll.webp');
  check(noDoll.head.look === LOOK && noDoll.head.dressed === false, 'the doll picture fails: the round token', noDoll.head);
  check(noDoll.mode === 'fly' && noDoll.errors.length === 0, 'the doll picture fails: flying, no errors', { mode: noDoll.mode, errors: noDoll.errors });
  const noEars = await harnessCase(browser, 'no-ears', `&look=${LOOK}`, '**/assets/shimi/props/13_*');
  check(noEars.head.dressed === false && noEars.mode === 'fly' && noEars.errors.length === 0, 'an accessory picture fails: the round token, no errors', { head: noEars.head, errors: noEars.errors });
  // a hat's picture is not needed at all: the bird does not wear it
  const noHat = await harnessCase(browser, 'no-hat', `&look=${LOOK}`, '**/assets/shimi/props/10_*');
  check(noHat.head.dressed === true && noHat.mode === 'fly', 'a hat picture fails: still the dressed head (hats are not worn in flight)', { head: noHat.head, errors: noHat.errors });
}

// ───────────────────────── B. a real room ─────────────────────────
const PHONE = () => {
  const p = window.__player;
  const f = window.__flappy;
  const me = p && p.snap.state ? p.snap.state.players.find((x) => x.id === p.snap.playerId) : null;
  return {
    screen: p ? p.screen : null,
    phase: p && p.snap.state ? p.snap.state.phase : null,
    id: p ? p.snap.playerId : null,
    look: p ? p.snap.look : null,
    serverLook: me ? me.look : null,
    f: f ? { mode: f.mode, steps: f.steps, raw: f.raw, run: f.run, head: f.head, out: f.out, countdown: f.countdown, finaleStage: f.finaleStage, won: f.won, active: f.active } : null,
  };
};

async function room(browser) {
  console.log('[look] B. a real room');
  const host = io(SERVER, { transports: ['websocket'], forceNew: true });
  let state = null;
  host.on('state', (s) => (state = s));
  const call = (ev, req) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ack timeout ' + ev)), 8000);
      host.emit(ev, req, (res) => {
        clearTimeout(t);
        resolve(res);
      });
    });
  const errors = [];
  try {
    const created = await call('host:create', {});
    check(created.ok === true, 'a room (socket host)');
    const code = created.code;
    await call('host:setAutoCutscenes', { enabled: false });
    console.log('[look] room', code);

    // three phones, three different dolls, dressed in the real dressing room
    const spec = [
      { tag: '430', name: 'דנה', w: 430, h: 932, taps: [['HEAD', 0], ['HEAD', 3], ['HEAD', 5], ['EYES', 1], ['NECK', 0]] },
      { tag: '390', name: 'יוסי', w: 390, h: 844, taps: [['HEAD', 6], ['FACE', 0], ['EYES', 4]] },
      { tag: '320', name: 'מיכל', w: 320, h: 568, taps: [['EARS', 1], ['HEAD', 2], ['EYES', 0], ['NECK', 2]] },
    ];
    const phones = [];
    for (const s of spec) {
      const ctx = await phoneCtx(browser, s.w, s.h);
      const page = await ctx.newPage();
      page.__name = s.tag;
      watch(page, s.tag, errors, /\/cutscenes\//);
      await page.goto(D.withDressing(`${CLIENT}/?room=${code}`));
      await waitFor(() => page.evaluate(() => window.__player && window.__player.screen === 'join'), 30000, `${s.tag} join`);
      await page.fill('.pp-name-input', s.name);
      await page.locator('.pp-btn-go').tap();
      await D.waitDressing(page);
      for (const [tab, n] of s.taps) await D.tapItem(page, tab, n);
      await D.finishDressing(page);
      const ph = { page, ...s };
      // the server has the look the guest dressed
      const i = await waitFor(async () => {
        const x = await page.evaluate(PHONE);
        return x.serverLook && x.serverLook === x.look ? x : null;
      }, 10000, `${s.tag} look on the server`);
      ph.id = i.id;
      ph.look = i.serverLook;
      phones.push(ph);
      console.log(`[look] ${s.tag} ${s.name} dressed ${ph.look}`);
      await page.screenshot({ path: path.join(OUT, `room-00-lobby-${s.tag}.png`) });
    }
    const [A, B, C] = phones;
    check(new Set(phones.map((p) => p.look)).size === 3, 'the three guests dressed differently', phones.map((p) => p.look));
    const shot = (ph, name) => ph.page.screenshot({ path: path.join(OUT, `room-${name}-${ph.tag}.png`) });
    // every reading of a phone during the round remembers which look its bird was (12 s rounds: read while it runs)
    const seen = new Map(phones.map((ph) => [ph.tag, new Set()]));
    const info = async (ph) => {
      const i = await ph.page.evaluate(PHONE);
      if (i.f && i.f.head) seen.get(ph.tag).add(`${i.f.head.dressed ? 'dressed' : 'token'}:${i.f.head.look}`);
      return i;
    };

    // ── the round ──
    const started = await call('host:start', { gameId: 'flappy' });
    check(started.ok === true, 'host:start flappy', started);
    await Promise.all(phones.map((ph) => waitFor(async () => (await info(ph)).f !== null, 30000, `${ph.tag} game mounted`)));
    // the pilots: the 430 phone flies to the end, the 390 one lets go after 4.7 s (room for the winner line in a 12 s FAST round), the 320 one never taps
    await A.page.evaluate(() => window.__flappy.autopilot(true));
    await B.page.evaluate(() => window.__flappy.autopilot(true, 280));
    // made before GO (the countdown): every phone starts with its own head
    const heads = await Promise.all(phones.map(async (ph) => (await info(ph)).f.head));
    phones.forEach((ph, k) => check(heads[k].dressed === true && heads[k].look === ph.look, `${ph.tag}: the bird is this guest's own dressed head (made during the countdown)`, heads[k]));
    await Promise.all(phones.map((ph) => shot(ph, '01-countdown')));

    await waitFor(async () => (await info(A)).f.steps > 50, 15000, 'flying');
    await Promise.all(phones.map((ph) => shot(ph, '02-midair')));

    // the 320 phone never taps: crash, then the out view
    const cDead = await waitFor(async () => { const i = await info(C); return i.f && i.f.mode === 'dead' ? i : null; }, 10000, '320 crashes', 20);
    await shot(C, '03-crash');
    check(cDead.f.head.dressed === true, '320: the crash keeps the dressed head (dizzy stars, knocked halo)');
    const cOut = await waitFor(async () => { const i = await info(C); return i.f && i.f.mode === 'out' && i.f.out && i.f.out.names.length >= 2 && i.f.out.heads >= 2 ? i : null; }, 8000, '320 out view with heads', 30).catch(() => null);
    const cNow = cOut || (await info(C));
    check(cOut !== null, '320 out view: the two guests still in the air, each with a dressed head', cNow.f && cNow.f.out);
    check(cNow.f && cNow.f.out && [A.name, B.name].every((n) => cNow.f.out.names.includes(n)), '320 out view names them', cNow.f && cNow.f.out && cNow.f.out.names);
    const chipLooks = await C.page.evaluate(() => [...document.querySelectorAll('.fl-chip.has-head')].map((c) => c.textContent));
    check(chipLooks.length === 2, '320 out view: two chips carry a head', chipLooks);
    await sleep(150);
    await shot(C, '04-out');

    // the finale: 2 left in a field of 3
    const fin = await waitFor(async () => (state && state.round && state.round.finale ? state.round.finale : null), 15000, 'finale announced', 30).catch(() => null);
    check(fin !== null, 'the finale is announced');
    if (fin) {
      await waitFor(async () => { const i = await info(A); return i.f && (i.f.countdown !== '' || i.f.finaleStage >= 0) ? i : null; }, 6000, 'finale on the flying phone', 20).catch(() => null);
      await Promise.all(phones.map((ph) => shot(ph, '05-finale')));
      const fa = await info(A);
      check(fa.f.mode === 'fly' && fa.f.head.dressed === true, '430: flying into the finale with its own head', fa.f.head);
    }

    // the 390 phone lets go: crash, out view (one left: the 430 guest)
    const bDead = await waitFor(async () => { const i = await info(B); return i.f && i.f.mode === 'dead' ? i : null; }, 15000, '390 crashes', 20).catch(() => null);
    if (bDead) await shot(B, '06-crash');
    check(bDead !== null && bDead.f.head.dressed === true, '390: crashes with its own dressed head');
    // the last one standing: the winner line on the out phones carries the winner's head
    const win = await waitFor(async () => {
      const [a, b, c] = await Promise.all([info(A), info(B), info(C)]);
      return a.f && b.f && c.f && b.f.out && c.f.out && b.f.out.winner && c.f.out.winner && b.f.out.winnerHead && c.f.out.winnerHead ? [a, b, c] : null;
    }, 10000, 'winner line with a head', 40).catch(() => null);
    const [aw, bw, cw] = win || [await info(A), await info(B), await info(C)];
    check(win !== null && /דנה/.test(bw.f.out.winner) && /דנה/.test(cw.f.out.winner), 'the out phones name the winner, with the winner\'s dressed head', { b: bw.f && bw.f.out, c: cw.f && cw.f.out });
    check(aw.f && aw.f.mode === 'fly' && aw.f.won === true && aw.f.head.dressed === true && aw.f.head.look === A.look, '430: the last one in the air, still with its own head', aw.f && { mode: aw.f.mode, won: aw.f.won, head: aw.f.head });
    await Promise.all([shot(A, '07-last'), shot(B, '07-winner'), shot(C, '07-winner')]);

    // every phone flew its own doll, never another guest's, never the token
    const flown = phones.map((ph) => [...seen.get(ph.tag)]);
    check(flown.every((looks, k) => looks.length === 1 && looks[0] === `dressed:${phones[k].look}`), 'each phone flew its own dressed look, the whole round', flown);
    await waitFor(async () => (state && state.phase !== 'playing' ? state : null), 30000, 'round over', 100).catch(() => null);
    check(state && state.phase !== 'playing', 'the round ends', state && state.phase);
    check(errors.length === 0, 'no page / console errors on the phones', errors);
  } finally {
    host.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (ONLY !== 'room') await harness(browser);
    if (ONLY !== 'harness') await room(browser);
  } catch (e) {
    fails.push(String(e && e.stack ? e.stack : e));
    console.log('  FAIL', e);
  } finally {
    await browser.close();
  }
  console.log(fails.length === 0 ? `\n[qa-flappy-look] ALL OK (${passed} checks)` : `\n[qa-flappy-look] ${fails.length} FAILED:\n - ${fails.join('\n - ')}`);
  process.exit(fails.length === 0 ? 0 : 1);
})();
