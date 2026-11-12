// qa-remote: the owner's phone remote (/remote) runs a whole short competition while the TV (/host)
// only displays. Two phone players + six bots. Asserts after every step that the TV did it.
//
// Start the stack first (ports are this test's own):
//   PARTY_SERVER_PORT=8901 PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=15000 PARTY_TEST_REMOTE_LOCK_MS=3000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8901 PARTY_CLIENT_PORT=5311 npx vite
//   node tests/e2e/qa-remote.cjs
// PARTY_TEST_REMOTE_LOCK_MS shortens the guess-throttle lock for the throttle step (test only).
// The password is never printed: only whether it was found in a frame.
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out/qa-remote');
const BASE = process.env.CLIENT_URL || 'http://localhost:5311';
const SERVER = process.env.SERVER_URL || 'http://localhost:8901';
const PW = process.env.PARTY_REMOTE_PASSWORD || 'kioso3tbh';
const LOCK_MS = Number(process.env.PARTY_TEST_REMOTE_LOCK_MS || 3000);
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
/** Remote pages whose sheets a retry closes first. */
const openPages = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
}
async function waitFor(what, fn, ms = 10000, step = 100) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(step);
  }
  throw new Error(`timeout: ${what} (last: ${JSON.stringify(last)})`);
}
/** A step that may fail without stopping the run; retried once (the machine is shared). */
async function step(name, fn) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await fn();
      if (attempt > 1) console.log(`  (${name}: passed on retry)`);
      return true;
    } catch (e) {
      if (attempt === 2) {
        check(name, false, e.message.slice(0, 300));
        return false;
      }
      console.log(`  retry ${name}: ${e.message.slice(0, 160)}`);
      await sleep(800);
      // a sheet left open by the failed attempt would cover every button of the retry
      for (const page of openPages) {
        for (const id of ['confirm-no', 'more-close', 'cutscenes-close', 'players-close']) {
          if (await page.locator(`[data-testid=${id}]`).isVisible().catch(() => false)) await page.click(`[data-testid=${id}]`).catch(() => undefined);
        }
      }
    }
  }
  return false;
}

/** Every websocket frame each page receives (and sends), for the password grep and the guest check. */
function tapFrames(page, label, sink) {
  page.on('websocket', (ws) => {
    sink.push({ label, dir: 'open', data: ws.url() });
    ws.on('framereceived', (f) => sink.push({ label, dir: 'in', data: String(f.payload) }));
    ws.on('framesent', (f) => sink.push({ label, dir: 'out', data: String(f.payload) }));
  });
}

const tvState = (tv) => tv.evaluate(() => window.__host && window.__host.state());
const tvModel = (tv) => tv.evaluate(() => window.__host && window.__host.model());
const remoteTv = (r) => r.evaluate(() => window.__remote && window.__remote.tv());
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);

