// QA of the Plotzel round: the embed under every failure the real site could have,
// the self-report bar, the "play here" safety net, and the builtin game on every phone size.
//
//   PARTY_SERVER_PORT=8823 PARTY_CLIENT_PORT=5223 npx vite
//   node tests/e2e/fixtures/plotzel-standin.cjs 5233
//   node tests/e2e/qa-plotzel-play.cjs [section...]
//     sections: blocked hang slow tall keyboard evil report switch sizes flip readme
// Screenshots: tests/e2e/out/qa-plotzel/
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.PZ_BASE || 'http://localhost:5223';
const SITE = process.env.PZ_SITE || 'http://127.0.0.1:5233';
const OUT = path.join(__dirname, 'out', 'qa-plotzel');
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
let passed = 0;
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (ok) passed++;
  else fails.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c] || c;
const custom = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 14'].userAgent });

const party = (page) =>
  page.evaluate(() => ({ score: window.__party.score, ended: window.__party.ended, frozen: window.__party.frozen, leftMs: window.__party.leftMs }));
const embedState = (page) => page.evaluate(() => document.querySelector('.pze')?.dataset.state ?? (document.querySelector('.pz') ? 'builtin-mounted' : null));
const finishedOverlay = (page) => page.evaluate(() => !!document.querySelector('.pa-overlay.is-on'));
const visible = (page, sel) =>
  page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return false;
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom <= innerHeight + 0.5 && r.top >= 0;
  }, sel);
const layout = (page, scope) =>
  page.evaluate((scope) => {
    window.scrollTo(0, 300);
    const de = document.documentElement;
    let out = 0;
    for (const el of document.querySelectorAll(`${scope} *`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5)) out++;
    }
    return { scrollY: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight, out };
  }, scope);
const noScroll = (l) => l.scrollY === 0 && l.sw <= l.iw && l.sh <= l.ih && l.out === 0;

async function logic(page, fn, ...args) {
  return page.evaluate(
    async ({ fn, args }) => {
      const m = await import('/src/games/plotzel/logic.ts');
      return m[fn](...args);
    },
    { fn, args },
  );
}

async function open(browser, device, url, name) {
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const ev = { errors: [], dialogs: 0, popups: 0 };
  page.on('console', (m) => {
    // a cross-origin frame that refuses to be framed logs its own error: that is the scenario, not a bug
    if (m.type() === 'error' && !/X-Frame-Options|frame-ancestors|Unsafe attempt to initiate navigation|Ignored call to 'alert\(\)'|ERR_|blocked/i.test(m.text())) ev.errors.push(m.text());
  });
  page.on('pageerror', (e) => ev.errors.push('pageerror ' + e.message));
  page.on('dialog', (d) => {
    ev.dialogs++;
    void d.dismiss();
  });
  context.on('page', () => ev.popups++);
  // the harness' own tool buttons sit over the bottom-left of the bar; tests freeze through __party
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.dv-tools{display:none!important}';
      document.head.appendChild(st);
    });
  });
  await page.goto(`${BASE}${url}`);
  const shot = (f) => page.screenshot({ path: path.join(OUT, `${name}-${f}.png`) });
  return { context, page, ev, shot };
}
const embedUrl = (route, dur = 60000, seed = 7) =>
  `/dev.html?game=plotzel&seed=${seed}&duration=${dur}&plotzel=embed&plotzelUrl=${encodeURIComponent(`${SITE}/${route}`)}`;

// ───────────────────────────── blocked: XFO / CSP ─────────────────────────────
async function blocked(browser, route, device, name) {
  const { context, page, ev, shot } = await open(browser, device, embedUrl(route), name);
  await page.waitForSelector('.pze');
  const t0 = Date.now();
  await page.waitForFunction(() => {
    const l = document.querySelector('.pze-link');
    return l && !l.hidden && l.getBoundingClientRect().height > 0;
  });
  check(`${name} "play here" link visible within 1 s`, Date.now() - t0 < 1000, Date.now() - t0);
  await sleep(1500);
  await shot('1-blocked');
  check(`${name} the blocked frame is not detectable: state ready (the player decides)`, (await embedState(page)) === 'ready');
  check(`${name} link is on screen`, await visible(page, '.pze-link'));
  await sleep(9000);
  check(`${name} after 10 s with no sign of life the link pulses`, await page.evaluate(() => document.querySelector('.pze').classList.contains('is-nudge')));
  await shot('2-nudge');
  await page.locator('.pze-link').tap({ force: true }); // it pulses (never "stable")
  await page.waitForSelector('.pz-key', { timeout: 4000 });
  check(`${name} one tap -> builtin`, await page.evaluate(() => !document.querySelector('.pze') && !!document.querySelector('.pz')));
  await shot('3-builtin');
  // remembered for the round: a reload / remount comes back in builtin
  await page.reload();
  await page.waitForSelector('.pz, .pze');
  check(`${name} switch remembered across a reload`, await page.evaluate(() => !!document.querySelector('.pz') && !document.querySelector('.pze')));
  check(`${name} no console errors`, ev.errors.length === 0, ev.errors);
  await context.close();
}

