// qa-deploy-split: path C, the pages on one origin (Firebase Hosting) and the game server on
// another (the VM or Cloud Run). The client is built with VITE_SERVER_URL=<server>.
// Checks: the TV opens a room over a websocket to the server, its QR / join URL points at the
// PAGES origin, a phone on the pages origin joins and the TV lists it.
//   PAGES=http://127.0.0.1:8824 SERVER=http://172.17.0.4 node tests/e2e/qa-deploy-split.cjs
// (locally: `firebase emulators:start --only hosting` on a copy of firebase.json serving
//  dist/client built with VITE_SERVER_URL=$SERVER)
// Screenshots: tests/e2e/out/qa-deploy/split/
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const PAGES = (process.env.PAGES || 'http://127.0.0.1:8824').replace(/\/$/, '');
const SERVER = (process.env.SERVER || 'http://172.17.0.4').replace(/\/$/, '');
const OUT = path.join(__dirname, 'out', 'qa-deploy', 'split');
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (ok, msg, extra) => {
  if (!ok) bad++;
  console.log(ok ? '  ok  ' : '  FAIL', msg, !ok && extra !== undefined ? JSON.stringify(extra) : '');
};

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  try {
    const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    const tvWs = [];
    tv.on('websocket', (w) => tvWs.push(w.url()));
    tv.on('pageerror', (e) => errs.push('tv: ' + e.message));
    await tv.goto(`${PAGES}/host`);
    await tv.waitForSelector('[data-testid=room-code]', { timeout: 15000 });
    const code = (await tv.textContent('[data-testid=room-code]')).trim();
    const join = (await tv.textContent('[data-testid=join-url]')).trim();
    const serverWs = SERVER.replace(/^http/, 'ws');
    check(tvWs.some((u) => u.startsWith(serverWs + '/socket.io/') && u.includes('transport=websocket')), `TV websocket goes to the server (${tvWs[0]})`, tvWs);
    check(join.includes(new URL(PAGES).host) && join.includes(code), `TV join URL is on the pages origin: ${join}`);

    const phone = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
    phone.on('pageerror', (e) => errs.push('phone: ' + e.message));
    await phone.goto(`${PAGES}/?room=${code}`);
    await phone.waitForSelector('.pp-name-input', { timeout: 15000 });
    await phone.fill('.pp-name-input', 'שירה');
    await phone.locator('.pp-btn-go').tap();
    await phone.waitForFunction(() => window.__player && window.__player.screen === 'lobby', null, { timeout: 10000 });
    await tv.waitForFunction(() => window.__host.state().players.length === 1, null, { timeout: 8000 });
    check(true, 'a phone on the pages origin joined and the TV lists it');
    await tv.waitForTimeout(800);
    await tv.screenshot({ path: path.join(OUT, 'tv-lobby.png') });
    await phone.screenshot({ path: path.join(OUT, 'phone-lobby.png') });
    check(errs.length === 0, 'no page errors', errs);
  } catch (e) {
    check(false, 'crashed: ' + e.message);
  } finally {
    await browser.close();
  }
  console.log(bad === 0 ? 'PASS' : `FAIL (${bad})`);
  process.exit(bad === 0 ? 0 : 1);
})();