async function shot(page, name) {
  await sleep(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function unlock(r, password = PW) {
  await r.waitForSelector('[data-testid=unlock]');
  await r.fill('[data-testid=unlock-input]', password);
  await r.click('[data-testid=unlock-go]');
}

async function remoteReady(r, ms = 10000) {
  await r.waitForSelector('[data-testid=main]', { timeout: ms });
  await waitFor('remote sees the TV', async () => (await remoteTv(r)) === 'online', ms);
  await waitFor('remote has a model', () => r.evaluate(() => !!window.__remote.model()), ms);
}

/** Taps the big button and, when it asks "sure?", confirms with a second tap (or by holding). */
async function big(r, opts = {}) {
  await waitFor('big enabled', () => r.locator('[data-testid=big]').isEnabled(), 6000);
  await r.click('[data-testid=big]');
  if (await r.locator('[data-testid=confirm]').isVisible().catch(() => false)) {
    if (opts.shotConfirm) await shot(r, opts.shotConfirm);
    await confirmSheet(r, opts.hold);
  }
}
async function confirmSheet(r, hold) {
  await r.waitForSelector('[data-testid=confirm]');
  await sleep(350); // the sheet slides up; a thumb is never faster than that
  const yes = r.locator('[data-testid=confirm-yes]');
  if (hold) {
    const box = await yes.boundingBox();
    await r.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await r.mouse.down();
    await sleep(950);
    await r.mouse.up();
  } else {
    await yes.click();
    await sleep(450);
    if (await yes.isVisible().catch(() => false)) await yes.click();
  }
  await r.waitForSelector('[data-testid=confirm]', { state: 'detached', timeout: 4000 });
}
async function more(r, testId) {
  await r.click('[data-testid=tray-more]');
  await r.waitForSelector('[data-testid=more]');
  await r.click(`[data-testid=${testId}]`);
}
async function closeSheet(r) {
  if (await visible(r, '[data-testid=more-close]')) await r.click('[data-testid=more-close]');
}

async function joinPlayer(browser, code, name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?room=${code}`);
  await p.waitForSelector('.pp-name-input', { timeout: 15000 });
  await p.fill('.pp-name-input', name);
  await p.click('.pp-btn-go');
  await waitFor(`${name} in the lobby`, () => p.evaluate(() => window.__player && window.__player.screen === 'lobby'), 15000);
  return { ctx, page: p };
}

(async () => {
  const browser = await chromium.launch();
  const frames = [];
  const bots = [];
  const phone = { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } };
  let tvCtx;
  let tv;
  try {
    // ───────── the TV ─────────
    tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    tv = await tvCtx.newPage();
    tapFrames(tv, 'tv', frames);
    tv.on('pageerror', (e) => check(`tv pageerror ${e.message}`, false));
    await tv.goto(`${BASE}/host`);
    await tv.evaluate(() => localStorage.clear());
    await tv.goto(`${BASE}/host`);
    await tv.waitForSelector('[data-testid=room-code]');
    const code = (await tv.textContent('[data-testid=room-code]')).trim();
    console.log('room', code);
    check('TV shows its strip with no remote attached', await visible(tv, '[data-testid=strip]'));
    await shot(tv, 'tv-without-remote');

    // ───────── a guest opens /remote without the password ─────────
    await step('a guest without the password sees only the unlock screen and gets no room data', async () => {
      const gctx = await browser.newContext({ ...phone });
      const g = await gctx.newPage();
      const gf = [];
      tapFrames(g, 'guest', gf);
      await g.goto(`${BASE}/remote`);
      await g.waitForSelector('[data-testid=unlock]');
      await sleep(2500);
      const sockets = gf.filter((f) => f.dir === 'open').length;
      const roomData = gf.some((f) => f.dir === 'in' && (f.data.includes(code) || f.data.includes('"state"') || f.data.includes('players')));
      const onlyUnlock = (await g.locator('[data-testid=main]').count()) === 0;
      if (!(onlyUnlock && !roomData)) throw new Error(`guest saw something: sockets=${sockets} roomData=${roomData}`);
      check('guest: only the unlock screen, no room data in any frame', true, { socketsOpened: sockets });
      await gctx.close();
    });

    // ───────── the owner's remote ─────────
    const rctx = await browser.newContext({ ...phone });
    const r = await rctx.newPage();
    tapFrames(r, 'remote', frames);
    openPages.push(r);
    r.on('pageerror', (e) => check(`remote pageerror ${e.message}`, false));
    await r.goto(`${BASE}/remote`);
    await r.waitForSelector('[data-testid=unlock]');
    const inputType = await r.getAttribute('[data-testid=unlock-input]', 'type');
    const fontPx = await r.$eval('[data-testid=unlock-input]', (el) => parseFloat(getComputedStyle(el).fontSize));
    check('password field: type=password, 16px+ (no iOS zoom)', inputType === 'password' && fontPx >= 16, { inputType, fontPx });
    await shot(r, '390-01-unlock');
    await unlock(r);
    await remoteReady(r);
    check('unlock with the password attaches the remote', true);
    check('URL carries no password', !r.url().includes(PW));
    await waitFor('TV state.remotes = 1', async () => (await tvState(tv)).remotes === 1);
    await sleep(600);
    check('TV hides the strip while a remote is attached', !(await visible(tv, '[data-testid=strip]')));
    check('TV hides the ☰ button while a remote is attached', !(await visible(tv, '[data-testid=btn-more]')));
    await shot(tv, 'tv-with-remote');

    // ───────── players: two phones + six bots ─────────
    const p1 = await joinPlayer(browser, code, 'דנה');
    const p2 = await joinPlayer(browser, code, 'גיא');
    tapFrames(p1.page, 'player1', frames);
    tapFrames(p2.page, 'player2', frames);
    bots.push(
      spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', '6', '--play', '--quiet'], {
        cwd: ROOT,
        stdio: 'ignore',
        detached: true,
      }),
    );
    await waitFor('8 players in the room', async () => (await tvState(tv)).players.length >= 8, 25000);
    await waitFor('remote lists 8 players', () => r.evaluate(() => document.querySelectorAll('.rm-chip').length >= 8), 8000);
    await shot(r, '390-02-main-lobby');

    // ───────── pick and start a game (picking alone starts nothing) ─────────
    await step('pick a game, then start it from the big button', async () => {
      await r.click('[data-testid=pick-flappy]');
      await sleep(600);
      const s0 = await tvState(tv);
      if (s0.phase !== 'lobby') throw new Error('picking started something');
      const label = await r.textContent('[data-testid=big]');
      if (!label.includes('פלאפי')) throw new Error(`big says ${label}`);
      await big(r);
      await waitFor('TV in intro with flappy', async () => {
        const s = await tvState(tv);
        return s.phase === 'intro' && s.round && s.round.gameId === 'flappy';
      });
      check('picked game started on the TV (flappy)', true);
    });

    // ───────── a manual cutscene, then skip it ─────────
    await step('manual cutscene from the remote, then skip it', async () => {
      await r.click('[data-testid=tray-cutscenes]');
      await r.waitForSelector('[data-testid=cutscenes]');
      await r.click('[data-testid=cut-joker_1]');
      await waitFor('TV plays joker_1', async () => ((await tvState(tv)).cutscene || {}).id === 'joker_1');
      check('TV plays the cutscene chosen on the phone', true);
      await waitFor('big = skip', () => r.getAttribute('[data-testid=big]', 'data-action').then((a) => a === 'cutscene-skip'), 5000);
      await big(r);
      await waitFor('TV cutscene over', async () => (await tvState(tv)).cutscene === null);
      check('skip from the phone ends the cutscene on the TV', true);
    });

    // ───────── during the round: live top five, then end it early ─────────
    await step('live top five during the round', async () => {
      await waitFor('TV playing', async () => (await tvState(tv)).phase === 'playing', 15000);
      await waitFor('top five rows', () => r.evaluate(() => document.querySelectorAll('[data-testid=top5-row]').length >= 3), 8000);
      const rows = await r.$$eval('[data-testid=top5-row]', (els) => els.length);
      check('remote shows the live top five', rows >= 3 && rows <= 5, { rows });
      const clock = await r.textContent('[data-testid=clock]').catch(() => '');
      check('remote shows the time left from the server clock', /\d:\d\d/.test(clock), { clock });
      await shot(r, '390-03-round-top5');
    });
    await step('end the round early (danger confirm)', async () => {
      await big(r, { shotConfirm: '390-05-danger-confirm' });
      await waitFor('TV results', async () => (await tvState(tv)).phase === 'results', 8000);
      check('end round early from the phone: TV shows results', true);
    });

    // ───────── results: replay the ceremony, continue ─────────
    await step('results: wait for the reveal, replay the ceremony, continue', async () => {
      await waitFor('ceremony over on the TV', async () => {
        const m = await tvModel(tv);
        const c = m.actions.find((a) => a.id === 'continue');
        return c && c.confirm === undefined;
      }, 30000, 250);
      await waitFor('round top on the remote', () => r.evaluate(() => document.querySelectorAll('[data-testid=round-top] .rm-top5-row').length > 0), 6000);
      await shot(r, '390-06-results');
      await r.click('[data-testid=sec-replay]');
      await waitFor('TV replays the ceremony', async () => {
        const m = await tvModel(tv);
        const c = m.actions.find((a) => a.id === 'continue');
        return c && c.confirm !== undefined;
      }, 4000);
      check('replay from the phone restarts the ceremony on the TV', true);
      // continue while the replay runs: the phone asks "skip the ceremony?", confirmed by holding
      await big(r, { hold: true });
      await waitFor('TV lobby', async () => (await tvState(tv)).phase === 'lobby', 6000);
      check('continue through the results (skip confirm by holding) -> TV lobby', true);
    });

    // ───────── the next game, played to the end ─────────
    await step('next game from the big button, played to its results', async () => {
      const label = await r.textContent('[data-testid=big]');
      await big(r);
      await waitFor('TV intro', async () => (await tvState(tv)).phase === 'intro', 6000);
      const g = (await tvState(tv)).round.gameId;
      check('next game started on the TV', g === 'tap', { g, label: label.trim() });
      await waitFor('TV results after a full round', async () => (await tvState(tv)).phase === 'results', 40000, 300);
      await waitFor('ceremony over', async () => {
        const m = await tvModel(tv);
        const c = m.actions.find((a) => a.id === 'continue');
        return c && c.confirm === undefined;
      }, 30000, 250);
      await sleep(400);
      await big(r);
      await waitFor('TV lobby', async () => (await tvState(tv)).phase === 'lobby', 6000);
      check('continue after the ceremony (no question) -> TV lobby', true);
    });

    // ───────── kick a bot ─────────
    await step('kick a bot from the players sheet', async () => {
      const before = (await tvState(tv)).players.length;
      await more(r, 'more-kick');
      await r.waitForSelector('[data-testid=players]');
      const row = r.locator('[data-testid=kick-row][data-name^="בוט"]').first();
      const name = await row.getAttribute('data-name');
      await row.click();
      await confirmSheet(r, false);
      await waitFor('TV lost the bot', async () => {
        const s = await tvState(tv);
        return s.players.length === before - 1 && !s.players.some((p) => p.name === name);
      });
      check('kick from the phone removed the bot on the TV', true);
    });

    // ───────── toggles: auto cutscenes, mute, calm ─────────
    await step('toggle auto-cutscenes, mute and calm from the more sheet', async () => {
      const auto0 = (await tvState(tv)).autoCutscenes;
      await more(r, 'more-auto');
      await waitFor('auto flipped', async () => (await tvState(tv)).autoCutscenes === !auto0);
      check('auto-cutscenes switch flipped on the server', true, { now: !auto0 });
      await waitFor('sheet shows it', () => r.getAttribute('[data-testid=more-auto]', 'aria-pressed').then((v) => v === String(!auto0)), 4000);
      await r.click('[data-testid=more-auto]');
      await waitFor('auto back', async () => (await tvState(tv)).autoCutscenes === auto0);
      await shot(r, '390-04-more-sheet');
      await r.click('[data-testid=more-mute]');
      await waitFor('TV muted', async () => (await tvModel(tv)).actions.find((a) => a.id === 'mute').on === true);
      await r.click('[data-testid=more-mute]');
      await waitFor('TV unmuted', async () => (await tvModel(tv)).actions.find((a) => a.id === 'mute').on === false);
      await r.click('[data-testid=more-calm]');
      await waitFor('TV calm', async () => (await tvModel(tv)).actions.find((a) => a.id === 'calm').on === true);
      await r.click('[data-testid=more-calm]');
      await waitFor('TV not calm', async () => (await tvModel(tv)).actions.find((a) => a.id === 'calm').on === false);
      await closeSheet(r);
      check('mute and calm (TV-local) work from the phone', true);
    });

    // ───────── keyboard on the TV still works; the mouse peeks the strip ─────────
    await step('TV keyboard works while the remote is attached; the mouse shows the strip', async () => {
      await tv.bringToFront();
      await sleep(1600); // the key guard after a screen change
      await tv.keyboard.press('KeyN');
      await waitFor('TV intro by key N', async () => (await tvState(tv)).phase === 'intro', 5000);
      await tv.keyboard.press('KeyE');
      await waitFor('TV back in lobby by key E', async () => (await tvState(tv)).phase === 'lobby', 5000);
      check('keyboard N / E on the TV work with a remote attached', true);
      await tv.mouse.move(400, 400);
      await tv.mouse.move(420, 420);
      await waitFor('strip peeks', () => visible(tv, '[data-testid=strip]'), 2000);
      check('moving the mouse on the laptop shows the strip', true);
      await waitFor('strip hides again', async () => !(await visible(tv, '[data-testid=strip]')), 7000);
      check('...and hides it again after a few seconds', true);
    });

    // ───────── podium with its confirm, replay, reset with its confirm ─────────
    await step('early podium with its confirm, then reset with its confirm', async () => {
      await more(r, 'more-podium');
      await confirmSheet(r, false);
      await waitFor('TV final', async () => (await tvState(tv)).phase === 'final', 6000);
      check('podium from the phone (with confirm) -> TV final', true);
      // the automatic "before the podium" cutscene may play: skip it from the phone
      if ((await tvState(tv)).cutscene) {
        await waitFor('big = skip', () => r.getAttribute('[data-testid=big]', 'data-action').then((a) => a === 'cutscene-skip'), 5000);
        await big(r);
        await waitFor('cutscene over', async () => (await tvState(tv)).cutscene === null);
      }
      await waitFor('remote big = new competition', () => r.getAttribute('[data-testid=big]', 'data-action').then((a) => a === 'reset'), 5000);
      await shot(r, '390-07-final');
      await r.click('[data-testid=sec-replay]');
      await waitFor('replay acknowledged', () => r.textContent('[data-testid=flash]').then((t) => t.includes('נשלח')), 4000);
      check('replay the podium from the phone (acknowledged by the TV)', true);
      await big(r, { shotConfirm: '390-08-reset-confirm' });
      await waitFor('TV reset to lobby', async () => {
        const s = await tvState(tv);
        return s.phase === 'lobby' && s.played.length === 0;
      }, 6000);
      check('reset from the phone (with confirm) -> TV lobby, nothing played', true);
    });

    // ───────── survives: a reload, 20 s offline, the TV reloading ─────────
    await step('the remote survives a reload (no password again)', async () => {
      await r.reload();
      const t0 = Date.now();
      await remoteReady(r, 10000);
      check('remote back after reload without the unlock screen', true, { ms: Date.now() - t0 });
    });
    await step('the remote survives 20 s offline', async () => {
      await rctx.setOffline(true);
      await waitFor('remote notices', () => r.evaluate(() => window.__remote.server() !== 'online'), 25000, 250).catch(() => null);
      await sleep(20000);
      const t0 = Date.now();
      await rctx.setOffline(false);
      await waitFor('remote back online with the TV', async () => (await remoteTv(r)) === 'online' && (await r.evaluate(() => window.__remote.server())) === 'online', 15000, 100);
      check('remote re-attached after 20 s offline', true, { ms: Date.now() - t0 });
      await r.click('[data-testid=pick-icy]');
      const label = await r.textContent('[data-testid=big]');
      check('...and its model is fresh (picker + big button work)', label.includes('אייסי'));
      await r.click('[data-testid=pick-icy]');
    });
    await step('the TV page reloading: the model comes back, the strip stays hidden', async () => {
      await tv.reload();
      await tv.waitForSelector('[data-testid=room-code]');
      const t0 = Date.now();
      await waitFor('remote sees the TV again', async () => (await remoteTv(r)) === 'online', 12000, 100);
      await sleep(800);
      check('model back on the remote after the TV reloaded', (await r.evaluate(() => !!window.__remote.model())), { ms: Date.now() - t0 });
      check('TV strip still hidden after its reload', !(await visible(tv, '[data-testid=strip]')));
    });

    // ───────── the TV page closed: "screen not connected" + the rescue pair ─────────
    await step('TV closed: the remote says so and the rescue actions work', async () => {
      await big(r); // start the next game
      await waitFor('round running', () => r.evaluate(() => ['intro', 'countdown', 'playing'].includes(document.querySelector('[data-testid=main]').dataset.phase)), 6000);
      await tv.close();
      await waitFor('remote: screen not connected', () => visible(r, '[data-testid=tv-down]'), 12000, 200);
      const text = await r.textContent('[data-testid=tv-down]');
      check('remote shows "המסך לא מחובר - פתחו את עמוד הטלוויזיה"', text.includes('המסך לא מחובר') && text.includes('פתחו את עמוד הטלוויזיה'));
      check('big button replaced by the rescue pair', (await r.locator('[data-testid=big]').count()) === 0 && (await visible(r, '[data-testid=rescue]')));
      await shot(r, '390-09-tv-down');
      await r.click('[data-testid=rescue-end]');
      await confirmSheet(r, false);
      await waitFor('server: results', () => r.evaluate(() => document.querySelector('[data-testid=main]').dataset.phase === 'results'), 8000);
      check('rescue: end round straight on the server', true);
      await waitFor('lobby button enabled', () => r.locator('[data-testid=rescue-lobby]').isEnabled(), 4000);
      await r.click('[data-testid=rescue-lobby]');
      await waitFor('server: lobby', () => r.evaluate(() => document.querySelector('[data-testid=main]').dataset.phase === 'lobby'), 8000);
      check('rescue: back to the lobby straight on the server', true);
      tv = await tvCtx.newPage();
      tapFrames(tv, 'tv2', frames);
      await tv.goto(`${BASE}/host`);
      await tv.waitForSelector('[data-testid=room-code]');
      const again = (await tv.textContent('[data-testid=room-code]')).trim();
      check('TV reopened in the same room', again === code, { again });
      await waitFor('remote sees the TV again', async () => (await remoteTv(r)) === 'online', 12000);
      check('remote back to normal once the TV is open', true);
    });

    // ───────── two remotes at once ─────────
    await step('two remotes at once', async () => {
      const r2ctx = await browser.newContext({ ...phone });
      const r2 = await r2ctx.newPage();
      tapFrames(r2, 'remote2', frames);
      await r2.goto(`${BASE}/remote`);
      await unlock(r2);
      await remoteReady(r2);
      await waitFor('TV state.remotes = 2', async () => (await tvState(tv)).remotes === 2);
      await more(r2, 'more-mute');
      await waitFor('TV muted by the second remote', async () => (await tvModel(tv)).actions.find((a) => a.id === 'mute').on === true);
      await waitFor('first remote sees it', () => r.evaluate(() => window.__remote.model().actions.find((a) => a.id === 'mute').on === true), 5000);
      await r2.click('[data-testid=more-mute]');
      await waitFor('TV unmuted', async () => (await tvModel(tv)).actions.find((a) => a.id === 'mute').on === false);
      check('two remotes: both attached, both drive the TV, both see the same model', true);
      await r2ctx.close();
      await waitFor('TV state.remotes = 1', async () => (await tvState(tv)).remotes === 1);
    });

    // ───────── the small phone ─────────
    await step('320x568: unlock, lobby, the more sheet, a round', async () => {
      const sctx = await browser.newContext({ ...devices['iPhone SE'], viewport: { width: 320, height: 568 } });
      const s = await sctx.newPage();
      tapFrames(s, 'remote-se', frames);
      await s.goto(`${BASE}/remote`);
      await s.waitForSelector('[data-testid=unlock]');
      await shot(s, '320-01-unlock');
      await unlock(s);
      await remoteReady(s);
      await shot(s, '320-02-main-lobby');
      const fits = await s.evaluate(() => {
        const el = document.querySelector('[data-testid=main]');
        const tray = document.querySelector('.rm-tray').getBoundingClientRect();
        return document.documentElement.scrollWidth <= window.innerWidth && el.scrollHeight <= el.clientHeight + 1 && tray.bottom <= window.innerHeight + 0.5;
      });
      check('320x568: no scroll, the tray is on screen', fits);
      await s.click('[data-testid=tray-more]');
      await s.waitForSelector('[data-testid=more]');
      await shot(s, '320-03-more');
      await s.click('[data-testid=more-close]');
      await big(s);
      await waitFor('playing', async () => (await tvState(tv)).phase === 'playing', 10000);
      await waitFor('top five', () => s.evaluate(() => document.querySelectorAll('[data-testid=top5-row]').length >= 3), 8000);
      await shot(s, '320-04-round');
      await s.click('[data-testid=big]');
      await shot(s, '320-05-confirm');
      await confirmSheet(s, false);
      await waitFor('results', async () => (await tvState(tv)).phase === 'results', 8000);
      await sctx.close();
    });

    // ───────── the remote disconnects: the TV's controls come back ─────────
    await step('log out on the phone: the TV shows its strip again within ~2 s', async () => {
      await waitFor('TV state.remotes = 1', async () => (await tvState(tv)).remotes === 1, 5000);
      await more(r, 'logout');
      const t0 = Date.now();
      await waitFor('strip back', () => visible(tv, '[data-testid=strip]'), 3000, 50);
      const ms = Date.now() - t0;
      check('TV strip visible again after the remote left', ms <= 2500, { ms });
      check('☰ visible again', await visible(tv, '[data-testid=btn-more]'));
      await shot(tv, 'tv-remote-gone');
      await r.waitForSelector('[data-testid=unlock]');
      check('log out returns the phone to the unlock screen', true);
    });

    // ───────── wrong password five times: throttled, then the right one after the wait ─────────
    await step('five wrong passwords -> a countdown; the right one works after the wait', async () => {
      const wctx = await browser.newContext({ ...phone });
      const w = await wctx.newPage();
      tapFrames(w, 'wrong', frames);
      await w.goto(`${BASE}/remote`);
      for (let i = 0; i < 4; i++) {
        await unlock(w, `nope${i}`);
        await w.waitForSelector('[data-testid=unlock-error]');
      }
      const err = await w.textContent('[data-testid=unlock-error]');
      check('a wrong password says so', err.includes('סיסמה שגויה'));
      await unlock(w, 'nope-last');
      await w.waitForSelector('[data-testid=unlock-wait]', { timeout: 5000 });
      const secs = Number(await w.textContent('[data-testid=unlock-wait-s]'));
      check('fifth wrong try: throttled with a countdown', secs > 0 && secs <= Math.ceil(LOCK_MS / 1000), { secs });
      await shot(w, '390-10-throttled');
      await w.waitForSelector('[data-testid=unlock-wait]', { state: 'detached', timeout: LOCK_MS + 3000 });
      await unlock(w);
      await remoteReady(w);
      check('after the wait the right password works', true);
      await wctx.close();
    });

    await p1.ctx.close();
    await p2.ctx.close();
  } catch (e) {
    check('run', false, e.message);
    if (tv && !tv.isClosed()) await tv.screenshot({ path: path.join(OUT, 'zz-failure-tv.png') }).catch(() => undefined);
  } finally {
    for (const b of bots) {
      try {
        process.kill(-b.pid);
      } catch {
        // gone already
      }
    }
    // the password must never come back from the server: nothing received carries it, and only the
    // remote's own remote:attach requests ever send it
    const leakedIn = frames.some((f) => f.dir === 'in' && f.data.includes(PW));
    const leakedOut = frames.some((f) => f.dir === 'out' && f.data.includes(PW) && !(f.label.startsWith('remote') || f.label === 'wrong') );
    const sentOther = frames.some((f) => f.dir === 'out' && f.data.includes(PW) && !f.data.includes('"remote:attach"'));
    check('password found in a received frame: ' + (leakedIn ? 'found' : 'not found'), !leakedIn);
    check('password sent by anything but remote:attach: ' + (leakedOut || sentOther ? 'found' : 'not found'), !leakedOut && !sentOther);
    await browser.close();
    const failed = results.filter((x) => !x.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    for (const f of failed) console.log('  FAILED:', f.name);
    process.exit(failed.length > 0 ? 1 : 0);
  }
})();