// ───────────────────────────── hang: never finishes loading ─────────────────────────────
async function hang(browser) {
  const name = 'hang';
  const { context, page, ev, shot } = await open(browser, devices['iPhone 13'], embedUrl('hang'), name);
  await page.waitForSelector('.pze');
  await sleep(1200);
  check(`${name} loading cover, not a white box`, await page.evaluate(() => document.querySelector('.pze-loading').classList.contains('is-on')));
  check(`${name} link available while loading`, await visible(page, '.pze-link'));
  await shot('1-loading');
  await page.waitForFunction(() => document.querySelector('.pze').dataset.state === 'slow', null, { timeout: 8000 });
  await shot('2-slow');
  const txt = await page.evaluate(() => document.querySelector('.pze-failed').textContent);
  check(`${name} slow notice offers builtin + keep waiting`, /נטען לאט/.test(txt) && /לשחק כאן/.test(txt) && /להמשיך לחכות/.test(txt), txt);
  await page.locator('.pze-btn[data-act="wait"]').tap();
  await sleep(300);
  check(`${name} "keep waiting" shows whatever the frame has`, (await embedState(page)) === 'ready' && !(await page.evaluate(() => document.querySelector('.pze-failed').classList.contains('is-on'))));
  await page.locator('.pze-link').tap({ force: true }); // it pulses (never "stable")
  await page.waitForSelector('.pz-key', { timeout: 4000 });
  check(`${name} still one tap to builtin after waiting`, true);
  check(`${name} no console errors`, ev.errors.length === 0, ev.errors);
  await context.close();
}

// ───────────────────────────── slow: loads after 8 s (slow 3G) ─────────────────────────────
async function slow(browser) {
  const name = 'slow';
  const { context, page, ev, shot } = await open(browser, devices['Pixel 7'], embedUrl('slow?ms=8000&bridge=0'), name);
  await page.waitForSelector('.pze');
  await page.waitForFunction(() => document.querySelector('.pze').dataset.state === 'slow', null, { timeout: 9000 });
  await shot('1-slow-notice');
  check(`${name} notice says slow, not "no connection"`, /לאט/.test(await page.evaluate(() => document.querySelector('.pze-failed').textContent)));
  await page.waitForFunction(() => document.querySelector('.pze').dataset.state === 'ready', null, { timeout: 8000 });
  await sleep(400);
  await shot('2-loaded-late');
  check(`${name} late load hides the notice by itself`, !(await page.evaluate(() => document.querySelector('.pze-failed').classList.contains('is-on'))));
  const fr = page.frames().find((f) => f.url().startsWith(SITE));
  check(`${name} the site is in the frame`, !!fr && (await fr.locator('#g1').count()) === 1);
  check(`${name} no console errors`, ev.errors.length === 0, ev.errors);
  await context.close();
}

