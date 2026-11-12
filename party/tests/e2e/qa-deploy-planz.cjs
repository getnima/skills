// qa-deploy-planz: plan Z, no cloud. The built server on the laptop (`npm run build && npm start`),
// the TV page opened on the laptop as http://localhost:<port>/host. The QR / join URL must point at
// the laptop's LAN address (from GET /api/info), never at localhost, so phones on the Wi-Fi can open it.
//   PORT=8825 npm start      then      PORT=8825 node tests/e2e/qa-deploy-planz.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || '8825';
const OUT = path.join(__dirname, 'out', 'qa-deploy');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await p.goto(`http://localhost:${PORT}/host`);
  await p.waitForSelector('[data-testid=room-code]', { timeout: 15000 });
  await p.waitForFunction(() => !/localhost|127\.0\.0\.1/.test(document.querySelector('[data-testid=join-url]').textContent), null, { timeout: 5000 }).catch(() => null);
  const join = (await p.textContent('[data-testid=join-url]')).trim();
  const info = await p.evaluate(() => fetch('/api/info').then((r) => r.json()));
  await p.screenshot({ path: path.join(OUT, 'planz-tv-localhost.png') });
  await b.close();
  const ok = !/localhost|127\.0\.0\.1/.test(join) && info.lanIps.some((ip) => join.includes(`${ip}:${PORT}`));
  console.log(`/api/info ${JSON.stringify(info)}\nTV opened on localhost shows join URL: ${join}\n${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
})();
