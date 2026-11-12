// dress-flow: the way in, end to end, with real touch input, on three phone sizes.
// A guest opens the link, types a name, lands in the dressing room, dresses the doll (the TV
// lobby shows the same look within a second), finishes, lands in the waiting room with the
// dressed doll, goes back and changes the look, reloads mid-way; a second phone sees the first
// one's doll; the owner starts a round while a third phone is still dressing; a guest joins
// in the middle of the round. Then the TV lobby with 2 .. 60 guests.
//
//   PORT=8871 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8871 PARTY_CLIENT_PORT=5271 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   SERVER_URL=http://localhost:8871 CLIENT_URL=http://localhost:5271 node tests/e2e/dress-flow.cjs
//
// Env: SIZES=320x568,390x844,430x932 (default: all three); TV_ONLY=1 only the TV lobby part;
//      NO_TV_LOBBY=1 skips it. Screenshots: tests/e2e/out/dress-flow/ (look at them: a layout
//      break is not an assertion). Exit code 1 when an assertion failed.
// The phones are opened with `dress=1` (tests/e2e/dress-lib.cjs): an automated browser skips
// the dressing-room step otherwise.
const fs = require('fs');
const path = require('path');
const L = require('./qa-phone-lib.cjs');
const D = require('./dress-lib.cjs');

const OUT = path.join(__dirname, 'out', 'dress-flow');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const { check, done } = L.makeChecker('dress');
const sleep = L.sleep;
const log = (...a) => console.log('[dress]', ...a);

const SIZES = (process.env.SIZES || '320x568,390x844,430x932').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number);
  return { w, h, tag: `s${w}` };
});
/** One name per size: the smallest phone gets the longest name the server allows (14 characters). */
const NAMES = { s320: 'שושנה דמארי 99', s390: 'דנה', s430: 'יוסי המלך' };
/** A look must reach the TV within this long after the tap (the room itself reports 400 ms after the last change). */
const LIVE_MS = 1000;

// ───────────────────────────── pages ─────────────────────────────

/** Every websocket of every page (diagnostics for a link that does not come up). */
const wsTrace = [];
function traceSockets(page) {
  page.on('websocket', (ws) => {
    const rec = { page: page.__name, url: ws.url().replace(/^ws:\/\/[^/]+/, '').slice(0, 44), at: Date.now(), first: null, closed: null, error: null, frames: [] };
    wsTrace.push(rec);
    const note = (dir, f) => {
      // never the payload of a join (it carries a name): only the packet type and the event name
      const text = typeof f.payload === 'string' ? f.payload : '<binary>';
      rec.frames.push(`${dir}+${Date.now() - rec.at}:${text.replace(/^(\d+)(\[\"[a-z:]+\")?.*$/s, '$1$2').slice(0, 24)}`);
      if (rec.frames.length > 14) rec.frames.shift();
    };
    ws.on('framesent', (f) => note('>', f));
    ws.on('framereceived', (f) => {
      if (rec.first === null) rec.first = Date.now();
      note('<', f);
    });
    ws.on('close', () => (rec.closed = Date.now()));
    ws.on('socketerror', (e) => (rec.error = String(e).slice(0, 60)));
  });
}
function dumpSockets(sinceMs) {
  const now = Date.now();
  return wsTrace
    .filter((r) => now - r.at < sinceMs || r.closed === null)
    .map((r) => `${r.page} ${r.url} +${r.at - now}ms ${r.first === null ? 'NO FRAME' : `first frame after ${r.first - r.at}ms`} ${r.closed === null ? 'open' : `closed after ${r.closed - r.at}ms`} ${r.error || ''}${now - r.at < 25000 && r.url.includes('socket.io') ? `\n      ${r.frames.join(' ')}` : ''}`)
    .join('\n   ');
}

