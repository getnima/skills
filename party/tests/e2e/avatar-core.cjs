// Avatar core proof. Needs: PARTY_CLIENT_PORT=5291 PARTY_SERVER_PORT=8291 npx vite   (then: node tests/e2e/avatar-core.cjs)
// 1. screenshots of every lab view
// 2. proof view: the source page's DOM placement vs composeAvatar, pixel by pixel
// 3. wall of 60 and 120 looks on a 4x throttled CPU: time and cache memory
// 4. a picture that 404s: nothing throws, the avatar still shows
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AVATAR_PORT || 5291;
const BASE = `http://localhost:${PORT}/avatar-lab.html`;
const OUT = path.join(__dirname, 'out', 'avatar-core');
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const check = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); if (!ok) fails.push(text); };

async function open(browser, query, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width || 1500, height: opts.height || 900 }, deviceScaleFactor: opts.dpr || 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  if (opts.before) await opts.before(page, ctx);
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 120000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch();

  // ── 1. every view ──
  for (const [query, name, width] of [['view=items', 'view-items', 1900], ['view=slots', 'view-slots', 1500], ['view=wall&seed=7', 'view-wall', 1500], ['view=room', 'view-room', 900]]) {
    const { ctx, page, errors } = await open(browser, query, { width });
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    const lab = await page.evaluate(() => window.__avatarLab);
    check(errors.length === 0 && lab.errors.length === 0, `${name}: no errors ${JSON.stringify([...errors, ...lab.errors])}`);
    if (name === 'view-items') {
      const n = await page.locator('[data-item]').count();
      const imgs = await page.evaluate(() => [...document.querySelectorAll('.av')].every((a) => { const i = a.querySelector('img'); return i && i.complete && i.naturalWidth > 0; }));
      check(n >= 17 && imgs, `items view: ${n} items, every avatar has a loaded picture`);
    }
    if (name === 'view-room') {
      const text = await page.locator('#room').innerText();
      console.log(`     room view says: ${text.replace(/\s+/g, ' ').slice(0, 80)}`);
    }
    await ctx.close();
  }

  // ── 2. proof: source DOM vs compositor ──
  {
    const { ctx, page, errors } = await open(browser, 'view=proof', { width: 1700 });
    await page.screenshot({ path: path.join(OUT, 'view-proof.png'), fullPage: true });
    await page.waitForFunction(() => [...document.querySelectorAll('canvas[data-proof]')].every((c) => c.dataset.done === '1'));
    const cases = await page.locator('[data-case]').all();
    const diffPage = await ctx.newPage();
    let worst = { name: '', mean: 0, bad: 0 };
    const rows = [];
    for (const c of cases) {
      const name = await c.getAttribute('data-case');
      const a = (await c.locator('[data-proof="src"]').screenshot()).toString('base64');
      const b = (await c.locator('[data-proof="ours"]').screenshot()).toString('base64');
      const d = await diffPage.evaluate(async ([a64, b64]) => {
        const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${s}`; });
        const [ia, ib] = await Promise.all([load(a64), load(b64)]);
        const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
        const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
        const pa = px(ia), pb = px(ib);
        let sum = 0, bad = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const dd = (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])) / 3;
          sum += dd; if (dd > 48) bad++;
        }
        return { mean: sum / (w * h), bad: bad / (w * h), w, h };
      }, [a, b]);
      rows.push({ name, ...d });
      if (d.bad > worst.bad) worst = { name, ...d };
    }
    const meanAll = rows.reduce((s, r) => s + r.mean, 0) / rows.length;
    console.log(`     proof: ${rows.length} cases, mean abs diff ${meanAll.toFixed(2)} / 255, worst case "${worst.name}" ${(worst.bad * 100).toFixed(2)}% pixels off by > 48 (mean ${worst.mean.toFixed(2)})`);
    // resampling differs (browser img scaling vs mip + canvas), so edges differ a little; a misplaced item would be many %
    check(rows.every((r) => r.bad < 0.02 && r.mean < 4), `proof: all ${rows.length} cases match the source placement (each < 2% pixels off, mean < 4)`);
    check(errors.length === 0, `proof: no errors ${JSON.stringify(errors)}`);
    fs.writeFileSync(path.join(OUT, 'proof-diff.json'), JSON.stringify(rows, null, 1));
    await ctx.close();
  }

  // ── 3. wall timing on a 4x throttled CPU ──
  for (const n of [60, 120]) {
    const { ctx, page, errors } = await open(browser, `view=wall&n=${n}&seed=3`, {
      before: async (p, c) => { const cdp = await c.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); },
    });
    const lab = await page.evaluate(() => window.__avatarLab);
    const loaded = await page.evaluate(() => [...document.querySelectorAll('.av img')].filter((i) => i.complete && i.naturalWidth > 0).length);
    console.log(`     wall n=${n} (x3 sizes: 28, 40, 96 css px -> 48, 48, 96 device px), 4x CPU: ${lab.wallMs.toFixed(0)} ms, cache ${lab.cache.entries} pictures ${(lab.cache.bytes / 1024).toFixed(0)} KB, ${loaded} <img> loaded`);
    check(lab.wallMs < 1500, `wall n=${n}: composed and shown in ${lab.wallMs.toFixed(0)} ms (< 1500)`);
    check(loaded === n * 3 && errors.length === 0, `wall n=${n}: all ${n * 3} pictures shown, no errors ${JSON.stringify(errors)}`);
    if (n === 60) {
      // the TV lobby at 60 players: 28 px icons, magnified 4x to judge readability
      const wall = page.locator('[data-wall="28"]');
      await wall.screenshot({ path: path.join(OUT, 'wall-28px-60.png') });
      await page.evaluate(() => { const w = document.querySelector('[data-wall="28"]'); w.style.zoom = '1'; });
    }
    await ctx.close();
  }
  {
    // the same 28 px wall on a 1x screen, blown up 4x with nearest neighbour: what the pixels really hold
    const { ctx, page } = await open(browser, 'view=wall&n=60&seed=3', { width: 1000 });
    const buf = (await page.locator('[data-wall="28"]').screenshot()).toString('base64');
    const p2 = await ctx.newPage();
    await p2.setViewportSize({ width: 1600, height: 900 });
    await p2.setContent(`<body style="margin:0;background:#10238c"><img src="data:image/png;base64,${buf}" style="width:400%;image-rendering:pixelated;display:block">`);
    await p2.waitForTimeout(200);
    await p2.screenshot({ path: path.join(OUT, 'wall-28px-60-x4.png'), fullPage: false });
    await ctx.close();
  }

  // ── 4. a picture that 404s ──
  {
    const { ctx, page, errors } = await open(browser, 'view=slots&break=10', {
      before: async (p) => { await p.route('**/prop_08_crown.png', (r) => r.fulfill({ status: 404, body: 'gone' })); },
    });
    await page.screenshot({ path: path.join(OUT, 'broken-pictures.png'), fullPage: true });
    const lab = await page.evaluate(() => window.__avatarLab);
    const shown = await page.evaluate(() => [...document.querySelectorAll('.av')].every((a) => { const i = a.querySelector('img'); return i && i.complete && i.naturalWidth > 0; }));
    check(errors.length === 0 && lab.errors.length === 0, `404: nothing throws ${JSON.stringify([...errors, ...lab.errors])}`);
    check(shown, '404: every avatar still shows a picture (the broken items are simply not worn)');
    await ctx.close();
  }
  {
    // the doll itself is missing
    const { ctx, page, errors } = await open(browser, 'view=slots', {
      before: async (p) => { await p.route('**/doll.png', (r) => r.fulfill({ status: 404, body: 'gone' })); },
    });
    await page.screenshot({ path: path.join(OUT, 'broken-doll.png'), fullPage: false });
    const lab = await page.evaluate(() => window.__avatarLab);
    check(errors.length === 0 && lab.errors.length === 0, `doll 404: nothing throws ${JSON.stringify([...errors, ...lab.errors])}`);
    await ctx.close();
  }

  await browser.close();
  console.log(fails.length === 0 ? '\nALL OK' : `\n${fails.length} FAILED:\n - ${fails.join('\n - ')}`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
