// qa-tv-look-qr: the size of the designed QR (assets/host/qr.png + qr.json, see lobby.tsx) on the
// TV lobby, before the first round and between rounds, at 1920x1080 and 1280x720. It must be at
// least 420 px of a 1080p board. Needs a tree with both files whose qr.json url is the page's
// own origin + '/j': open the page through a host name mapped to this machine, e.g.
//   MAP_HOST=party.test BASE_URL=http://party.test:5292 SERVER_URL=http://localhost:8881 node tests/e2e/qa-tv-look-qr.cjs
// (qr.json = { "url": "http://party.test:5292/j" }; the vite config must allow that Host header).
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const BASE = process.env.BASE_URL;
const SERVER = process.env.SERVER_URL;
const MAP = process.env.MAP_HOST || '';
(async () => {
  const b = await chromium.launch(MAP ? { args: [`--host-resolver-rules=MAP ${MAP} 127.0.0.1`, '--proxy-server=direct://', '--proxy-bypass-list=*'] } : {});
  for (const vp of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const p = await b.newPage({ viewport: vp });
    await p.goto(BASE + '/host.html');
    await p.waitForFunction(() => window.__host && window.__host.status() === 'online' && window.__host.state(), null, { timeout: 30000 });
    const code = await p.evaluate(() => window.__host.state().code);
    const measure = () => p.evaluate(() => {
      const img = document.querySelector('[data-testid=qr-designed]');
      if (!img) return null;
      const r = img.getBoundingClientRect();
      const ratio = img.naturalWidth / img.naturalHeight;
      // the drawn picture inside the box (object-fit: contain)
      const drawn = Math.min(r.width, r.height * ratio);
      return { box: [Math.round(r.width), Math.round(r.height)], drawn1080: Math.round((drawn * 1080) / innerHeight) };
    });
    await p.waitForSelector('[data-testid=qr-designed]', { timeout: 10000 });
    const first = await measure();
    // a finished round puts the lobby in its "between rounds" layout
    const s = io(SERVER, { transports: ['websocket'], forceNew: true });
    await new Promise((r) => s.once('connect', r));
    await new Promise((r) => s.emit('player:join', { code, name: 'דנה' }, r));
    await p.mouse.click(vp.width / 2, 6);
    await p.waitForTimeout(1700);
    await p.keyboard.press('Space');
    await p.waitForFunction(() => window.__host.state().phase === 'playing', null, { timeout: 30000 });
    await p.keyboard.press('KeyE');
    await p.waitForTimeout(700);
    await p.keyboard.press('KeyE');
    await p.waitForFunction(() => window.__host.state().phase === 'results', null, { timeout: 30000 });
    await p.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
    await p.keyboard.press('Space');
    await p.waitForFunction(() => window.__host.state().phase === 'lobby', null, { timeout: 10000 });
    await p.waitForTimeout(1200);
    const between = await measure();
    console.log(`${vp.width}x${vp.height}`, JSON.stringify({ first, between }));
    s.close();
    await p.close();
  }
  await b.close();
})();
