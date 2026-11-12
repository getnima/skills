// ninja food LOOK sheet: what the game's own art code makes of every picture.
// For each target (11 foods, 2 joke items, the gold falafel): the sprite as it flies, fitted
// into its hit circle (yellow ring), its two halves pulled apart, and its splat decals; then
// the two host bombs with the hit circle and the point the fuse starts at.
//   PARTY_CLIENT_PORT=5261 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   QA_BASE=http://localhost:5261 node tests/e2e/ninja-food-sheet.cjs [out.png] [missing=1]
// missing=1 hides every ninja picture from the page (the kit's file list is emptied by a
// stubbed module), so the sheet shows the drawn stand-ins.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.QA_BASE || 'http://localhost:5261';
const OUT = path.join(__dirname, 'out', 'ninja-food-look');
fs.mkdirSync(OUT, { recursive: true });
const file = process.argv[2] && !process.argv[2].includes('=') ? process.argv[2] : path.join(OUT, process.argv.includes('missing=1') ? 'sheet-missing.png' : 'sheet.png');
const MISSING = process.argv.includes('missing=1');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (MISSING) {
    // every picture request of the ninja folder fails: the game must fall back to its drawings
    await page.route('**/assets/ninja/**', (r) => r.abort());
    await page.route('**/assets/shimi/**', (r) => r.abort());
  }
  await page.goto(`${BASE}/dev.html?kit=1`);
  await page.waitForTimeout(400);
  const info = await page.evaluate(async () => {
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#10238C';
    const art = await import('/src/games/ninja/art.ts');
    const skins = await import('/src/games/ninja/skins.ts');
    const t0 = performance.now();
    const a = await art.loadNinjaArt();
    const tLoad = performance.now() - t0;
    const names = [...skins.TARGET_KEYS, 'gold_falafel'];
    const sprites = [...a.targets, a.golds[0]];
    const looks = [...a.cuts, a.goldCut];
    const t1 = performance.now();
    const halves = sprites.map((d, i) => art.buildHalves(d, looks[i]));
    const tHalves = performance.now() - t1;
    const t2 = performance.now();
    const splats = looks.map((l) => art.buildSplats(l, 2, 129, 2));
    const tSplats = performance.now() - t2;
    const CW = 300;
    const CH = 480;
    const cols = 5;
    const rows = Math.ceil(sprites.length / cols);
    const c = document.createElement('canvas');
    const W = cols * CW;
    const H = rows * CH + 330;
    c.width = W * 2;
    c.height = H * 2;
    c.style.cssText = `width:${W}px;height:${H}px;display:block`;
    document.body.appendChild(c);
    const g = c.getContext('2d');
    g.scale(2, 2);
    g.fillStyle = '#10238C';
    g.fillRect(0, 0, W, H);
    g.font = '700 13px system-ui';
    g.textAlign = 'center';
    const R = 43; // a 390 px wide phone
    const hit = R * 1.05;
    /** The two halves around (x, y), `gap` apart, `k` times the phone size, the cut turned by `turn`. */
    const pair = (i, x, y, k, gap, turn) => {
      const [up, lo] = halves[i];
      g.save();
      g.translate(x, y);
      g.rotate(turn);
      art.drawSprite(g, up, 0, -gap, hit * k);
      art.drawSprite(g, lo, 0, gap, hit * k);
      g.restore();
    };
    sprites.forEach((d, i) => {
      const x0 = (i % cols) * CW;
      const y0 = Math.floor(i / cols) * CH;
      // as it flies, at phone size, with the hit circle
      art.drawSprite(g, d, x0 + 75, y0 + 85, hit);
      // (dashed: the trimmed box the game blits)
      g.setLineDash([3, 3]);
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.strokeRect(x0 + 75 + d.left * hit, y0 + 85 + d.top * hit, d.width * hit, d.height * hit);
      g.setLineDash([]);
      g.strokeStyle = '#FFD21F';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x0 + 75, y0 + 85, hit, 0, Math.PI * 2);
      g.stroke();
      // its halves at phone size, as after a diagonal swipe
      pair(i, x0 + 215, y0 + 85, 1, 14, -0.5);
      // the halves twice as big, to judge the cut face
      pair(i, x0 + 150, y0 + 255, 2, 24, 0);
      // the decals at their own size (3 R)
      splats[i].forEach((s, k) => g.drawImage(s, x0 + 12 + k * 140, y0 + CH - 136, 129, 129));
      g.fillStyle = '#fff';
      g.fillText(`${names[i]}${a.real[names[i]] ? '' : ' (drawn)'}  ${looks[i].splashKind}`, x0 + CW / 2, y0 + 16);
    });
    // the bombs: big, with the hit circle and the fuse start; and at phone size
    const by = rows * CH + 190;
    a.bombs.forEach((b, i) => {
      for (const [r, bx] of [[105, 180 + i * 520], [hit, 430 + i * 520]]) {
        art.drawSprite(g, b, bx, by, r);
        g.strokeStyle = '#FFD21F';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(bx, by, r, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = '#ff3b3b';
        g.beginPath();
        g.moveTo(bx + art.BOMB_CAP_X * r - 12, by + art.BOMB_CAP_Y * r);
        g.lineTo(bx + art.BOMB_CAP_X * r + 12, by + art.BOMB_CAP_Y * r);
        g.stroke();
      }
      g.fillStyle = '#fff';
      g.fillText(`${b.key}${b.isPlaceholder ? ' (drawn)' : ''}`, 180 + i * 520, by + 128);
    });
    return { tLoad: Math.round(tLoad), tHalves: +tHalves.toFixed(1), tSplats: +tSplats.toFixed(1), real: a.real, W, H, px: { targets: Object.fromEntries(sprites.map((d, i) => [names[i], `${d.source.width}x${d.source.height}`])), halves: Object.fromEntries(halves.map((h, i) => [names[i], h.map((c) => `${c.source.width}x${c.source.height}`).join(' ')])), bombs: a.bombs.map((b) => `${b.source.width}x${b.source.height}`) } };
  });
  await page.setViewportSize({ width: info.W, height: info.H });
  await page.waitForTimeout(200);
  await page.screenshot({ path: file });
  console.log(JSON.stringify(info));
  console.log(errors.length ? `ERRORS ${JSON.stringify(errors.slice(0, 5))}` : `ok   sheet → ${file}`);
  await browser.close();
  process.exit(errors.length && !MISSING ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
