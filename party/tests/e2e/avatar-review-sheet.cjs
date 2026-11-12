// Contact sheets through the real avatar pipeline (avatarUrl). Needs vite on AVATAR_PORT (default 5296).
// node tests/e2e/avatar-review-sheet.cjs <name> <spec.json | inline json> [sizes=28,40,64,128,256] [cols=1]
//   spec: [{ label, look, crop?, sizes?, full? }]  ->  tests/e2e/out/avatar-review/<name>.png
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const PORT = process.env.AVATAR_PORT || 5296;
(async () => {
  const [name = 'sheet', spec = '[]', sizesArg = '28,40,64,128,256', colsArg = '1'] = process.argv.slice(2);
  const rows = JSON.parse(fs.existsSync(spec) ? fs.readFileSync(spec, 'utf8') : spec);
  const sizes = sizesArg.split(',').map(Number);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://localhost:${PORT}/avatar-lab.html?view=wall&n=1`);
  await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 120000, polling: 250 });
  await page.evaluate(async ({ rows, sizes, cols }) => {
    const m = await import('/src/avatar/index.ts');
    await m.preloadAvatarAssets();
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;padding:10px;background:#10238C;color:#fff;font:12px system-ui;direction:ltr';
    const wrap = document.createElement('div');
    wrap.id = 'sheet';
    wrap.style.cssText = `display:grid;grid-template-columns:repeat(${cols},auto);gap:8px 18px;width:max-content;background:#10238C;padding:6px`;
    document.body.append(wrap);
    for (const r of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-end;gap:8px';
      if (r.label !== undefined) {
        const lab = document.createElement('div');
        lab.textContent = r.label;
        lab.style.cssText = 'width:86px;align-self:center;word-break:break-word';
        row.append(lab);
      }
      const list = (r.sizes || sizes).map((s) => [s, r.crop || 'icon']);
      if (r.full) list.push([r.full, 'full']);
      for (const [s, crop] of list) {
        const url = await m.avatarUrl(r.look, s, crop);
        const img = new Image();
        img.src = url;
        img.style.cssText = `width:${s}px;height:${s}px;border-radius:24%`;
        await img.decode().catch(() => {});
        row.append(img);
      }
      wrap.append(row);
    }
  }, { rows, sizes, cols: Number(colsArg) });
  await page.waitForTimeout(300);
  const out = path.join(__dirname, 'out', 'avatar-review', `${name}.png`);
  await (await page.$('#sheet')).screenshot({ path: out });
  console.log(out, errors.length ? errors : 'no errors');
  await browser.close();
})();