async function openTv(browser, name = 'tv') {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.__name = name;
  page.__ctx = ctx;
  traceSockets(page);
  page.on('pageerror', (e) => check(false, `${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/cutscenes\/|favicon|net::ERR/.test(m.text() + (m.location().url || ''))) console.log(`  [${name} console]`, m.text().slice(0, 200));
  });
  await page.goto(L.CLIENT + '/host.html');
  await page.evaluate(() => localStorage.clear());
  await page.goto(L.CLIENT + '/host.html');
  await page.waitForSelector('[data-testid=room-code]', { timeout: 30000 });
  await sleep(400);
  const code = (await page.textContent('[data-testid=room-code]')).trim();
  await page.mouse.click(960, 40); // a first click unlocks the TV's sound
  return { page, code };
}

const tvState = (tv) => tv.evaluate(() => window.__host.state());
const tvPhase = async (tv) => (await tvState(tv)).phase;

/** The TV lobby chip of a player: the look it carries and whether that look's picture is on screen. */
function tvChip(tv, playerId) {
  return tv.evaluate((id) => {
    const chip = document.querySelector(`[data-testid=chip][data-player="${id}"]`);
    const av = chip ? chip.querySelector('.hs-chip-av') : null;
    if (!av) return null;
    const img = av.querySelector('img');
    return { look: av.dataset.look, drawn: av.dataset.drawn === '1' && !!img && img.complete && img.naturalWidth > 0, name: chip.querySelector('.hs-chip-name').textContent.trim() };
  }, playerId);
}

async function openPhone(browser, name, size, extra = {}) {
  const dev = L.devices['Pixel 7'];
  const page = await L.openPhone(
    browser,
    name,
    { ...dev, viewport: { width: size.w, height: size.h }, screen: { width: size.w, height: size.h }, deviceScaleFactor: size.w >= 390 ? 3 : 2 },
    extra,
    check,
  );
  traceSockets(page);
  return page;
}

/** Types the name on the join screen with touch + keys, and taps the join button (the user gesture). */
async function joinByTouch(page, code, name, opts = {}) {
  await page.goto(D.withDressing(`${L.CLIENT}/?room=${code}`));
  await L.waitScreen(page, 'join', 30000);
  await page.tap('.pp-name-input');
  await page.keyboard.type(name, { delay: 15 });
  if (opts.beforeTap) await opts.beforeTap();
  await page.tap('.pp-btn-go');
}

/** Screenshot + "the page cannot scroll, nothing sideways" for a screen the full audit does not fit (the dressing room). */
async function plainShot(page, label) {
  const file = path.join(OUT, `${page.__name}-${label}.png`);
  await page.screenshot({ path: file });
  const m = await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    return { sh: se.scrollHeight, sw: se.scrollWidth, H: innerHeight, W: innerWidth, sx: scrollX, sy: scrollY, scale: visualViewport ? visualViewport.scale : 1 };
  });
  check(m.sh <= m.H + 1 && m.sw <= m.W + 1 && m.sx === 0 && m.sy === 0 && m.scale === 1, `${page.__name}/${label}: no page scroll, nothing sideways (${m.sw}x${m.sh} in ${m.W}x${m.H})`);
  return file;
}

/** The dressing room fills the screen and all of its controls are on it. */
async function checkRoomLayout(page, label) {
  const r = await page.evaluate(() => {
    const W = innerWidth;
    const H = innerHeight;
    const box = (el) => {
      const b = el.getBoundingClientRect();
      return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const room = document.querySelector('.pw-dress .dr');
    const out = { W, H, room: room ? box(room) : null, off: [], small: [], mebar: !!document.querySelector('.pp-mebar.is-on') };
    for (const el of document.querySelectorAll('.dr-tab, .dr-btn, .dr-name, .dr-say')) {
      const b = box(el);
      if (b.l < -1 || b.t < -1 || b.r > W + 1 || b.b > H + 1) out.off.push(`${el.className} ${b.l},${b.t},${b.r},${b.b}`);
    }
    for (const el of document.querySelectorAll('.dr-tab, .dr-btn')) {
      const b = box(el);
      if (Math.min(b.w, b.h) < 43.5) out.small.push(`${el.className} ${b.w}x${b.h}`);
    }
    const stage = document.querySelector('.dr-stage');
    out.stage = stage ? box(stage) : null;
    out.tiles = document.querySelectorAll('.dr-shelf .dr-tile').length;
    return out;
  });
  check(r.room !== null && r.room.l === 0 && r.room.r === r.W && r.room.b === r.H && r.room.h >= 400, `${label}: the dressing room fills the screen (${JSON.stringify(r.room)} of ${r.W}x${r.H})`);
  check(r.off.length === 0, `${label}: every tab and button of the room is on the screen ${r.off.slice(0, 3).join(' | ')}`);
  check(r.small.length === 0, `${label}: the room's tabs and buttons are at least 44px ${r.small.slice(0, 3).join(' | ')}`);
  check(r.stage !== null && r.stage.h >= 150, `${label}: the doll has a stage (${r.stage ? r.stage.h : 0}px high)`);
  check(!r.mebar, `${label}: no me bar over the dressing room`);
  check(r.tiles >= 5, `${label}: the shelf has items (${r.tiles})`);
}

/** After a tap in the dressing room: how long until `target` shows `look` for that player. */
async function untilShown(read, look, t0, label) {
  let last = null;
  try {
    await D.waitFor(async () => {
      last = await read();
      return last !== null && last.look === look && last.drawn !== false;
    }, 5000, label);
  } catch {
    check(false, `${label}: never showed ${look} (shows ${JSON.stringify(last)})`);
    return null;
  }
  return Date.now() - t0;
}

/** The chip of another guest in a phone's waiting room. */
function phoneChip(page, playerId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`.pp-chip[data-player="${id}"], .pp-standings li[data-player="${id}"]`);
    if (!el) return null;
    const img = el.querySelector('.av img');
    return { look: el.dataset.look, drawn: !!img && img.complete && img.naturalWidth > 0 };
  }, playerId);
}

