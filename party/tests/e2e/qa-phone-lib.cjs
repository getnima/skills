// Shared helpers for the qa-phone-* scripts (phone QA outside the games).
//
//   PARTY_SERVER_PORT=8812 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8812 PARTY_CLIENT_PORT=5212 npx vite
//
// SERVER_URL / CLIENT_URL override the defaults below.
const { chromium, devices } = require('playwright');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const SERVER = process.env.SERVER_URL || 'http://localhost:8812';
const CLIENT = process.env.CLIENT_URL || 'http://localhost:5212';
const OUT_ROOT = path.join(__dirname, 'out', 'qa-phone');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeChecker(tag) {
  const failures = [];
  let passed = 0;
  function check(cond, msg) {
    if (!cond) {
      failures.push(msg);
      console.log(`  ✗ [${tag}]`, msg);
    } else {
      passed++;
      if (!process.env.QUIET) console.log(`  ✓ [${tag}]`, msg);
    }
    return !!cond;
  }
  function done() {
    console.log(failures.length ? `\n[${tag}] FAILED ${failures.length} (passed ${passed}):\n - ${failures.join('\n - ')}` : `\n[${tag}] ALL OK (${passed} checks)`);
    return failures.length;
  }
  return { check, failures, done };
}

/** The named phones of the brief (+ a tablet). */
const PHONES = {
  se320: { ...devices['iPhone SE'] },
  se375: { ...devices['iPhone SE (3rd gen)'] },
  iphone14: { ...devices['iPhone 14'] },
  promax: { ...devices['iPhone 14 Pro Max'] },
  pixel7: { ...devices['Pixel 7'] },
  s8: { ...devices['Galaxy S8'] },
  a360: { ...devices['Galaxy S8'], viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 } },
  ipadmini: { ...devices['iPad Mini'] },
};

// ───────── host / bots over raw sockets ─────────
function sock() {
  return io(SERVER, { transports: ['websocket'], forceNew: true });
}

function caller(s) {
  return (ev, req) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ack timeout ' + ev)), 6000);
      s.emit(ev, req, (res) => {
        clearTimeout(t);
        if (!res.ok) reject(new Error(ev + ': ' + res.error + ' ' + res.message));
        else resolve(res);
      });
    });
}

function createHost() {
  const s = sock();
  let state = null;
  s.on('state', (st) => (state = st));
  const call = caller(s);
  // The TV would end cutscenes by itself; a test ends them on purpose.
  return { socket: s, call, state: () => state, close: () => s.close() };
}

/** n idle bots (join and stay). `scoreOf(i)` → when set, they also send that score while playing. */
async function addBots(code, n, prefix, scoreOf) {
  const bots = [];
  for (let i = 0; i < n; i++) {
    const s = sock();
    const call = caller(s);
    const name = typeof prefix === 'function' ? prefix(i) : `${prefix}${i + 1}`;
    const res = await call('player:join', { code, name });
    const bot = { s, id: res.playerId };
    if (scoreOf) {
      s.on('state', (st) => {
        if (st.phase === 'playing' && st.round && !bot.sent) {
          bot.sent = st.round.index;
          s.emit('player:score', { round: st.round.index, score: scoreOf(i) });
        }
        if (st.phase !== 'playing') bot.sent = null;
      });
    }
    bots.push(bot);
  }
  return { bots, close: () => bots.forEach((b) => b.s.close()) };
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try {
      last = await fn();
      if (last) return last;
    } catch {}
    await sleep(50);
  }
  throw new Error('timeout: ' + label);
}

