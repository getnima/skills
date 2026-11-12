// sweep-tv-qr: the way in from the TV. The generated QR decodes (jsqr, from a screenshot, also
// scaled down the way a phone camera across the room sees it) to a link that opens the room;
// the designed QR (assets/host/qr.png + qr.json) stays OFF unless qr.json's url is exactly this
// page's origin + '/j' (and turns ON for the exact match, as a control); GET /j sends phones to
// the room on the TV; the credits panel opens. Both viewports. Uses the temp tree of sweep-tv-lib.
//
//   SWEEP_TREE=<dir> node tests/e2e/sweep-tv-qr.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const L = require('./sweep-tv-lib.cjs');
const jsQR = require(path.join(L.ROOT, 'tools/qr/node_modules/jsqr'));
const { io } = require('socket.io-client');

const OUT = L.outDir('qr');
const { check, failures } = L.checker();
const errors = [];

/** Box-filter downscale of an RGBA buffer. */
function downscale(png, f) {
  const w = Math.floor(png.width * f);
  const h = Math.floor(png.height * f);
  const out = new Uint8ClampedArray(w * h * 4);
  const s = 1 / f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y * s); yy < Math.min(png.height, Math.floor((y + 1) * s)); yy++) {
        for (let xx = Math.floor(x * s); xx < Math.min(png.width, Math.floor((x + 1) * s)); xx++) {
          const i = (yy * png.width + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += png.data[i + c];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = acc[c] / Math.max(1, n);
    }
  }
  return { data: out, width: w, height: h };
}

function decode(buf, factors = [1, 0.5, 0.33]) {
  const png = PNG.sync.read(buf);
  const res = {};
  for (const f of factors) {
    const img = f === 1 ? { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height } : downscale(png, f);
    const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    res[f] = hit ? hit.data : null;
  }
  return res;
}

async function openTv(browser, url, vp, label) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  L.watchErrors(page, label, errors);
  await page.goto(url);
  await page.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 30000 });
  // the designed QR waits for qr.json, the generated one for /api/info
  await L.sleep(1500);
  return { ctx, page, code: await page.evaluate(() => window.__host.state().code) };
}