// ───────────────────────────── tall: scroll inside the frame only ─────────────────────────────
async function tall(browser, device, name) {
  const { context, page, ev, shot } = await open(browser, device, embedUrl('tall?bridge=0'), name);
  await page.waitForFunction(() => document.querySelector('.pze')?.dataset.state === 'ready', null, { timeout: 8000 });
  await sleep(500);
  const box = await page.locator('.pze-frame').boundingBox();
  const hudBefore = await page.evaluate(() => document.querySelector('.pa-hud').getBoundingClientRect().top);
  const cdp = await context.newCDPSession(page);
  // a real finger: touchStart, moves, touchEnd (synthesizeScrollGesture does nothing in headless Chromium)
  const x = Math.round(box.x + box.width / 2);
  const y0 = Math.round(box.y + box.height * 0.75);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 14; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - (box.height * 0.5 * i) / 14 }] });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  const fr = page.frames().find((f) => f.url().startsWith(SITE));
  const inner = await fr.evaluate(() => window.scrollY);
  const outer = await page.evaluate(() => ({ y: window.scrollY, hud: document.querySelector('.pa-hud').getBoundingClientRect().top, bar: document.querySelector('.pze-bar').getBoundingClientRect().bottom, ih: innerHeight }));
  await shot('1-scrolled');
  check(`${name} a swipe scrolls the site inside the frame`, inner > 100, inner);
  check(`${name} our page does not move (HUD and bar stay put)`, outer.y === 0 && outer.hud === hudBefore && outer.bar <= outer.ih + 0.5, outer);
  await fr.locator('#bottom-btn').scrollIntoViewIfNeeded();
  check(`${name} the bottom of the site is reachable`, await fr.locator('#bottom-btn').isVisible());
  check(`${name} no console errors`, ev.errors.length === 0, ev.errors);
  await context.close();
}

// ───────────────────────────── keyboard: native input inside the frame ─────────────────────────────
async function keyboard(browser, device, name) {
  const { context, page, ev, shot } = await open(browser, device, embedUrl('input?bridge=0'), name);
  await page.waitForFunction(() => document.querySelector('.pze')?.dataset.state === 'ready', null, { timeout: 8000 });
  await sleep(400);
  const full = device.viewport;
  const fr = page.frames().find((f) => f.url().startsWith(SITE));
  await fr.locator('#native').tap();
  await sleep(200);
  check(`${name} focus is inside the frame`, await page.evaluate(() => document.activeElement === document.querySelector('.pze-frame')));
  // Android (interactive-widget=resizes-content) shrinks the layout viewport when the keyboard opens;
  // iOS shrinks the visual viewport. Both are seen as a smaller viewport height.
  await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) });
  await sleep(400);
  await shot('1-keyboard-up');
  const up = await page.evaluate(() => ({
    kb: document.querySelector('.pze').classList.contains('is-kb'),
    bar: getComputedStyle(document.querySelector('.pze-bar')).display,
    frameH: document.querySelector('.pze-frame-box').getBoundingClientRect().height,
    hudTop: document.querySelector('.pa-hud').getBoundingClientRect().top,
    ih: innerHeight,
  }));
  check(`${name} keyboard up: the bar steps aside, the site gets the room`, up.kb && up.bar === 'none' && up.frameH > up.ih * 0.7 && up.hudTop === 0, up);
  await fr.locator('#native').type('שלום');
  check(`${name} typing into the site works`, (await fr.locator('#native').inputValue()) === 'שלום');
  await page.setViewportSize(full);
  await page.locator('.pa-hud').evaluate(() => document.querySelector('.pze-frame').blur());
  await page.evaluate(() => window.focus());
  await sleep(400);
  await shot('2-keyboard-down');
  const down = await page.evaluate(() => ({ kb: document.querySelector('.pze').classList.contains('is-kb'), bar: getComputedStyle(document.querySelector('.pze-bar')).display }));
  check(`${name} keyboard down: the bar is back`, !down.kb && down.bar !== 'none', down);
  // a rotation without focus in the frame never hides the bar
  await page.setViewportSize({ width: full.height, height: full.width });
  await sleep(300);
  check(`${name} landscape without focus keeps the bar`, !(await page.evaluate(() => document.querySelector('.pze').classList.contains('is-kb'))));
  check(`${name} no console errors`, ev.errors.length === 0, ev.errors);
  await context.close();
}

// ───────────────────────────── evil: alert, top navigation, popup ─────────────────────────────
async function evil(browser) {
  const name = 'evil';
  const url = embedUrl('evil?bridge=0');
  const { context, page, ev, shot } = await open(browser, devices['iPhone 13'], url, name);
  await page.waitForSelector('.pze');
  await sleep(3500);
  const fr = page.frames().find((f) => f.url().startsWith(SITE));
  const tried = fr ? await fr.evaluate(() => window.__evil) : null;
  await shot('1-evil');
  check(`${name} the site really tried all three`, !!tried && tried.alert !== 'none' && tried.popup !== 'none', tried);
  check(`${name} alert() never shows a dialog (would freeze the phone)`, ev.dialogs === 0, ev.dialogs);
  check(`${name} no popup / new tab`, ev.popups === 0, ev.popups);
  check(`${name} our page was not navigated away`, page.url() === `${BASE}${url}`, page.url());
  check(`${name} the round still runs`, (await party(page)).leftMs < 60000 && !(await party(page)).ended);
  check(`${name} no console errors`, ev.errors.length === 0, ev.errors);
  await context.close();
}

