// Renders client/public/icons/icon.svg to the PNG sizes the manifest and iOS need.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '../../client/public/icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = [
    ['icon-192.png', 192, 0],
    ['icon-512.png', 512, 0],
    ['apple-touch-icon.png', 180, 0],
    ['icon-maskable-512.png', 512, 0.12],
  ];
  for (const [name, size, pad] of out) {
    const inner = Math.round(size * (1 - pad * 2));
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:#150a33;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">` +
        `<img style="width:${inner}px;height:${inner}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`,
    );
    await page.screenshot({ path: path.join(dir, name), omitBackground: false });
  }
  await browser.close();
  console.log('icons written');
})();
