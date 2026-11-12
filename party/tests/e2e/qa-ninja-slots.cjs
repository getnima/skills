// Drop-in art slots of tap + ninja: a test picture saved under a slot's name replaces the
// placeholder (and another extension of the same base name works too); removing it brings
// the placeholder back. The test pictures are written, checked, and deleted again.
//   node tests/e2e/qa-ninja-slots.cjs        (needs python3 + Pillow to make the test PNGs)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium, check, fails, sleep, outDir, openGame } = require('./qa-tap-lib.cjs');

const PUB = path.join(__dirname, '..', '..', 'client', 'public', 'assets');
// slot → file to drop (one of them with another extension than the code names)
const DROPS = [
  ['tap', 'face_normal.png', '#00c853'],
  ['tap', 'face_nosepick.webp', '#00b8d4'],
  ['tap', 'background.jpg', '#263238'],
  ['ninja', 'target_1.png', '#00c853'],
  ['ninja', 'bomb.png', '#212121'],
  ['ninja', 'background.jpg', '#263238'],
];

function makeImages() {
  const py = `
import sys
from PIL import Image, ImageDraw
for spec in sys.argv[1:]:
    p, color = spec.split('|')
    w, h = (540, 1170) if 'background' in p else (512, 512)
    mode = 'RGB' if p.endswith('.jpg') else 'RGBA'
    im = Image.new(mode, (w, h), (0, 0, 0, 0) if mode == 'RGBA' else color)
    d = ImageDraw.Draw(im)
    if 'background' in p:
        for y in range(0, h, 60):
            d.rectangle([0, y, w, y + 30], fill='#37474f')
    else:
        d.ellipse([20, 20, w - 20, h - 20], fill=color, outline='white', width=16)
        d.line([120, 260, 220, 360, 400, 160], fill='white', width=40)  # a big check mark: obviously a test picture
    im.save(p, quality=90) if p.endswith('.jpg') else im.save(p)
`;
  execFileSync('python3', ['-c', py, ...DROPS.map(([g, f, c]) => `${path.join(PUB, g, f)}|${c}`)]);
}
function removeImages() {
  for (const [g, f] of DROPS) fs.rmSync(path.join(PUB, g, f), { force: true });
}

async function loaded(page) {
  return page.evaluate(() => performance.getEntriesByType('resource').map((e) => decodeURIComponent(new URL(e.name).pathname)).filter((p) => p.startsWith('/assets/')));
}

(async () => {
  const OUT = outDir('qa-ninja');
  const OUTT = outDir('qa-tap');
  const browser = await chromium.launch();
  try {
    makeImages();
    await sleep(1500); // let vite see the new files
    for (const game of ['tap', 'ninja']) {
      const { page, context } = await openGame(browser, game, { viewport: { width: 390, height: 844 }, query: 'seed=4&duration=60000' });
      await sleep(game === 'tap' ? 6500 : 2500); // tap: until the first nose-pick (seed 4 at ~5.6 s)
      const got = await loaded(page);
      const want = DROPS.filter(([g]) => g === game).map(([g, f]) => `/assets/${g}/${f}`);
      check(`${game}: every dropped test file is loaded by its slot`, want.every((w) => got.includes(w)), { want, got });
      await page.screenshot({ path: path.join(game === 'tap' ? OUTT : OUT, `slots-1-test-art.png`) });
      await context.close();
    }
  } finally {
    removeImages();
  }
  await sleep(1500);
  for (const game of ['tap', 'ninja']) {
    const { page, context } = await openGame(browser, game, { viewport: { width: 390, height: 844 }, query: 'seed=4&duration=60000' });
    await sleep(1500);
    const got = await loaded(page);
    check(`${game}: test files removed, placeholders back (no /assets/${game}/ request)`, !got.some((p) => p.startsWith(`/assets/${game}/`)), got);
    await page.screenshot({ path: path.join(game === 'tap' ? OUTT : OUT, `slots-2-placeholders.png`) });
    await context.close();
  }
  const left = DROPS.filter(([g, f]) => fs.existsSync(path.join(PUB, g, f)));
  check('no test picture left in client/public/assets', left.length === 0, left);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
