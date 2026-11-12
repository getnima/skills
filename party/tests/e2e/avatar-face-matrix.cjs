// Matrix of looks through the real avatar pipeline (avatarUrl, as <Avatar> uses it).
// node tests/e2e/avatar-face-matrix.cjs <name> '<rows json>' '<cols json>' [size=96] [crop=icon]
//   rows / cols: [{ "label": "201", "look": { "eyes": 201 } }, ...]; each cell = defaultLook + row + col
//   (a col "head": [..] replaces the row's). Writes tests/e2e/out/avatar-face/<name>.png. Needs vite on AVATAR_PORT (5293).
const { chromium } = require('playwright');
const path = require('path');

const PORT = process.env.AVATAR_PORT || 5293;
(async () => {
  const [name = 'matrix', rowsJson = '[]', colsJson = '[]', sizeArg = '96', crop = 'icon'] = process.argv.slice(2);
  const rows = JSON.parse(rowsJson);
  const cols = JSON.parse(colsJson);
  const size = Number(sizeArg);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://localhost:${PORT}/avatar-lab.html?view=wall&n=1`);
  await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 120000, polling: 250 });
  await page.evaluate(async ({ rows, cols, size, crop }) => {
    const m = await import('/src/avatar/index.ts');
    await m.preloadAvatarAssets();
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;padding:12px;background:#2a2a33;color:#fff;font:13px system-ui;direction:ltr';
    const t = document.createElement('table');
    t.id = 'sheet';
    t.style.cssText = 'border-spacing:8px';
    const head = document.createElement('tr');
    head.append(document.createElement('td'));
    for (const c of cols) {
      const td = document.createElement('td');
      td.textContent = c.label;
      td.style.textAlign = 'center';
      head.append(td);
    }
    t.append(head);
    for (const r of rows) {
      const tr = document.createElement('tr');
      const lab = document.createElement('td');
      lab.textContent = r.label;
      tr.append(lab);
      for (const c of cols) {
        const look = { ...m.defaultLook(), ...r.look, ...c.look };
        const url = await m.avatarUrl(m.normalizeLook(look), size, crop);
        const img = new Image();
        img.src = url;
        img.style.cssText = `width:${size}px;height:${size}px;border-radius:24%`;
        await img.decode().catch(() => {});
        const td = document.createElement('td');
        td.append(img);
        tr.append(td);
      }
      t.append(tr);
    }
    document.body.append(t);
  }, { rows, cols, size, crop });
  await page.waitForTimeout(300);
  const out = path.join(__dirname, 'out', 'avatar-face', `${name}.png`);
  await (await page.$('#sheet')).screenshot({ path: out });
  console.log(out, errors.length ? errors : 'no console errors / 404s');
  await browser.close();
})();
