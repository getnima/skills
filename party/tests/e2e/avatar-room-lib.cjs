// Shared helpers for the dressing-room checks (avatar-room*.cjs).
// The lab mounts the room at /avatar-lab.html?view=room inside a 430 x 760 box on a scrolling page.
// To see the room as the phone will show it, `phone()` turns that box into a fixed full-viewport
// container and loads the phone app's global lock-down (client/src/kit/base.css), exactly like the
// waiting screen will. Nothing in the lab is edited.
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.ROOM_PORT || 5295);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(__dirname, 'out', 'avatar-room');
fs.mkdirSync(OUT, { recursive: true });

const SIZES = [
  { name: '320x568', width: 320, height: 568 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '360x640', width: 360, height: 640 },
  { name: '412x915', width: 412, height: 915 },
];

/** CSS that makes the lab's room box the whole phone screen (optionally under a fake lobby header). */
function phoneCss(headerPx) {
  return `
    .lab-bar, .lab-card { display: none !important; }
    .lab-main { padding: 0 !important; }
    .lab-room { position: fixed !important; left: 0; right: 0; bottom: 0; top: ${headerPx}px; width: 100% !important; max-width: none !important;
      height: auto !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; z-index: 50; }
    ${headerPx > 0 ? `body::before { content: 'לובי · מחכים לעוד 3 אורחים'; position: fixed; inset: 0 0 auto 0; height: ${headerPx}px; z-index: 60; display: grid; place-items: center;
      background: #10238C; color: #FFD21F; font: 700 20px/1 Motaleh, system-ui; border-bottom: 3px solid #16120E; }` : ''}
  `;
}

async function openRoom(browser, size, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: opts.dpr || 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: opts.reducedMotion || 'no-preference',
    locale: 'he-IL',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const look = opts.look ? `&look=${opts.look}` : '&look=1.0.0.0.0.0.0';
  await page.goto(`${BASE}/avatar-lab.html?view=room${look}`, { waitUntil: 'load' });
  if (opts.phone !== false) {
    await page.addStyleTag({ url: `${BASE}/src/kit/base.css` }).catch(() => errors.push('base.css not loaded'));
    await page.addStyleTag({ content: phoneCss(opts.header || 0) });
  }
  await page.waitForSelector('.dr .dr-rig', { timeout: 30000 });
  await page.waitForTimeout(opts.settle ?? 600);
  return { ctx, page, errors };
}

/** The look the lab holds (updated by the room's onChange). */
async function labLook(page) {
  return page.$eval('#room-look', (e) => e.textContent.trim()).catch(() => null);
}

/** The lab's onDone tag text, or null. */
async function labDone(page) {
  return page.evaluate(() => {
    const t = [...document.querySelectorAll('.lab-tag')].find((e) => e.textContent.startsWith('onDone:'));
    return t ? t.textContent.replace('onDone:', '').trim() : null;
  });
}

async function probe(page) {
  return page.evaluate(() => {
    const p = window.__dressingRoom;
    return p ? { look: p.look, flying: p.flying, mode: p.mode, changes: p.changes, lastChange: p.lastChange, lastDone: p.lastDone, thumbs: p.thumbs() } : null;
  });
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Touch tap at the centre of an element (real touch events through CDP). */
async function tapEl(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

module.exports = { BASE, OUT, SIZES, openRoom, labLook, labDone, probe, shot, tapEl, phoneCss };