// ───────────────────────────── one phone size ─────────────────────────────

async function runSize(browser, size) {
  const tag = size.tag;
  log(`══ ${size.w}x${size.h} ══`);
  const { page: tv, code } = await openTv(browser, `tv-${tag}`);
  const name = NAMES[tag] || 'דנה';
  const A = await openPhone(browser, `${tag}-a`, size);
  const lat = [];

  // ── 1. the name ──
  await A.goto(D.withDressing(`${L.CLIENT}/?room=${code}`));
  await L.waitScreen(A, 'join', 30000);
  await sleep(1500); // the cover dolls are composed
  await L.setSafeArea(A, 0, 0);
  await L.shot(A, OUT, '01-join', check, { drag: true });
  const form = await A.evaluate(() => ({
    names: document.querySelectorAll('.pp-name-input').length,
    codes: document.querySelectorAll('.pp-code-input').length,
    buttons: document.querySelectorAll('.pw-join button[type=submit]').length,
    chip: document.querySelector('.pp-room-chip b')?.textContent,
    dolls: [...document.querySelectorAll('.pw-cover-dolls .av img')].filter((i) => i.complete && i.naturalWidth > 0).length,
  }));
  check(form.names === 1 && form.codes === 0 && form.buttons === 1 && form.chip === code, `${tag}: the join screen asks for the name only (the code ${form.chip} comes from the link), one button`);
  check(form.dolls === 3 || size.h < 640, `${tag}: the cover shows three dressed dolls (${form.dolls})`);

  // the on-screen keyboard: the visible page shrinks, the field and the button stay on it
  await A.tap('.pp-name-input');
  const kbH = Math.max(250, size.h - Math.round(size.h * 0.46));
  await A.setViewportSize({ width: size.w, height: kbH });
  await sleep(350);
  const kb = await A.evaluate(() => {
    const vis = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.height >= 44;
    };
    return { field: vis('.pp-name-input'), btn: vis('.pp-btn-go'), focus: document.activeElement === document.querySelector('.pp-name-input'), H: innerHeight };
  });
  check(kb.field && kb.btn && kb.focus, `${tag}: keyboard open (${size.w}x${kb.H} visible): the name field and the join button are both on screen ${JSON.stringify(kb)}`);
  await A.keyboard.type(name, { delay: 15 });
  await L.shot(A, OUT, '02-join-keyboard', check);
  check((await A.inputValue('.pp-name-input')) === name, `${tag}: the name is typed as given`);
  await A.setViewportSize({ width: size.w, height: size.h });
  await sleep(250);
  await L.shot(A, OUT, '02-join-typed', check);

  // the join tap is THE user gesture: sound, fullscreen, wake lock
  await A.tap('.pp-btn-go');
  const gesture = await D.waitFor(
    () => A.evaluate(() => (document.fullscreenElement !== null ? 'fullscreen' : null)),
    4000,
    'fullscreen from the join tap',
  ).catch(() => null);
  check(gesture === 'fullscreen', `${tag}: the join tap is still the user gesture (fullscreen entered)`);

  // ── 2. the dressing room ──
  await D.waitDressing(A);
  const a0 = await D.playerInfo(A);
  check(a0.screen === 'dressing' && a0.dressed === false && !a0.meBar, `${tag}: after the join the guest is in the dressing room, full screen (${JSON.stringify(a0)})`);
  check(typeof a0.look === 'string' && a0.look === a0.serverLook && a0.look !== '1.0.0.0.0.0.0', `${tag}: the guest starts with the doll the server gave (${a0.look})`);
  const chip0 = await D.waitFor(async () => {
    const c = await tvChip(tv, a0.id);
    return c && c.drawn ? c : null;
  }, 8000, 'TV chip').catch(() => null);
  check(chip0 !== null && chip0.look === a0.look && chip0.name === name, `${tag}: the TV lobby shows the guest with the same doll and the name as soon as they join (${JSON.stringify(chip0)})`);
  await sleep(1600);
  await checkRoomLayout(A, `${tag}/dressing`);
  check((await A.textContent('.dr-name')).trim() === name, `${tag}: the guest's name is on the doll's sticker`);
  await plainShot(A, '03-dressing');

  // dress: a hat, glasses, a plate; after every tap the TV lobby shows the same look
  // (a plate other than the one the doll already stands on)
  const steps = [
    ['HEAD', 3],
    ['EYES', 1],
    ['BG', (Number(a0.look.split('.')[1]) + 5) % 12],
  ];
  let look = a0.look;
  for (const [tab, n] of steps) {
    const before = await D.roomLook(A);
    const now = await D.tapItem(A, tab, n);
    const t0 = Date.now();
    check(now !== before, `${tag}: a tap on ${tab} #${n} changes the doll (${before} → ${now})`);
    const ms = await untilShown(() => tvChip(tv, a0.id), now, t0, `${tag}: TV after ${tab}`);
    if (ms !== null) lat.push(ms);
    look = now;
  }
  check(lat.length === 3 && Math.max(...lat) <= LIVE_MS, `${tag}: the TV lobby shows every change within ${LIVE_MS} ms of the tap (${lat.join(', ')} ms)`);
  await sleep(500);
  const a1 = await D.playerInfo(A);
  check(a1.look === look && a1.serverLook === look, `${tag}: the phone and the server hold the dressed look (${a1.look} / ${a1.serverLook})`);
  await plainShot(A, '04-dressing-changed');
  await tv.screenshot({ path: path.join(OUT, `tv-${tag}-lobby-1-dressing.png`) });

  // a reload in the middle: still in the dressing room, same player, same look
  await A.reload();
  try {
    await D.waitDressing(A);
  } catch (e) {
    console.log(`  [${tag}] stuck after the first reload: ${JSON.stringify(await D.playerInfo(A).catch(() => null))}\n  sockets:\n   ${dumpSockets(40000)}`);
    throw e;
  }
  const a2 = await D.playerInfo(A);
  check(a2.id === a0.id && a2.look === look && a2.dressed === false, `${tag}: a reload in the dressing room comes back to it with the look (${a2.look}, same player ${a2.id === a0.id})`);
  check((await D.roomLook(A)) === look, `${tag}: the room shows that look after the reload`);
  check((await tvState(tv)).players.length === 1, `${tag}: the reload did not add a player`);
  await L.setSafeArea(A, 47, 34); // a notch and a home indicator from here on
  await sleep(700);
  await checkRoomLayout(A, `${tag}/dressing with a notch`);
  await plainShot(A, '04-dressing-after-reload');

  // ── 3. the waiting room ──
  await D.finishDressing(A);
  await sleep(900);
  const a3 = await D.playerInfo(A);
  const wait = await A.evaluate(() => ({
    doll: document.querySelector('.pw-me-doll')?.dataset.look,
    dollDrawn: !!document.querySelector('.pw-me-doll .av img'),
    dollPx: Math.round(document.querySelector('.pw-me-doll .av')?.getBoundingClientRect().width || 0),
    name: document.querySelector('.pp-me-name')?.textContent.trim(),
    bar: document.querySelector('.pp-mebar [data-slot=me-avatar]')?.dataset.look,
    back: !!document.querySelector('.pw-redress'),
  }));
  check(a3.screen === 'lobby' && a3.dressed === true && a3.meBar, `${tag}: "מוכן!" leads to the waiting room (${JSON.stringify(a3)})`);
  check(wait.doll === look && wait.dollDrawn && wait.name === name && wait.bar === look && wait.back, `${tag}: the waiting room shows the dressed doll (${wait.dollPx}px), the name, the doll in the me bar and the way back (${JSON.stringify(wait)})`);
  check(wait.dollPx >= 56, `${tag}: the doll in the waiting room is big (${wait.dollPx}px)`);
  await L.shot(A, OUT, '05-waiting-alone', check, { drag: true });

  // ── a second phone ──
  const B = await openPhone(browser, `${tag}-b`, size);
  await joinByTouch(B, code, 'יוסי');
  await D.waitDressing(B);
  const b0 = await D.playerInfo(B);
  // B is still dressing: A's waiting room already has B's chip, with the doll B was given
  const bOnA = await D.waitFor(async () => {
    const c = await phoneChip(A, b0.id);
    return c && c.drawn ? c : null;
  }, 6000, 'B on A').catch(() => null);
  check(bOnA !== null && bOnA.look === b0.look, `${tag}: the first phone sees the second guest with their doll while they dress (${JSON.stringify(bOnA)})`);
  const bNow = await D.tapItem(B, 'HEAD', 5);
  const tB = Date.now();
  const msB = await untilShown(() => phoneChip(A, b0.id), bNow, tB, `${tag}: A's waiting room after B's tap`);
  check(msB !== null && msB <= LIVE_MS, `${tag}: the other phone shows a change within ${LIVE_MS} ms (${msB} ms)`);
  await D.finishDressing(B);
  await sleep(700);
  const aOnB = await phoneChip(B, a0.id);
  check(aOnB !== null && aOnB.look === look && aOnB.drawn, `${tag}: the second phone sees the first one's dressed doll (${JSON.stringify(aOnB)})`);
  await L.shot(B, OUT, '06-waiting-second-phone', check);
  await L.shot(A, OUT, '06-waiting-two', check);

  // ── back to the dressing room, and a reload after it ──
  await A.tap('.pw-redress');
  await D.waitDressing(A);
  const a4 = await D.playerInfo(A);
  check(a4.screen === 'dressing' && a4.dressing === true && !a4.meBar, `${tag}: the waiting room's button goes back to the dressing room`);
  check((await D.roomLook(A)) === look, `${tag}: the room opens with the look the guest has`);
  await A.tap('.dr-rand'); // "הפתע אותי"
  const t1 = Date.now();
  const look2 = await D.waitFor(async () => {
    const l = await D.roomLook(A);
    return l !== look ? l : null;
  }, 4000, 'a new look').catch(() => null);
  check(look2 !== null, `${tag}: "הפתע אותי" changes the doll (${look} → ${look2})`);
  const ms2 = await untilShown(() => phoneChip(B, a0.id), look2, t1, `${tag}: B's waiting room after A's change`);
  const ms3 = await untilShown(() => tvChip(tv, a0.id), look2, t1, `${tag}: TV after A's change`);
  check(ms2 !== null && ms3 !== null && Math.max(ms2, ms3) <= LIVE_MS + 300, `${tag}: a change made on the way back reaches the other phone and the TV (${ms2} / ${ms3} ms)`);
  await sleep(900);
  await plainShot(A, '07-redress');
  await D.finishDressing(A);
  await sleep(600);
  check((await A.evaluate(() => document.querySelector('.pw-me-doll')?.dataset.look)) === look2, `${tag}: back in the waiting room with the new look`);
  const trace = [];
  const stamp = () => String(Date.now() % 100000).padStart(5, '0');
  A.on('websocket', (ws) => {
    trace.push(`${stamp()} ws open ${ws.url().slice(0, 70)}`);
    ws.on('close', () => trace.push(`${stamp()} ws close ${ws.url().slice(0, 40)}`));
    ws.on('socketerror', (e) => trace.push(`${stamp()} ws error ${e}`));
  });
  A.on('requestfailed', (r) => trace.push(`${stamp()} request failed ${r.url().slice(0, 90)} ${r.failure() ? r.failure().errorText : ''}`));
  A.on('console', (m) => trace.push(`${stamp()} console ${m.type()} ${m.text().slice(0, 160)}`));
  trace.push(`${stamp()} reload`);
  await A.reload();
  trace.push(`${stamp()} loaded`);
  try {
    await L.waitScreen(A, ['lobby', 'dressing'], 20000);
  } catch (e) {
    const snap = await A.evaluate(() => (window.__player ? { screen: window.__player.screen, status: window.__player.snap.status, online: window.__player.snap.online, state: !!window.__player.snap.state } : null)).catch((err) => String(err));
    console.log(`  [${tag}] stuck after the reload: ${JSON.stringify(snap)}\n   ${trace.join('\n   ')}\n  sockets:\n   ${dumpSockets(40000)}`);
    throw e;
  }
  await sleep(600);
  const a5 = await D.playerInfo(A);
  check(a5.screen === 'lobby' && a5.look === look2 && a5.dressed === true && a5.id === a0.id, `${tag}: a reload after dressing lands in the waiting room with the look (${JSON.stringify(a5)})`);
  look = look2;

  // ── a third phone is still dressing when the owner starts a round ──
  const C = await openPhone(browser, `${tag}-c`, size);
  await joinByTouch(C, code, 'מיכל');
  await D.waitDressing(C);
  const c0 = await D.playerInfo(C);
  await sleep(800);
  await tv.screenshot({ path: path.join(OUT, `tv-${tag}-lobby-3.png`) });
  // a bot that scores, so the TV's race has rows (a row appears with the first score of the round)
  const bot = await L.addBots(code, 1, 'בוט', () => 1234);
  await D.waitFor(async () => (await tvState(tv)).players.length === 4, 8000, 'the bot');
  const cLook = await D.tapItem(C, 'HEAD', 7); // ...the room has not even reported this one yet...
  await tv.click('[data-testid=game-icy]', { force: true }); // ...and the round starts
  const tStart = Date.now();
  const seenC = [];
  await D.waitFor(async () => {
    const s = (await D.playerInfo(C)).screen;
    if (seenC[seenC.length - 1] !== s) seenC.push(s);
    return s === 'intro';
  }, 6000, 'C intro').catch(() => null);
  const tookOver = Date.now() - tStart;
  const c1 = await D.playerInfo(C);
  check(c1.screen === 'intro' && (await C.locator('.dr').count()) === 0, `${tag}: the round takes the dressing room over at once (${tookOver} ms, saw ${seenC.join(' → ')})`);
  const saved = await D.waitFor(async () => {
    const p = (await tvState(tv)).players.find((x) => x.id === c0.id);
    return p && p.look === cLook ? p.look : null;
  }, 2000, 'C look saved').catch(() => null);
  check(saved === cLook && cLook !== c0.look, `${tag}: the look of the last tap before the round is saved on the server (${c0.look} → ${cLook}, server ${saved}, ${Date.now() - tStart} ms after the start)`);
  check(c1.dressed === true, `${tag}: a guest the round took over counts as dressed`);
  await C.screenshot({ path: path.join(OUT, `${C.__name}-08-round-took-over.png`) });
  check(['intro', 'countdown'].includes((await D.playerInfo(A)).screen), `${tag}: the phones in the waiting room are in the round too`);

  // ── a guest who joins in the middle of the round ──
  const E = await openPhone(browser, `${tag}-late`, size);
  const seenE = [];
  await joinByTouch(E, code, 'מאחרת');
  await D.waitFor(async () => {
    const i = await D.playerInfo(E);
    if (i && seenE[seenE.length - 1] !== i.screen) seenE.push(i.screen);
    return i && i.screen === 'late';
  }, 10000, 'late screen').catch(() => null);
  const e0 = await D.playerInfo(E);
  check(e0.screen === 'late' && !seenE.includes('dressing') && e0.dressed === false, `${tag}: a guest who joins mid-round gets no dressing room in the way (${seenE.join(' → ')})`);
  const eLook = await D.waitFor(async () => (await tvState(tv)).players.find((x) => x.id === e0.id)?.look, 5000, 'the late guest on the TV').catch(() => undefined);
  check(typeof eLook === 'string' && eLook === e0.look && eLook !== '1.0.0.0.0.0.0', `${tag}: the late guest has a doll of their own meanwhile (${eLook})`);
  await L.shot(E, OUT, '09-late-joiner', check);

  // the round on the TV: the scoreboard rows carry the dolls
  await D.waitFor(async () => (await tvPhase(tv)) === 'playing', 12000, 'playing');
  await sleep(2500);
  const board = await tv.evaluate(() => [...document.querySelectorAll('.sh-row .sh-avatar')].map((el) => ({ look: el.dataset.look || null, img: !!el.querySelector('img') })));
  const stPlay = await tvState(tv);
  check(board.length === 4 && board.every((r) => r.img && stPlay.players.some((p) => p.look === r.look)), `${tag}: the TV scoreboard shows the dolls of everybody in the round (${JSON.stringify(board)})`);
  await tv.screenshot({ path: path.join(OUT, `tv-${tag}-playing.png`) });
  check(!seenE.includes('dressing') && (await D.playerInfo(E)).screen === 'late', `${tag}: the late guest still waits, without a dressing room`);

  // ── results, then back to the lobby ──
  await D.waitFor(async () => (await tvPhase(tv)) === 'results', 40000, 'results');
  await tv.waitForSelector('.sh-results--standings', { timeout: 40000 });
  await sleep(1500);
  const stand = await tv.evaluate(() => [...document.querySelectorAll('[data-testid=standings-card] .sh-avatar')].map((el) => ({ look: el.dataset.look || null, img: !!el.querySelector('img') })));
  check(stand.length === 5 && stand.every((r) => r.img && r.look), `${tag}: the TV standings show a doll for all five (${stand.length})`);
  await tv.screenshot({ path: path.join(OUT, `tv-${tag}-standings.png`) });
  check((await D.playerInfo(E)).screen !== 'dressing', `${tag}: no dressing room during the results either (${(await D.playerInfo(E)).screen})`);
  await L.waitScreen(A, 'results', 20000);
  await sleep(1600);
  const resA = await A.evaluate(() => ({ rows: document.querySelectorAll('.pp-top3 li .av').length, imgs: document.querySelectorAll('.pp-top3 li .av img').length }));
  check(resA.rows >= 3 && resA.imgs === resA.rows, `${tag}: the phone's round table shows dolls (${JSON.stringify(resA)})`);
  await L.shot(A, OUT, '10-results', check, { allowOverlap: true });

  await tv.click('[data-testid=btn-primary]', { force: true });
  await D.waitFor(async () => (await tvPhase(tv)) === 'lobby', 10000, 'lobby again');
  // the late guest dresses now; everybody else is in the waiting room with the table
  await D.waitDressing(E);
  check((await D.playerInfo(E)).dressed === false, `${tag}: back in the lobby the late guest gets the dressing room`);
  await sleep(1200);
  await plainShot(E, '11-late-joiner-dresses');
  const eNew = await D.tapItem(E, 'HEAD', 2);
  await D.finishDressing(E);
  await L.waitScreen(A, 'lobby', 10000);
  await L.waitScreen(C, 'lobby', 10000);
  await sleep(900);
  const table = await A.evaluate(() => [...document.querySelectorAll('.pp-standings li')].map((li) => ({ id: li.dataset.player, look: li.dataset.look, img: !!li.querySelector('.av img') })));
  const stEnd = await tvState(tv);
  check(table.length === 5 && table.every((r) => r.img && r.id !== undefined), `${tag}: between rounds the phone's table has a doll in every row (${table.length})`);
  check(stEnd.players.find((p) => p.id === e0.id)?.look === eNew, `${tag}: the late guest's look is on the server after they dressed (${eNew})`);
  check((await D.playerInfo(C)).screen === 'lobby', `${tag}: the guest the round took over is in the waiting room now, not back in the dressing room`);
  await L.shot(A, OUT, '12-waiting-between-rounds', check, { drag: true });
  await L.shot(C, OUT, '12-waiting-between-rounds', check);
  await tv.screenshot({ path: path.join(OUT, `tv-${tag}-lobby-between.png`) });
  const panel = await tv.evaluate(() => [...document.querySelectorAll('[data-testid=panel-card] .sh-avatar')].map((el) => !!el.querySelector('img')));
  check(panel.length === 5 && panel.every(Boolean), `${tag}: the TV's table between rounds shows the dolls (${panel.length})`);

  bot.close();
  for (const p of [A, B, C, E, tv]) await p.__ctx.close();
  log(`${tag}: TV latencies after a tap: ${lat.join(', ')} ms; other phone ${msB} ms; redress ${ms2} / ${ms3} ms; takeover ${tookOver} ms`);
}

