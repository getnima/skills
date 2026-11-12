// Drop-in art slots of icy and flappy: writes a loud test picture for EVERY slot the
// READMEs list (exact file names and pixel sizes), checks that each one replaces its
// placeholder (window.__icy.art / window.__flappy.art), screenshots it, then deletes
// every test file again (also on failure).
//   PARTY_CLIENT_PORT=5222 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/qa-icy-slots.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { phoneContext, createTouch, sleep, SIZES } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const ASSETS = path.join(__dirname, '..', '..', 'client', 'public', 'assets');
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}

// [game, file, w, h, transparent, hook key] exactly as the READMEs list them
const SLOTS = [
  ['icy', 'face.png', 256, 256, true, 'face'],
  ['icy', 'face_jump.png', 256, 256, true, 'faceJump'],
  ['icy', 'face_fall.png', 256, 256, true, 'faceFall'],
  ['icy', 'platform.png', 128, 32, false, 'platform'],
  ['icy', 'milestone.png', 128, 32, false, 'milestone'],
  ['icy', 'wall.png', 32, 256, false, 'wall'],
  ['icy', 'bg.png', 720, 1280, true, 'bg'],
  ['flappy', 'face.png', 256, 256, true, 'face'],
  ['flappy', 'face_flap.png', 256, 256, true, 'face_flap'],
  ['flappy', 'face_dead.png', 256, 256, true, 'face_dead'],
  ['flappy', 'wing.png', 128, 96, true, 'wing'],
  ['flappy', 'halo.png', 128, 48, true, 'halo'],
  ['flappy', 'obstacle.png', 280, 220, true, 'obstacle'],
  ['flappy', 'obstacle_pole.png', 96, 384, false, 'obstacle_pole'],
  ['flappy', 'ground.png', 512, 128, false, 'ground'],
  ['flappy', 'skyline.png', 1024, 320, true, 'skyline'],
  ['flappy', 'background.jpg', 860, 1864, false, 'background'],
];
const COLORS = ['#ff00aa', '#00d0ff', '#9dff00', '#ff8800', '#7a00ff', '#00ff99', '#ff2244', '#ffee00', '#0044ff'];

function readmeHas(game, file, w, h) {
  const md = fs.readFileSync(path.join(ASSETS, game, 'README.md'), 'utf8');
  const row = md.split('\n').find((l) => l.includes('`' + file + '`'));
  return !!row && new RegExp(`${w}\\s*x\\s*${h}`).test(row);
}

(async () => {
  const browser = await chromium.launch();
  const written = [];
  try {
    // README rows match the code's slots
    for (const [game, file, w, h] of SLOTS) check(`${game} README lists ${file} at ${w}x${h}`, readmeHas(game, file, w, h));
    // make the pictures in a page (a canvas per slot)
    const maker = await browser.newPage();
    for (let i = 0; i < SLOTS.length; i++) {
      const [game, file, w, h, transparent] = SLOTS[i];
      const color = COLORS[i % COLORS.length];
      const dataUrl = await maker.evaluate(
        ({ w, h, transparent, color, label, jpg }) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          if (!transparent) {
            g.fillStyle = color;
            g.fillRect(0, 0, w, h);
            g.fillStyle = '#000';
            for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 4, h);
          } else {
            g.fillStyle = color;
            g.beginPath();
            g.ellipse(w / 2, h / 2, w * 0.46, h * 0.46, 0, 0, Math.PI * 2);
            g.fill();
            g.lineWidth = Math.max(3, Math.min(w, h) * 0.06);
            g.strokeStyle = '#000';
            g.stroke();
          }
          g.fillStyle = '#fff';
          g.strokeStyle = '#000';
          g.lineWidth = 4;
          g.font = `900 ${Math.max(10, Math.min(w, h) * 0.2)}px sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.strokeText('TEST', w / 2, h / 2);
          g.fillText('TEST', w / 2, h / 2);
          void label;
          return c.toDataURL(jpg ? 'image/jpeg' : 'image/png', 0.9);
        },
        { w, h, transparent, color, label: file, jpg: file.endsWith('.jpg') },
      );
      const dest = path.join(ASSETS, game, file);
      if (fs.existsSync(dest)) throw new Error(`refusing to overwrite a real file: ${dest}`);
      fs.writeFileSync(dest, Buffer.from(dataUrl.split(',')[1], 'base64'));
      written.push(dest);
    }
    await maker.close();
    await sleep(1500); // let vite see the new files

    for (const game of ['icy', 'flappy']) {
      const context = await phoneContext(browser, '390x844');
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const hook = game === 'icy' ? '__icy' : '__flappy';
      await page.goto(`${BASE}/dev.html?game=${game}&seed=5&duration=30000`);
      await page.waitForFunction((h) => !!window[h], hook, { timeout: 15000 });
      const art = await page.evaluate((h) => window[h].art, hook);
      for (const [g, file, , , , key] of SLOTS.filter((s) => s[0] === game)) check(`${g}/${file} replaces the placeholder`, art[key] === true, { key, art: art[key] });
      const touch = await createTouch(context, page);
      const vp = SIZES['390x844'];
      if (game === 'icy') {
        await touch.down(1, vp.width * 0.8, vp.height * 0.6);
        await sleep(900);
        await touch.up(1);
      } else {
        for (let i = 0; i < 9; i++) {
          await touch.tap(vp.width / 2, vp.height / 2);
          await sleep(380);
        }
      }
      await page.screenshot({ path: path.join(__dirname, 'out', `qa-${game}`, 'slots-test-images.png') });
      check(`${game} with every test image: no errors`, errors.length === 0, errors);
      await context.close();
    }
  } finally {
    for (const f of written) fs.rmSync(f, { force: true });
    console.log('removed', written.length, 'test images');
    const left = SLOTS.filter(([game, file]) => fs.existsSync(path.join(ASSETS, game, file)));
    check('no test image left behind', left.length === 0, left.map((s) => s[1]));
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
