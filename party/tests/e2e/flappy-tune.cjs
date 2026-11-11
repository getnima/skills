// Flappy difficulty probe: an in-page bot with human-like reaction noise.
//   node tests/e2e/flappy-tune.cjs  (vite on :5213)
const { chromium, devices } = require('playwright');
const BASE = process.env.FLAPPY_BASE || 'http://localhost:5213';

async function probe(label, noiseMs, aimNoise, seed) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await context.newPage();
  await page.goto(`${BASE}/dev.html?game=flappy&seed=${seed}&duration=60000`);
  await page.waitForFunction(() => !!window.__flappy);
  const res = await page.evaluate(
    ({ noiseMs, aimNoise }) =>
      new Promise((resolve) => {
        const canvas = document.querySelector('.pa-stage-game canvas');
        let pending = 0;
        let lastTap = 0;
        let rs = 99;
        const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
        let aimOff = 0;
        let lastNext = -1;
        let last = null;
        function tap() {
          const o = { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 500, isPrimary: true };
          canvas.dispatchEvent(new PointerEvent('pointerdown', o));
          canvas.dispatchEvent(new PointerEvent('pointerup', o));
        }
        function frame(now) {
          const f = window.__flappy;
          if (!f || window.__party.ended) return resolve(last);
          last = { runs: f.runs, best: f.best, score: window.__party.score };
          if (f.next.x !== lastNext) { lastNext = f.next.x > lastNext ? lastNext : f.next.x; }
          if (f.mode === 'hover' && now - lastTap > 500) { tap(); lastTap = now; }
          if (f.mode === 'fly' || f.mode === 'glide') {
            const n = f.next;
            const aim = (n.x < 34 ? n.gapY + n.gap * 0.2 : 50) + aimOff;
            if (!pending && f.birdY > aim && f.vy > -30 && now - lastTap > 120) {
              pending = now + rnd() * noiseMs;
              aimOff = (rnd() - 0.5) * aimNoise;
            }
            if (pending && now >= pending) { tap(); pending = 0; lastTap = now; }
          }
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }),
    { noiseMs, aimNoise },
  );
  console.log(label, 'seed', seed, 'runs', JSON.stringify(res.runs), 'score', res.score);
  await browser.close();
}

(async () => {
  for (const seed of [7, 11]) {
    await probe('expert   ', 20, 2, seed);
    await probe('average  ', 110, 10, seed);
    await probe('beginner ', 200, 16, seed);
  }
})();