// ───────── phone pages ─────────
async function openPhone(browser, name, device, extra = {}, check) {
  const { initScript, ...options } = extra;
  const ctx = await browser.newContext({ ...device, ...options });
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  page.__name = name;
  page.__ctx = ctx;
  page.__errors = [];
  page.on('pageerror', (e) => {
    page.__errors.push(e.message);
    if (check) check(false, `${name} pageerror: ${e.message}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|ERR_INTERNET_DISCONNECTED|net::ERR|WebSocket/.test(m.text())) console.log(`  [${name} console]`, m.text().slice(0, 200));
  });
  return page;
}

async function cdp(page) {
  if (!page.__cdp) page.__cdp = await page.__ctx.newCDPSession(page);
  return page.__cdp;
}

/** Notch + home indicator, through Chromium's safe-area emulation (falls back to nothing). */
async function setSafeArea(page, top, bottom, left = 0, right = 0) {
  try {
    const c = await cdp(page);
    await c.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, bottom, left, right } });
    return true;
  } catch (e) {
    return false;
  }
}

async function screen(page) {
  try {
    return await page.evaluate(() => (window.__player ? window.__player.screen : null));
  } catch {
    return null;
  }
}

async function waitScreen(page, name, ms = 15000) {
  const want = Array.isArray(name) ? name : [name];
  try {
    await waitFor(async () => want.includes(await screen(page)), ms, '');
  } catch {
    throw new Error(`timeout: ${page.__name} screen ${want.join('|')} (now ${await screen(page)})`);
  }
}

async function join(page, code, name) {
  await page.goto(`${CLIENT}/?room=${code}`);
  await waitScreen(page, 'join');
  await page.fill('.pp-name-input', name);
  await page.tap('.pp-btn-go').catch(() => page.click('.pp-btn-go'));
  await waitScreen(page, ['lobby', 'late', 'intro', 'countdown', 'playing', 'results', 'suspense', 'final']);
}

/** Layout audit of the current screen: page scroll, clipping, tiny tap targets, small inputs, overlaps. */
async function audit(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const vv = window.visualViewport;
    const VH = vv ? vv.height : H;
    const decor = '.kit-scroll, .pp-confetti, .pp-rays, .pp-spot, .pa-stage-game, .pp-tv-legs, .pp-me-glow, .pp-prize-shine, .pp-dots, .pp-eq';
    const out = { clipped: [], small: [], inputs: [], overlaps: [], inner: [] };
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      let n = el;
      while (n && n !== document.body) {
        const c = getComputedStyle(n);
        if (Number(c.opacity) < 0.05 || c.display === 'none') return false;
        n = n.parentElement;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const topLayer = document.querySelector('.pp-landscape .pp-rotate, .pp-cutscene, .pp-countdown, .pp-resume');
    const leaves = [];
    for (const el of document.querySelectorAll('#app *')) {
      if (el.closest(decor)) continue;
      if (topLayer && !topLayer.contains(el) && !el.closest('.pp-banner')) continue; // covered by a full-screen layer
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const isCtl = /^(BUTTON|INPUT)$/.test(el.tagName);
      if (isCtl) {
        if (Math.min(r.width, r.height) < 43.5) out.small.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
        if (el.tagName === 'INPUT') {
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 16) out.inputs.push(`${el.className} ${fs}px`);
        }
      }
      const leaf = isCtl || el.children.length === 0 || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
      if (!leaf) continue;
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > VH + 1) {
        out.clipped.push(`${el.tagName}.${el.className} "${(el.textContent || '').trim().slice(0, 18)}" ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
      // text cut by an ellipsis is fine; text cut by an overflow box is not
      if (el.tagName !== 'INPUT' && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).textOverflow !== 'ellipsis' && getComputedStyle(el).overflow !== 'visible') {
        out.inner.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
      }
      // a star sticker (.pw-burst) is pinned over a corner of what it decorates: on purpose, so it is
      // checked for being on the screen (above) but not for overlapping the text next to it
      if (((el.textContent || '').trim() !== '' || isCtl) && !el.closest('.pw-burst')) leaves.push({ el, r, rs: [...el.getClientRects()] });
    }
    // screens that cut their own content (overflow hidden)
    for (const s of document.querySelectorAll('.pp-screen, .pp-join-card, .pp-res-card, .pp-panel:not(.pp-grow)')) {
      const box = s.getBoundingClientRect();
      for (const el of s.querySelectorAll('*')) {
        if (el.closest(decor) || !visible(el)) continue;
        if (getComputedStyle(el).position === 'absolute' && el.parentElement === s) continue; // decorations of the screen itself
        const r = el.getBoundingClientRect();
        if (r.bottom > box.bottom + 2 || r.top < box.top - 2 || r.left < box.left - 2 || r.right > box.right + 2) {
          out.inner.push(`${s.className.split(' ').slice(0, 2).join('.')} cuts ${el.className || el.tagName} ${Math.round(r.top)}..${Math.round(r.bottom)} of ${Math.round(box.top)}..${Math.round(box.bottom)}`);
          break;
        }
      }
    }
    // overlaps between leaf texts (not ancestors of each other)
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i];
        const b = leaves[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // per line box: a wrapped inline element is several rects, not its bounding box
        const hit = a.rs.some((ra) => b.rs.some((rb) => Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 4 && Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 4));
        if (hit) {
          const nm = (e) => `${e.className || e.tagName}"${(e.textContent || '').trim().slice(0, 10)}"`;
          out.overlaps.push(`${nm(a.el)} × ${nm(b.el)}`);
        }
      }
    }
    return {
      W,
      H,
      VH,
      sh: se.scrollHeight,
      sw: se.scrollWidth,
      sy: window.scrollY,
      sx: window.scrollX,
      scale: vv ? vv.scale : 1,
      ...out,
    };
  });
}