// ───────────────────────────── report: the self-report bar ─────────────────────────────
async function report(browser, device, name) {
  const DUR = 60000;
  const { context, page, ev, shot } = await open(browser, device, embedUrl('nobridge', DUR), name);
  await page.waitForFunction(() => document.querySelector('.pze')?.dataset.state === 'ready', null, { timeout: 8000 });
  await sleep(300);
  await shot('1-bar');
  const lay = await layout(page, '.pze');
  check(`${name} embed fits, no scroll`, noScroll(lay), lay);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('.pze-n, .pze-link')].map((b) => {
      const r = b.getBoundingClientRect();
      return [b.dataset.act, Math.round(r.width), Math.round(r.height)];
    }),
  );
  check(`${name} bar buttons are thumb-sized (>= 30 x 34)`, sizes.every(([, w, h]) => w >= 30 && h >= 34), sizes);
  check(`${name} instruction on screen`, /פתרתם\? בכמה ניסיונות/.test(await page.textContent('.pze-bar-label')));

  // first tap only arms, and says what to do
  const t0 = (await party(page)).leftMs;
  await page.locator('.pze-n[data-act="tries-3"]').tap();
  await sleep(150);
  const armedLabel = await page.textContent('.pze-bar-label');
  check(`${name} first tap only arms`, (await party(page)).score === 0 && /לאישור הקישו שוב על 3/.test(armedLabel), armedLabel);
  await shot('2-armed');
  await page.locator('.pze-n[data-act="tries-3"]').tap({ force: true });
  await sleep(150);
  const s3 = (await party(page)).score;
  const t1 = (await party(page)).leftMs;
  const lo = await logic(page, 'selfReportScore', 3, t1, DUR);
  const hi = await logic(page, 'selfReportScore', 3, t0, DUR);
  check(`${name} 3 tries -> builtin formula timed at the first tap`, s3 >= lo && s3 <= hi, { s3, lo, hi });
  const st = await page.evaluate(() => ({
    label: document.querySelector('.pze-bar-label').textContent,
    chosen: [...document.querySelectorAll('.pze-n.is-chosen')].map((b) => b.dataset.act),
    link: document.querySelector('.pze-link').hidden,
    btn: document.querySelector('.pze-btn[data-act="builtin"]').hidden,
  }));
  check(`${name} reported: shows the choice and that a fix is possible`, /נרשם: 3 ניסיונות/.test(st.label) && /אפשר לתקן/.test(st.label) && st.chosen.join() === 'tries-3', st);
  check(`${name} after a report the builtin switch is gone (no scoring twice)`, st.link && st.btn, st);
  check(`${name} no "finished" overlay: a correction stays possible`, !(await finishedOverlay(page)));
  await shot('3-reported');

  // correction 3 -> 4 keeps the moment of the solve: exactly 100 less
  await sleep(1500);
  await page.locator('.pze-n[data-act="tries-4"]').tap();
  await page.locator('.pze-n[data-act="tries-4"]').tap({ force: true });
  await sleep(150);
  const s4 = (await party(page)).score;
  check(`${name} correction 3 -> 4 = exactly 100 less (same solve moment)`, s4 === s3 - 100, { s3, s4 });
  // tapping the reported choice again does nothing
  await page.locator('.pze-n[data-act="tries-4"]').tap({ force: true });
  check(`${name} tapping the reported number again does not re-arm`, !(await page.evaluate(() => document.querySelector('.pze-bar-label').classList.contains('is-armed'))));
  // a freeze disarms and blocks
  await page.locator('.pze-n[data-act="tries-1"]').tap();
  await page.evaluate(() => window.__party.freeze(1500));
  await sleep(200);
  await page.locator('.pze-n[data-act="tries-1"]').tap({ force: true });
  await sleep(100);
  check(`${name} frozen: armed choice dropped, taps ignored`, (await party(page)).score === s4, await party(page));
  await sleep(1600);
  // fail
  await page.locator('.pze-n.is-fail').tap();
  await page.locator('.pze-n.is-fail').tap({ force: true });
  await sleep(150);
  const sf = (await party(page)).score;
  const failMin = await page.evaluate(async () => (await import('/src/games/plotzel/logic.ts')).FAIL_MIN);
  check(`${name} "לא הצלחתי" = FAIL_MIN, below any solve`, sf === failMin && sf < 500, sf);
  await shot('4-fail');
  // reload: the report survives
  await page.reload();
  await page.waitForSelector('.pze');
  await sleep(500);
  const back = await page.evaluate(() => ({ chosen: [...document.querySelectorAll('.pze-n.is-chosen')].map((b) => b.dataset.act), label: document.querySelector('.pze-bar-label').textContent }));
  check(`${name} a reload keeps the report`, back.chosen.join() === 'fail' && (await party(page)).score === failMin, { back, score: (await party(page)).score });
  check(`${name} no console errors`, ev.errors.length === 0, ev.errors);
  await context.close();

  // a player who reports nothing gets 0
  const n2 = await open(browser, device, embedUrl('nobridge', 5000, 9), `${name}-silent`);
  await n2.page.waitForFunction(() => window.__party && window.__party.ended, null, { timeout: 12000 });
  check(`${name} reported nothing -> 0`, (await party(n2.page)).score === 0);
  await n2.context.close();
}

