// Closing the browser and opening it again lands a guest back in their own seat.
//
// A real Chromium profile on disk (like a phone's browser) joins a room, the whole browser is
// closed, a new one starts on the same profile and opens the link again. Cases:
//   1. reopen with the room link (?room=CODE)
//   2. reopen from the bare address (a home-screen icon, history): the last room is resumed
//   3. reopen in the middle of a round: back in the same seat, still in that round's results
//   4. localStorage blocked (some in-app browsers, strict privacy): the seat comes back from the cookie
// In every case the room must still have exactly the same players (no second seat for the guest).
//
//   PORT=8296 npx tsx server/index.ts &      (game server)
//   PARTY_CLIENT_PORT=5296 PARTY_SERVER_PORT=8296 npx vite --config tests/e2e/qa-icy-vite.config.mjs &
//   node tests/e2e/reopen-browser.cjs        (BASE=http://localhost:5296 SERVER=http://localhost:8296)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { io } = require('socket.io-client');

const BASE = process.env.BASE || 'http://localhost:5296';
const SERVER = process.env.SERVER || 'http://localhost:8296';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (ok, what, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== undefined ? ' - ' + JSON.stringify(detail) : ''}`);
};

/** The TV, as a raw socket: creates the room and watches its state. */
async function tv() {
  const s = io(SERVER, { transports: ['websocket'], forceNew: true });
  let state = null;
  s.on('state', (st) => (state = st));
  await new Promise((r) => s.once('connect', r));
  const res = await new Promise((r) => s.emit('host:create', {}, r));
  if (!res.ok) throw new Error('host:create failed');
  state = res.state;
  const emit = (ev, req) => new Promise((r) => s.emit(ev, req, r));
  return { s, code: res.code, get state() { return state; }, emit };
}

const BLOCK_STORAGE = `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });`;

async function openPhone(dir, url, blockStorage) {
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  if (blockStorage) await ctx.addInitScript(BLOCK_STORAGE);
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(url);
  return { ctx, page, errors };
}

async function waitFor(what, ms, test) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await sleep(150);
  }
  console.log(`  (timed out waiting for ${what})`);
  return false;
}

async function scenario(label, opts) {
  console.log(`\n── ${label}`);
  const host = await tv();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-reopen-'));
  try {
    // join
    let ph = await openPhone(dir, `${BASE}/?room=${host.code}&dress=0`, opts.blockStorage);
    await ph.page.waitForSelector('.pp-name-input', { timeout: 20000 });
    await ph.page.fill('.pp-name-input', opts.name);
    await ph.page.click('.pp-btn-go');
    await waitFor('the guest in the room', 10000, async () => (host.state?.players || []).length === 1);
    const first = (host.state?.players || [])[0];
    check(first !== undefined && first.name === opts.name, 'joined', { players: (host.state?.players || []).map((p) => p.name) });
    if (opts.midRound) {
      await host.emit('host:start', { gameId: 'tap' });
      await waitFor('the round to start', 20000, async () => host.state?.phase === 'playing');
      // play a little: tap the face so the seat has a score in this round
      await sleep(1500);
      for (let i = 0; i < 25; i++) {
        await ph.page.mouse.click(195, 520);
        await sleep(40);
      }
      await sleep(600);
    }
    // close the WHOLE browser (not just the tab)
    await ph.ctx.close();
    await waitFor('the server to see the phone gone', 8000, async () => (host.state?.players || []).some((p) => p.id === first.id && !p.connected));
    check((host.state?.players || []).find((p) => p.id === first.id)?.connected === false, 'the browser is closed: the server sees the guest offline (seat kept)');
    await sleep(800);
    // reopen
    ph = await openPhone(dir, opts.reopenUrl(host.code), opts.blockStorage);
    const back = await waitFor('the guest back online', 15000, async () => (host.state?.players || []).find((p) => p.id === first.id)?.connected === true);
    const players = host.state?.players || [];
    check(back, `${opts.reopenWhat}: back in the same seat`, { players: players.map((p) => `${p.name}:${p.id === first.id ? 'same' : 'other'}:${p.connected ? 'on' : 'off'}`) });
    check(players.length === 1, 'still exactly one player (no second seat)', { count: players.length });
    const onScreen = await ph.page.evaluate(() => ({ joinForm: document.querySelector('.pp-name-input') !== null, url: location.search }));
    check(!onScreen.joinForm, 'the phone is not asked for a name again', onScreen);
    if (opts.midRound) {
      await host.emit('host:endRound', {});
      await waitFor('results', 20000, async () => host.state?.phase === 'results');
      const row = host.state?.results?.rows?.find((r) => r.playerId === first.id);
      check(row !== undefined && row.raw > 0, 'the round counted the taps from before the browser closed', row && { raw: row.raw, points: row.points });
    }
    check(ph.errors.length === 0, 'no page errors', ph.errors);
    await ph.ctx.close();
  } finally {
    host.s.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  await scenario('reopen with the room link', { name: 'רונית', reopenUrl: (c) => `${BASE}/?room=${c}&dress=0`, reopenWhat: 'reopened with the link' });
  await scenario('reopen from the bare address', { name: 'אבי', reopenUrl: () => `${BASE}/?dress=0`, reopenWhat: 'reopened from the bare address' });
  await scenario('reopen in the middle of a round', { name: 'מיכל', midRound: true, reopenUrl: () => `${BASE}/?dress=0`, reopenWhat: 'reopened mid-round' });
  await scenario('localStorage blocked: the cookie keeps the seat', { name: 'יוסי', blockStorage: true, reopenUrl: () => `${BASE}/?dress=0`, reopenWhat: 'reopened with storage blocked' });
  console.log(bad === 0 ? '\nALL OK' : `\n${bad} FAILED`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