/** Drag a finger across the page (CDP touch) and report whether anything moved. */
async function dragProbe(page) {
  const c = await cdp(page);
  const vp = page.viewportSize();
  const x = Math.round(vp.width / 2);
  const y0 = Math.round(vp.height * 0.3);
  const before = await page.evaluate(() => ({ y: scrollY, x: scrollX, top: visualViewport ? visualViewport.offsetTop : 0, pt: visualViewport ? visualViewport.pageTop : 0, sc: visualViewport ? visualViewport.scale : 1 }));
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 8; i++) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 10, y: y0 + i * 40 }] });
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  for (let i = 1; i <= 8; i++) {
    /* the other way (upwards) */
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 + 300 }] });
  for (let i = 1; i <= 8; i++) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 10, y: y0 + 300 - i * 40 }] });
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
  const after = await page.evaluate(() => ({ y: scrollY, x: scrollX, top: visualViewport ? visualViewport.offsetTop : 0, pt: visualViewport ? visualViewport.pageTop : 0, sc: visualViewport ? visualViewport.scale : 1 }));
  return { before, after, moved: JSON.stringify(before) !== JSON.stringify(after) };
}

/** Screenshot + audit + assertions. Returns the png path. */
async function shot(page, dir, label, check, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${page.__name}-${label}.png`);
  await page.screenshot({ path: file });
  const a = await audit(page);
  const n = `${page.__name}/${label}`;
  check(a.sh <= a.H + 1 && a.sw <= a.W + 1 && a.sy === 0 && a.sx === 0, `${n}: no page scroll (${a.sw}x${a.sh} in ${a.W}x${a.H}, at ${a.sx},${a.sy})`);
  check(a.scale === 1, `${n}: not zoomed (${a.scale})`);
  check(a.clipped.length === 0, `${n}: nothing outside the visible viewport ${a.clipped.slice(0, 3).join(' | ')}`);
  if (!opts.allowInner) check(a.inner.length === 0, `${n}: no content cut inside a box ${a.inner.slice(0, 3).join(' | ')}`);
  if (!opts.allowSmall) check(a.small.length === 0, `${n}: tap targets >= 44px ${a.small.slice(0, 3).join(' | ')}`);
  check(a.inputs.length === 0, `${n}: inputs >= 16px ${a.inputs.join(' | ')}`);
  if (!opts.allowOverlap) check(a.overlaps.length === 0, `${n}: no overlapping text ${a.overlaps.slice(0, 3).join(' | ')}`);
  if (opts.drag) {
    const d = await dragProbe(page);
    check(!d.moved, `${n}: touch drag does not move the page ${JSON.stringify(d.after)}`);
  }
  return file;
}

/** Leave the Fullscreen API (the join tap enters it in Chromium) so the viewport can be resized. */
async function exitFs(page) {
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
  await sleep(150);
}

async function resize(page, size) {
  await exitFs(page);
  await page.setViewportSize(size);
}

async function launch() {
  return chromium.launch();
}

module.exports = {
  SERVER,
  CLIENT,
  OUT_ROOT,
  PHONES,
  devices,
  sleep,
  makeChecker,
  createHost,
  addBots,
  waitFor,
  openPhone,
  cdp,
  setSafeArea,
  screen,
  waitScreen,
  join,
  audit,
  dragProbe,
  shot,
  exitFs,
  resize,
  launch,
};