// ───────────────────────────── switch: bridge site, then builtin resume ─────────────────────────────
async function switchAndResume(browser) {
  const name = 'resume';
  // a working bridge site hides the bar and the switch (it shows life)
  const a = await open(browser, devices['iPhone 13'], embedUrl('ok'), `${name}-bridge`);
  await a.page.waitForFunction(() => document.querySelector('.pze')?.dataset.state === 'bridge', null, { timeout: 8000 });
  check(`${name} a site with the bridge hides bar and switch`, await a.page.evaluate(() => document.querySelector('.pze-bar').classList.contains('is-hidden') && document.querySelector('.pze-link').hidden));
  await a.context.close();

  // builtin rows survive a reload; a solve survives too
  const b = await open(browser, devices['iPhone 13'], `/dev.html?game=plotzel&seed=7&duration=60000&plotzel=builtin`, name);
  const page = b.page;
  await page.waitForSelector('.pz-key');
  const answer = await logic(page, 'pickAnswer', 7);
  for (const w of ['שולחן', 'מכונה']) {
    for (const ch of Array.from(w)) await page.locator(`.pz-key[data-k="${norm(ch)}"]`).tap();
    await page.locator('.pz-key[data-k="ENTER"]').tap();
    await sleep(1600);
  }
  const before = { score: (await party(page)).score, rows: await page.evaluate(() => [...document.querySelectorAll('.pz-row')].slice(0, 2).map((r) => r.textContent + '|' + [...r.children].map((t) => t.className.replace('pz-tile', '').trim()).join(','))) };
  await page.reload();
  await page.waitForSelector('.pz-key');
  await sleep(400);
  const after = { score: (await party(page)).score, rows: await page.evaluate(() => [...document.querySelectorAll('.pz-row')].slice(0, 2).map((r) => r.textContent + '|' + [...r.children].map((t) => t.className.replace('pz-tile', '').trim()).join(','))) };
  await b.shot('1-after-reload');
  check(`${name} builtin rows and colours survive a reload`, JSON.stringify(before.rows) === JSON.stringify(after.rows), { before, after });
  check(`${name} builtin score survives a reload`, after.score === before.score, { before: before.score, after: after.score });
  check(`${name} the next row is the third`, await page.evaluate(() => document.querySelectorAll('.pz-row')[2].classList.contains('is-current')));
  for (const ch of Array.from(answer)) await page.locator(`.pz-key[data-k="${norm(ch)}"]`).tap();
  await page.locator('.pz-key[data-k="ENTER"]').tap();
  await sleep(300);
  const solved = (await party(page)).score;
  await sleep(2000);
  await page.reload();
  await page.waitForSelector('.pz-key');
  await sleep(1200);
  check(`${name} a solve survives a reload with the same score and finishes`, (await party(page)).score === solved && (await page.evaluate(() => document.querySelector('.pz').dataset.state)) === 'solved' && (await finishedOverlay(page)), {
    solved,
    now: (await party(page)).score,
  });
  await b.shot('2-solved-reload');
  check(`${name} no console errors`, b.ev.errors.length === 0, b.ev.errors);
  await b.context.close();
}