// ───────────────────────────── the TV lobby, 2 to 60 guests ─────────────────────────────

async function runTvLobby(browser) {
  log('══ TV lobby ══');
  const { page: tv, code } = await openTv(browser, 'tv-lobby');
  const names = ['דנה', 'יוסי המלך', 'מיכל', 'אבי', 'שושנה דמארי 99', 'Guest 6', 'נועה', 'איתי', 'רוני 🎉', 'תמר', 'עומר', 'יעל', 'גיא', 'הילה', 'אלון', 'שירה', 'בועז', 'מאיה', 'ניר', 'ליאת'];
  const groups = [];
  let total = 0;
  for (const n of [2, 3, 8, 20, 24, 25, 40, 60]) {
    const add = n - total;
    const from = total;
    groups.push(await L.addBots(code, add, (i) => names[from + i] || `אורח ${from + i + 1}`));
    total = n;
    await D.waitFor(async () => (await tvState(tv)).players.length === n, 20000, `${n} players`);
    // every doll is drawn
    const drawn = await D.waitFor(async () => {
      const c = await tv.evaluate(() => [...document.querySelectorAll('[data-testid=chip] .hs-chip-av')].map((el) => el.dataset.drawn === '1' && !!el.querySelector('img')));
      return c.length === (await tvState(tv)).players.length && c.every(Boolean) ? c.length : null;
    }, 20000, `${n} dolls drawn`).catch(() => null);
    check(drawn === n, `TV lobby ${n}: every guest has a drawn doll (${drawn})`);
    await sleep(900);
    const m = await tv.evaluate(() => {
      const box = document.querySelector('[data-testid=chips]');
      const b = box.getBoundingClientRect();
      const chips = [...box.querySelectorAll('[data-testid=chip]')];
      const out = chips.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1;
      }).length;
      const av = chips[0].querySelector('.hs-chip-av').getBoundingClientRect();
      const name = chips[0].querySelector('.hs-chip-name');
      return {
        cards: box.classList.contains('is-cards'),
        out,
        sh: box.scrollHeight,
        ch: box.clientHeight,
        doll: Math.round(av.width),
        font: parseFloat(getComputedStyle(name).fontSize),
        looks: chips.map((c) => c.querySelector('.hs-chip-av').dataset.look),
        cut: chips.filter((c) => {
          const el = c.querySelector('.hs-chip-name');
          return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2;
        }).length,
      };
    });
    const dolls = new Set(m.looks.map((l) => l.replace(/^\d+\.\d+\./, '')));
    check(m.out === 0 && m.sh <= m.ch + 1, `TV lobby ${n}: every chip is inside the players area (${m.out} outside, ${m.sh}/${m.ch})`);
    check(dolls.size === n, `TV lobby ${n}: no two guests start with the same doll (${dolls.size} different)`);
    check(m.doll >= (m.cards ? 80 : 34) && m.font >= 18 && m.cut === 0, `TV lobby ${n}: readable from the sofa (${m.cards ? 'cards' : 'pills'}, doll ${m.doll}px, name ${m.font.toFixed(1)}px, ${m.cut} names cut)`);
    await tv.screenshot({ path: path.join(OUT, `tv-lobby-${String(n).padStart(2, '0')}.png`) });
  }
  // a guest in a full room changes the look: the TV follows, by a small message
  const first = groups[0].bots[0];
  const t0 = Date.now();
  const wanted = '1.8.8-17.9.0.11.7';
  first.s.emit('player:look', { look: wanted }, () => undefined);
  const ms = await untilShown(() => tvChip(tv, first.id), wanted, t0, 'TV lobby 60: a look change');
  check(ms !== null && ms <= LIVE_MS, `TV lobby 60: a look change shows within ${LIVE_MS} ms (${ms} ms)`);
  for (const g of groups) g.close();
  await tv.__ctx.close();
}

(async () => {
  const browser = await L.launch();
  try {
    if (process.env.TV_ONLY !== '1') for (const size of SIZES) await runSize(browser, size);
    if (process.env.NO_TV_LOBBY !== '1') await runTvLobby(browser);
  } catch (e) {
    check(false, `flow: ${e.message}`);
    console.error(e);
  }
  await browser.close();
  const failed = done();
  process.exit(failed ? 1 : 0);
})();
