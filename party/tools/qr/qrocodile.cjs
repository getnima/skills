// Make a designed QR code with QRocodile (https://qrocodile.io, a free in-browser generator: nothing is
// uploaded, the code is rendered on this machine by their page) and check that it really decodes.
//
//   node tools/qr/qrocodile.cjs --url https://example.com/j --photo tools/qr/art/shimi-sun.png --out qr.png
//   node tools/qr/qrocodile.cjs --url https://example.com/j --preset "Comic Bricks" --logo tools/qr/art/logo.png --out qr.png
//
//   --url     what the code opens (required)
//   --photo   "photo" mode: the code is laid over this picture as small dots (the Shimi look)
//   --preset  "styled" mode: one of the generator's presets by its name on the page (default "Classic")
//   --logo    styled mode: a picture for the middle of the code
//   --color   dot colour as hex (photo mode), default #16120E
//   --shape   circle | square (photo mode), default circle
//   --size    pixels, default 1600
//   --json    also write <out>.json = { url, mode, scanCheck, decoded } next to the picture
//
// Exit code 1 when the picture does not decode back to exactly --url (checked scaled down to 600, 420
// and 260 px, the way a phone sees a code on a TV across the room).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    const v = a[i + 1] !== undefined && !a[i + 1].startsWith('--') ? a[++i] : 'true';
    out[k] = v;
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Decode with jsQR inside a blank page (canvas does the PNG decoding); returns the text at each width, or null. */
async function decodeAt(browser, file, widths) {
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  await page.addScriptTag({ path: require.resolve('jsqr/dist/jsQR.js') });
  const b64 = fs.readFileSync(file).toString('base64');
  const res = await page.evaluate(
    async ({ b64, widths }) => {
      const img = new Image();
      await new Promise((ok, bad) => {
        img.onload = ok;
        img.onerror = bad;
        img.src = 'data:image/png;base64,' + b64;
      });
      const out = {};
      for (const w of widths) {
        const size = w === 0 ? img.naturalWidth : w;
        const c = document.getElementById('c');
        c.width = size;
        c.height = size;
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, size, size);
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, size, size);
        const d = g.getImageData(0, 0, size, size);
        const r = window.jsQR(d.data, size, size, { inversionAttempts: 'attemptBoth' });
        out[w === 0 ? `full:${size}` : String(w)] = r ? r.data : null;
      }
      return out;
    },
    { b64, widths },
  );
  await page.close();
  return res;
}

(async () => {
  const o = args();
  if (!o.url || !o.out) {
    console.error('usage: qrocodile.cjs --url <url> --out <file.png> [--photo <image> | --preset <name> [--logo <image>]] [--size 1600]');
    process.exit(2);
  }
  const size = Math.max(256, Math.min(4096, Number(o.size || 1600)));
  const mode = o.photo ? 'photo' : 'styled';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto('https://qrocodile.io/en/', { waitUntil: 'networkidle', timeout: 90000 });
  const tab = async (name) => {
    await page.getByRole('button', { name, exact: true }).first().click();
    await sleep(700);
  };

  if (mode === 'photo') {
    await page.getByRole('button', { name: /Add to a Photo/ }).first().click();
    await sleep(1200);
    await page.locator('input[type=file]').first().setInputFiles(path.resolve(o.photo));
    await sleep(2000);
    await tab('Content');
    await page.fill('#url-url', o.url);
    await sleep(600);
    await tab('Settings');
    const color = o.color || '#16120E';
    const hex = page.locator('input[type=text]').first();
    await hex.fill(color);
    await hex.press('Enter');
    await sleep(400);
    await page.getByRole('button', { name: (o.shape || 'circle').toLowerCase() === 'square' ? 'Square' : 'Circle', exact: true }).first().click();
    await sleep(600);
  } else {
    await page.fill('input[type="text"]', o.url);
    await page.keyboard.press('Enter');
    await sleep(1800);
    if (o.preset && o.preset !== 'Classic') {
      await tab('Presets');
      await page.getByRole('button', { name: o.preset, exact: true }).first().click();
      await sleep(1500);
    }
    if (o.logo) {
      await tab('Logo');
      await page.locator('input[type=file]').first().setInputFiles(path.resolve(o.logo));
      await sleep(2000);
    }
  }

  // the page's own scan check, as shown under the preview
  const scanCheck = await page.evaluate(() => {
    const m = /Scan check:[^·\n]*·\s*\d\/\d/.exec(document.body.innerText || '');
    return m ? m[0].replace(/\s+/g, ' ').trim() : null;
  });

  // export size, then the PNG button
  await page.evaluate((px) => {
    const r = document.querySelector('#export-size');
    if (!r) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(r, String(px));
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  }, size);
  await sleep(600);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'PNG', exact: true }).first().click()]);
  const outFile = path.resolve(o.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await download.saveAs(outFile);

  // a phone never sees the full-size picture: it sees it small and a little soft, so that is what is checked
  const decoded = await decodeAt(browser, outFile, [600, 420, 260]);
  await browser.close();
  const ok = Object.values(decoded).every((v) => v === o.url);
  if (o.json) fs.writeFileSync(outFile + '.json', JSON.stringify({ url: o.url, mode, scanCheck, decoded }, null, 1));
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${path.basename(outFile)} mode=${mode} ${scanCheck || '(no scan check shown)'} decoded=${JSON.stringify(decoded)}`);
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