// ───────────────────────────── sizes: builtin on every phone ─────────────────────────────
const SIZES = [
  ['se1-320x568', devices['iPhone SE']],
  ['galaxy-320x658', devices['Galaxy S9+']],
  ['android-360x640', { ...custom(360, 640), userAgent: devices['Pixel 7'].userAgent }],
  ['se3-375x667', devices['iPhone SE (3rd gen)']],
  ['iphone13-390x664', devices['iPhone 13']],
  ['pixel7-412x839', devices['Pixel 7']],
  ['android-412x915', { ...custom(412, 915), userAgent: devices['Pixel 7'].userAgent }],
  ['promax-430x740', devices['iPhone 14 Pro Max']],
  ['full-430x932', custom(430, 932)],
];
async function sizes(browser) {
  for (const [label, device] of SIZES) {
    const name = `size-${label}`;
    const { context, page, ev, shot } = await open(browser, device, `/dev.html?game=plotzel&seed=7&duration=60000&plotzel=builtin`, name);
    await page.waitForSelector('.pz-key');
    await sleep(300);
    // one wrong row so colours show, then a partial row
    for (const ch of Array.from('שולחן')) await page.locator(`.pz-key[data-k="${norm(ch)}"]`).tap();
    await page.locator('.pz-key[data-k="ENTER"]').tap();
    await sleep(1600);
    for (const ch of Array.from('מכו')) await page.locator(`.pz-key[data-k="${norm(ch)}"]`).tap();
    await sleep(200);
    await shot('builtin');
    const l = await layout(page, '.pz');
    check(`${name} no scroll, nothing off screen`, noScroll(l), l);
    const k = await page.evaluate(() => {
      let w = 1e9;
      let h = 1e9;
      for (const b of document.querySelectorAll('.pz-key')) {
        const r = b.getBoundingClientRect();
        w = Math.min(w, r.width);
        h = Math.min(h, r.height);
      }
      const tiles = [...document.querySelectorAll('.pz-row')[0].children].map((t) => t.getBoundingClientRect());
      const grid = document.querySelector('.pz-grid').getBoundingClientRect();
      const kb = document.querySelector('.pz-kb').getBoundingClientRect();
      const enter = document.querySelector('.pz-key[data-k="ENTER"]').getBoundingClientRect();
      const del = document.querySelector('.pz-key[data-k="DEL"]').getBoundingClientRect();
      return {
        w: Math.round(w * 10) / 10,
        h: Math.round(h * 10) / 10,
        n: document.querySelectorAll('.pz-key').length,
        layout: document.querySelector('.pz-kb').dataset.layout,
        tile: Math.round(tiles[0].width),
        firstRight: tiles[0].left > tiles[4].left,
        firstLetter: document.querySelectorAll('.pz-row')[0].children[0].textContent,
        lastLetter: document.querySelectorAll('.pz-row')[0].children[4].textContent,
        gridAboveKb: grid.bottom <= kb.top,
        enterW: Math.round(enter.width),
        delW: Math.round(del.width),
      };
    });
    check(`${name} 24 keys, each >= 40 x 48 (${k.layout})`, k.n === 24 && k.w >= 40 && k.h >= 48, k);
    check(`${name} RTL: first letter on the right, final form last`, k.firstRight && k.firstLetter === 'ש' && k.lastLetter === 'ן', k);
    check(`${name} grid readable (tile >= 30) and above the keyboard`, k.tile >= 30 && k.gridAboveKb, k);
    check(`${name} enter and backspace are wide keys`, k.enterW >= 60 && k.delW >= 60, k);
    check(`${name} no console errors`, ev.errors.length === 0, ev.errors);
    await context.close();
  }
}