async function j() {
  const r = await fetch(`${L.SERVER}/j`, { redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location'), cache: r.headers.get('cache-control') };
}

(async () => {
  const tree = L.prepareTree();
  const hostDir = path.join(tree, 'dist/client/assets/host');
  const origQrJson = fs.readFileSync(path.join(hostDir, 'qr.json'), 'utf8');
  const origQrPng = fs.readFileSync(path.join(hostDir, 'qr.png'));
  await L.startServer({ PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '8000' });
  // The phones open the LAN address: keep this sandbox's HTTP proxy out of the way (it answers a
  // websocket upgrade to a LAN address with 502). Nothing to do with the app.
  const browser = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const lan = (await (await fetch(`${L.SERVER}/api/info`)).json()).lanIps[0];
  console.log(L.stamp(), 'LAN address', lan);
  const LAN = `http://${lan}:${L.SERVER_PORT}`;
  try {
    // ── GET /j with no TV ──
    const j0 = await j();
    check(j0.status === 302 && j0.location === '/', 'GET /j with no TV connected: 302 to the join page /', j0);
    check(/no-store/.test(j0.cache || ''), '/j is not cacheable (a phone that scanned yesterday gets today\'s room)', j0);

    for (const vp of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      const tag = `${vp.width}x${vp.height}`;
      const tv = await openTv(browser, `${L.SERVER}/host`, vp, `tv-${tag}`);
      await tv.page.mouse.click(vp.width / 2, 6);
      const jr = await j();
      check(jr.status === 302 && jr.location === `/?room=${tv.code}`, `${tag}: GET /j → the TV's room (${tv.code})`, jr);

      // the generated code (the designed one names another host)
      const mode = await tv.page.getAttribute('[data-testid=join]', 'data-qr');
      check(mode === 'generated', `${tag}: designed QR stays OFF when qr.json names ${L.FOREIGN_QR_URL} (page on localhost)`, mode);
      const shot = path.join(OUT, `lobby-${tag}.png`);
      const buf = await tv.page.screenshot({ path: shot });
      const dec = decode(buf);
      const want = `${LAN}/?room=${tv.code}`;
      check(dec[1] === want, `${tag}: QR decodes from the full TV screenshot to ${want}`, dec);
      check(dec[0.5] === want, `${tag}: QR still decodes at half the resolution`, dec);
      console.log(L.stamp(), `   ${tag} decode at 1 / 0.5 / 0.33:`, JSON.stringify(dec));
      const urlText = await tv.page.textContent('[data-testid=join-url]');
      check(urlText.trim() === want.replace(/^https?:\/\//, ''), `${tag}: the printed link under the QR is the same link`, urlText);
      const qrBox = await tv.page.locator('[data-testid=qr]').boundingBox();
      console.log(L.stamp(), `   ${tag} generated QR box`, JSON.stringify(qrBox), `→ ${Math.round((qrBox.height * 1080) / vp.height)} px of a 1080p screen`);

      // a phone opens exactly what it decoded and joins the room
      const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const phone = await ph.newPage();
      L.watchErrors(phone, `phone-${tag}`, errors);
      await phone.goto(dec[1] || want);
      await phone.waitForSelector('.pp-name-input', { timeout: 30000 });
      await phone.fill('.pp-name-input', 'סורק');
      await phone.locator('.pp-btn-go').tap();
      await tv.page.waitForFunction(() => window.__host.state().players.some((p) => p.name === 'סורק'), null, { timeout: 20000 });
      check(true, `${tag}: a phone that opened the decoded link joined the TV's room`);

      // between rounds the panel is compact: the QR must still decode
      await tv.page.keyboard.press('Space');
      await tv.page.waitForFunction(() => window.__host.state().phase === 'results', null, { timeout: 60000 });
      await tv.page.waitForFunction(() => window.__host.model().primary === 'continue' && !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 60000 }).catch(() => undefined);
      await L.sleep(1700);
      await tv.page.keyboard.press('Space');
      await tv.page.waitForFunction(() => window.__host.state().phase === 'lobby', null, { timeout: 20000 });
      await L.sleep(1500);
      const buf2 = await tv.page.screenshot({ path: path.join(OUT, `lobby-between-${tag}.png`) });
      const dec2 = decode(buf2);
      check(dec2[1] === want, `${tag}: between rounds the compact QR still decodes to the room link`, dec2);
      console.log(L.stamp(), `   ${tag} between-rounds decode at 1 / 0.5 / 0.33:`, JSON.stringify(dec2));
      const qrBox2 = await tv.page.locator('[data-testid=qr]').boundingBox();
      console.log(L.stamp(), `   ${tag} compact QR box`, JSON.stringify(qrBox2), `→ ${Math.round((qrBox2.height * 1080) / vp.height)} px of a 1080p screen`);

      // credits
      await tv.page.click('[data-testid=btn-more]');
      await tv.page.waitForSelector('[data-testid=more-menu]', { timeout: 5000 });
      await tv.page.click('[data-testid=btn-credits]');
      const credits = await tv.page.waitForSelector('[data-testid=credits]', { timeout: 5000 }).then(() => true).catch(() => false);
      const rows = await tv.page.locator('[data-testid=credit]').count();
      const links = await tv.page.$$eval('[data-testid=credit] a', (as) => as.map((a) => ({ href: a.href, target: a.target })));
      await tv.page.screenshot({ path: path.join(OUT, `credits-${tag}.png`) });
      check(credits && rows === 10, `${tag}: ☰ → קרדיטים opens the credits panel with its 10 photo credits`, { credits, rows });
      check(links.every((l) => /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(l.href) && l.target === '_blank'), `${tag}: every credit links to its Commons page in a new tab`, links.slice(0, 2));
      const fitsCredits = await tv.page.evaluate(() => {
        const m = document.querySelector('[data-testid=credits]');
        const r = m.getBoundingClientRect();
        const body = m.querySelector('.hs-credits') || m;
        return { top: r.top, bottom: r.bottom, vh: innerHeight, scroll: body.scrollHeight > body.clientHeight + 1 };
      });
      check(fitsCredits.top >= 0 && fitsCredits.bottom <= fitsCredits.vh + 1, `${tag}: the credits panel fits the screen`, fitsCredits);
      await tv.page.keyboard.press('Escape');
      await L.sleep(400);
      const closed = (await tv.page.locator('[data-testid=credits]').count()) === 0;
      check(closed, `${tag}: Escape closes the credits panel`);
      await ph.close();
      await tv.ctx.close();
    }

    // ── a second TV page opened later (another laptop tab, a curious guest on /host) ──
    {
      const a = await openTv(browser, `${L.SERVER}/host`, { width: 1280, height: 720 }, 'tv-A');
      const s = io(L.SERVER, { transports: ['websocket'], forceNew: true });
      await new Promise((r) => s.once('connect', r));
      await new Promise((r) => s.emit('player:join', { code: a.code, name: 'אורחת' }, r));
      const ja = await j();
      await L.sleep(1500);
      const b = await openTv(browser, `${L.SERVER}/host`, { width: 1280, height: 720 }, 'tv-B (stray tab)');
      const jb = await j();
      console.log(L.stamp(), `   party TV room ${a.code} (1 guest) → /j ${ja.location}; stray /host tab room ${b.code} (0 guests) → /j ${jb.location}`);
      check(jb.location === `/?room=${a.code}`, 'a stray /host tab opened later does not take over /j from the party TV (the room with the guests)', { party: a.code, stray: b.code, j: jb.location });
      await b.ctx.close();
      await L.sleep(1500);
      const jc = await j();
      check(jc.location === `/?room=${a.code}`, 'after the stray tab closes /j points at the party TV again', jc);
      // the party TV reconnects (Wi-Fi blip): its re-attach makes it the newest again
      s.close();
      await a.ctx.close();
    }

    // ── designed QR gating, with the TV opened on the LAN address (what phones can reach) ──
    const variants = [
      { name: 'foreign host (the other deploy)', url: L.FOREIGN_QR_URL, png: L.FOREIGN_QR_URL, page: `${LAN}/host`, want: 'generated' },
      { name: 'trailing slash /j/', url: `${LAN}/j/`, png: `${LAN}/j/`, page: `${LAN}/host`, want: 'generated' },
      { name: 'https instead of http', url: `https://${lan}:${L.SERVER_PORT}/j`, png: `https://${lan}:${L.SERVER_PORT}/j`, page: `${LAN}/host`, want: 'generated' },
      { name: 'another port', url: `http://${lan}:${L.SERVER_PORT + 1}/j`, png: `http://${lan}:${L.SERVER_PORT + 1}/j`, page: `${LAN}/host`, want: 'generated' },
      { name: 'no /j path', url: `${LAN}`, png: `${LAN}`, page: `${LAN}/host`, want: 'generated' },
      { name: 'upper-case host', url: `${LAN}/J`, png: `${LAN}/J`, page: `${LAN}/host`, want: 'generated' },
      { name: 'TV on localhost, qr.json localhost/j', url: `${L.SERVER}/j`, png: `${L.SERVER}/j`, page: `${L.SERVER}/host`, want: 'generated' },
      { name: 'exact match but TV opened with ?join=', url: `${LAN}/j`, png: `${LAN}/j`, page: `${LAN}/host?join=http://10.0.0.9:${L.SERVER_PORT}`, want: 'generated' },
      { name: 'qr.json is not JSON', raw: '{ url: nope', png: `${LAN}/j`, page: `${LAN}/host`, want: 'generated' },
      { name: 'qr.json has no url', raw: '{"link":"x"}', png: `${LAN}/j`, page: `${LAN}/host`, want: 'generated' },
      { name: 'qr.json missing (404)', remove: true, png: `${LAN}/j`, page: `${LAN}/host`, want: 'generated' },
      { name: 'CONTROL: exact match origin + /j', url: `${LAN}/j`, png: `${LAN}/j`, page: `${LAN}/host`, want: 'designed' },
    ];
    for (const v of variants) {
      await L.writeDesignedQr(hostDir, v.png, v.url || 'x');
      if (v.raw !== undefined) fs.writeFileSync(path.join(hostDir, 'qr.json'), v.raw);
      if (v.remove) fs.rmSync(path.join(hostDir, 'qr.json'), { force: true });
      const tv = await openTv(browser, v.page, { width: 1920, height: 1080 }, `tv-qr-${v.name}`);
      await L.sleep(1000);
      const mode = await tv.page.getAttribute('[data-testid=join]', 'data-qr');
      const file = path.join(OUT, `designed-${v.name.replace(/\W+/g, '_')}.png`);
      const buf = await tv.page.screenshot({ path: file });
      const dec = decode(buf, [1, 0.5]);
      check(mode === v.want, `designed QR ${v.want === 'designed' ? 'ON' : 'OFF'}: ${v.name}`, { mode, dec });
      if (v.want === 'designed' && mode === 'designed') {
        check(dec[1] === `${LAN}/j`, 'the designed picture on the TV decodes to origin + /j', dec);
        const shown = await tv.page.textContent('[data-testid=join-url]');
        check(shown.trim() === `${lan}:${L.SERVER_PORT}/j`, 'the printed link under the designed QR is the short /j link', shown);
        const r = await fetch(`${L.SERVER}/j`, { redirect: 'manual' });
        check(r.headers.get('location') === `/?room=${tv.code}`, 'and /j sends the phone to the room on the TV', r.headers.get('location'));
      } else if (mode === 'generated') {
        const base = /[?&]join=([^&]+)/.exec(v.page);
        const want = `${base ? decodeURIComponent(base[1]) : LAN}/?room=${tv.code}`;
        check(dec[1] === want, `   (${v.name}) the generated code still decodes to the room (${want})`, dec);
      }
      await tv.ctx.close();
    }
  } catch (e) {
    console.error(e);
    failures.push({ msg: 'exception', extra: String(e && e.stack) });
  } finally {
    fs.writeFileSync(path.join(hostDir, 'qr.json'), origQrJson);
    fs.writeFileSync(path.join(hostDir, 'qr.png'), origQrPng);
    await browser.close();
    L.stopAll();
  }
  const bad = errors.filter((e) => e.kind !== 'warning');
  fs.writeFileSync(path.join(OUT, 'errors.json'), JSON.stringify(errors, null, 1));
  console.log(L.stamp(), `console/page errors: ${bad.length}`, JSON.stringify(bad.slice(0, 10)));
  console.log(failures.length === 0 ? 'sweep-tv-qr: ALL OK' : `sweep-tv-qr: ${failures.length} FAILED`);
  fs.writeFileSync(path.join(OUT, 'failures.json'), JSON.stringify(failures, null, 1));
  process.exit(failures.length === 0 ? 0 : 1);
})();
