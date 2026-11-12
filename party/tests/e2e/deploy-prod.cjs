// deploy task: the production bundle (one Node process, the Docker image, or Caddy on the
// VM in front of it) serves /, /host, /show, /healthz and the websocket.
// Usage: node tests/e2e/deploy-prod.cjs [baseUrl]
// Start first, e.g.:  docker run -d -p 8825:8080 -e PORT=8080 party-arena:qa
//                 or  NODE_ENV=production PORT=8825 node dist/server/index.mjs
// Also prints window.isSecureContext: plain http on a LAN / public IP is NOT a secure
// context (no screen wake lock), and the pages must still work there.
const { chromium, devices } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const BASE = (process.argv[2] || 'http://localhost:8804').replace(/\/$/, '');
const OUT = path.join(__dirname, 'out', 'qa-deploy', 'prod', new URL(BASE).host.replace(/[^\w.-]/g, '_'));
fs.mkdirSync(OUT, { recursive: true });
const origin = new URL(BASE).origin;

async function visit(browser, name, url, contextOpts) {
  // A local Caddy test uses its own internal CA.
  const insecure = /^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
  const context = await browser.newContext({ ...contextOpts, ignoreHTTPSErrors: insecure });
  const page = await context.newPage();
  const foreign = [];
  const failed = [];
  const sockets = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u);
  });
  // The TV probes every cutscene slot and aborts the video loads on purpose: not a failure.
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText ?? '';
    if (err.includes('ERR_ABORTED') && r.url().includes('/cutscenes/')) return;
    failed.push(r.url() + ' ' + err);
  });
  page.on('websocket', (ws) => sockets.push(ws.url()));
  const res = await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const appSockets = [...sockets];
  const secure = await page.evaluate(() => window.isSecureContext);
  const health = await page.evaluate(() => fetch('/healthz').then((r) => r.json()));
  // A websocket opened from inside the page, on the page's own origin (socket.io open packet).
  const inPageSocket = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket');
        const t = setTimeout(() => resolve('timeout'), 5000);
        ws.onmessage = (e) => {
          clearTimeout(t);
          ws.close();
          resolve(String(e.data).startsWith('0{') ? 'open' : 'bad: ' + String(e.data).slice(0, 40));
        };
        ws.onerror = () => resolve('error');
      }),
  );
  const shot = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: shot });
  await context.close();
  return { name, status: res?.status(), sockets: appSockets, foreign, failed, health, inPageSocket, shot, secure };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  results.push(await visit(browser, 'iphone14-phone', `${BASE}/`, { ...devices['iPhone 14'] }));
  results.push(await visit(browser, 'pixel7-phone', `${BASE}/`, { ...devices['Pixel 7'] }));
  results.push(await visit(browser, 'tv-host', `${BASE}/host`, { viewport: { width: 1920, height: 1080 } }));
  results.push(await visit(browser, 'tv-show', `${BASE}/show`, { viewport: { width: 1920, height: 1080 } }));
  await browser.close();
  let bad = 0;
  for (const r of results) {
    const okSocket = r.sockets.some((u) => u.startsWith(origin.replace(/^http/, 'ws')) && u.includes('/socket.io/'));
    const line = `${r.name}: http ${r.status}, secure context ${r.secure}, app websocket ${okSocket ? r.sockets[0] : 'none'}, in-page websocket ${r.inPageSocket}, health ${JSON.stringify(r.health)}, foreign ${r.foreign.length}, failed ${r.failed.length}`;
    console.log(line);
    for (const f of r.failed) console.log('   failed:', f);
    for (const f of r.foreign) console.log('   foreign:', f);
    if (r.status !== 200 || r.health?.ok !== true || r.failed.length > 0 || r.inPageSocket !== 'open') bad++;
    // The phone app must open its own socket. (/show is the offline demo; /host is checked
    // in-page above because its app may still be a stub while it is being built.)
    if (r.name.endsWith('-phone') && !okSocket) bad++;
    // socket.io must go straight to websocket (never start on long-polling).
    if (r.sockets.some((u) => !u.includes('transport=websocket'))) bad++;
  }
  console.log(bad === 0 ? 'PASS' : `FAIL (${bad})`);
  process.exit(bad === 0 ? 0 : 1);
})();