// ───────────────────────────── flip: lock time and a freeze mid-flip ─────────────────────────────
async function flip(browser) {
  const name = 'flip';
  const { context, page, ev, shot } = await open(browser, devices['iPhone SE'], `/dev.html?game=plotzel&seed=7&duration=60000&plotzel=builtin`, name);
  await page.waitForSelector('.pz-key');
  await sleep(300);
  // lock time: Enter, then keep tapping a letter until the next row takes it
  for (const ch of Array.from('שולחן')) await page.locator(`.pz-key[data-k="${norm(ch)}"]`).tap();
  const lock = await page.evaluate(async () => {
    const key = (k) => document.querySelector(`.pz-key[data-k="${k}"]`);
    const down = (el) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    down(key('ENTER'));
    const t0 = performance.now();
    for (;;) {
      down(key('ק'));
      if (document.querySelectorAll('.pz-row')[1].children[0].textContent !== '') return Math.round(performance.now() - t0);
      if (performance.now() - t0 > 4000) return -1;
      await new Promise((r) => setTimeout(r, 40));
    }
  });
  check(`${name} typing the next row is blocked at most ~1.5 s`, lock > 0 && lock <= 1500, lock);
  await page.locator('.pz-key[data-k="DEL"]').tap();
  // freeze mid-flip
  for (const ch of Array.from('מכונה')) await page.locator(`.pz-key[data-k="${norm(ch)}"]`).tap();
  await page.locator('.pz-key[data-k="ENTER"]').tap();
  await sleep(450);
  await page.evaluate(() => window.__party.freeze(2000));
  const codes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.pz-row')[1].children].map((t) => (t.classList.contains('is-correct') ? 'G' : t.classList.contains('is-present') ? 'Y' : t.classList.contains('is-absent') ? '.' : '_')).join(''),
    );
  const midA = await codes();
  await sleep(1000);
  const midB = await codes();
  await shot('1-frozen-mid-flip');
  await page.locator('.pz-key[data-k="ק"]').tap({ force: true });
  check(`${name} frozen mid-flip: the flip stands still, keys dead`, midA === midB && midA.includes('_') && (await page.evaluate(() => document.querySelectorAll('.pz-row')[2].textContent)) === '', { midA, midB });
  await sleep(2600);
  const end = await codes();
  check(`${name} after the freeze the flip completes and row 3 opens`, !end.includes('_') && (await page.evaluate(() => document.querySelectorAll('.pz-row')[2].classList.contains('is-current'))), end);
  await shot('2-resumed');
  check(`${name} no console errors`, ev.errors.length === 0, ev.errors);
  await context.close();
}

// ───────────────────────────── readme: the snippet the owner pastes ─────────────────────────────
async function readme(browser) {
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'public', 'plotzel-bridge', 'README.md'), 'utf8');
  const mock = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'public', 'plotzel-bridge', 'mock.html'), 'utf8');
  const fromMd = /```html\n<script>\n([\s\S]*?)<\/script>\n```/.exec(md);
  const fromMock = /<script type="text\/plain" id="snippet">([\s\S]*?)<\/script>/.exec(mock);
  const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  check('readme snippet == the snippet the stand-in runs', !!fromMd && !!fromMock && lines(fromMd[1]) === lines(fromMock[1]));
  // opened normally (not in the party) the snippet does nothing
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto(`${SITE}/ok?seed=7&embed=1&parentOrigin=${encodeURIComponent(BASE)}`);
  check('readme snippet is inert when the site is opened on its own', await p.evaluate(() => typeof window.plotzelBridge === 'undefined'));
  await ctx.close();
}

(async () => {
  const want = new Set(process.argv.slice(2));
  const on = (s) => want.size === 0 || want.has(s);
  const browser = await chromium.launch();
  try {
    if (on('blocked')) {
      await blocked(browser, 'xfo', devices['iPhone 13'], 'xfo');
      await blocked(browser, 'csp', devices['Pixel 7'], 'csp');
    }
    if (on('hang')) await hang(browser);
    if (on('slow')) await slow(browser);
    if (on('tall')) {
      await tall(browser, devices['iPhone 13'], 'tall-iphone');
      await tall(browser, devices['Pixel 7'], 'tall-pixel');
    }
    if (on('keyboard')) {
      await keyboard(browser, devices['Pixel 7'], 'kb-pixel');
      await keyboard(browser, custom(360, 640), 'kb-360');
    }
    if (on('evil')) await evil(browser);
    if (on('report')) {
      await report(browser, devices['iPhone SE'], 'report-se');
      await report(browser, devices['Pixel 7'], 'report-pixel');
    }
    if (on('switch')) await switchAndResume(browser);
    if (on('sizes')) await sizes(browser);
    if (on('flip')) await flip(browser);
    if (on('readme')) await readme(browser);
  } finally {
    await browser.close();
  }
  console.log(fails.length ? `\n${passed} ok, ${fails.length} FAILED:\n  ${fails.join('\n  ')}` : `\nall ${passed} ok`);
  process.exit(fails.length ? 1 : 0);
})();
