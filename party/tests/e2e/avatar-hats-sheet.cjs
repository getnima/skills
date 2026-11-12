// Contact sheet of looks through the real avatar pipeline (avatarUrl, the same path <Avatar> uses).
// node tests/e2e/avatar-hats-sheet.cjs <name> '<rows json>' [sizes=28,64,256] [dpr=1]
//   rows: [{ "label": "101 halo", "look": "1.0.101.0.0.0.0" | {..AvatarLook}, "crop": "icon" }, ...]
//   a row may carry "sizes" of its own. Writes tests/e2e/out/avatar-hats/<name>.png
// Needs vite on AVATAR_PORT (default 5292).
const { chromium } = require('playwright');
const path = require('path');

const PORT = process.env.AVATAR_PORT || 5292;
(async () => {
  const [name = 'sheet', rowsJson = '[]', sizesArg = '28,64,256', dprArg = '1'] = process.argv.slice(2);
  const rows = JSON.parse(rowsJson);
  const sizes = sizesArg.split(',').map(Number);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: Number(dprArg) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/avatar-lab.html?view=wall&n=1`);
  await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 90000, polling: 250 });
  const info = await page.evaluate(async ({ rows, sizes }) => {
    const m = await import('/src/avatar/index.ts');
    await m.preloadAvatarAssets();
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;padding:12px;background:#2a2a33;color:#fff;font:13px system-ui;direction:ltr';
    const wrap = document.createElement('div');
    wrap.id = 'sheet';
    wrap.style.cssText = 'display:inline-flex;flex-direction:column;gap:10px';
    document.body.append(wrap);
    for (const r of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-end;gap:12px';
      const lab = document.createElement('div');
      lab.textContent = r.label;
      lab.style.cssText = 'width:150px;align-self:center';
      row.append(lab);
      for (const s of r.sizes || sizes) {
        const url = await m.avatarUrl(r.look, s, r.crop || 'icon');
        const img = new Image();
        img.src = url;
        img.style.cssText = `width:${s}px;height:${s}px;${r.round === false ? '' : 'border-radius:50%;'}`;
        await img.decode().catch(() => {});
        row.append(img);
      }
      wrap.append(row);
    }
    return { problems: m.CATALOG_PROBLEMS, hats: m.itemsOfSlot('HEAD').map((i) => i.id) };
  }, { rows, sizes });
  await page.waitForTimeout(300);
  const out = path.join(__dirname, 'out', 'avatar-hats', `${name}.png`);
  await (await page.$('#sheet')).screenshot({ path: out });
  console.log(out, JSON.stringify(info), errors.length ? errors : '');
  await browser.close();
})();
