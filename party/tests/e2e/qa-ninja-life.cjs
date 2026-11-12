// Lifecycle of tap + ninja in ONE page, like a party night: create → play → destroy,
// destroy twice, create again, 5 rounds in a row. Checks: no window/document/canvas
// listeners left after destroy, nothing keeps drawing after destroy, heap does not grow
// round over round, frame time does not creep up. Rounds are played by an in-page bot
// that dispatches pointer events on the canvas (the scoring bots use real CDP touches).
//   node tests/e2e/qa-ninja-life.cjs
const { chromium, check, fails, sleep, BASE } = require('./qa-tap-lib.cjs');

const ROUND_MS = 9000;

async function listenerCount(cdp, expr) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  return listeners.length;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
  // a page of the app that loads the kit css, then we drive the modules by hand
  await page.goto(`${BASE}/dev.html?kit=1`);
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    document.body.innerHTML = '';
    window.__mods = {
      tap: await import('/src/games/tap/index.ts'),
      ninja: await import('/src/games/ninja/index.ts'),
    };
  });

  // the harness' own once-only pointerdown listener (audio unlock) goes on the first event: fire it first
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown')));
  for (const game of ['tap', 'ninja']) {
    const base = { win: await listenerCount(cdp, 'window'), doc: await listenerCount(cdp, 'document') };
    const rounds = [];
    for (let r = 0; r < 5; r++) {
      const res = await page.evaluate(
        async ({ game, ROUND_MS, r }) => {
          const root = document.createElement('div');
          root.style.cssText = 'position:fixed;inset:0;overflow:hidden;touch-action:none';
          document.body.append(root);
          const t0 = performance.now();
          let score = 0;
          const ctx = {
            root,
            seed: 100 + r,
            durationMs: ROUND_MS,
            timeLeftMs: () => Math.max(0, ROUND_MS - (performance.now() - t0)),
            isPaused: () => false,
            hudHeight: 56,
            safeBottom: 0,
            setScore: (s) => {
              score = s;
            },
            finish: () => undefined,
          };
          const inst = await window.__mods[game].game.create(ctx);
          const canvas = root.querySelector('canvas');
          // in-page bot: taps the face / zigzag swipes across the field, on rAF
          const frames = [];
          let last = performance.now();
          let id = 1;
          let k = 0;
          const pe = (type, x, y, pid) =>
            canvas.dispatchEvent(new PointerEvent(type, { pointerId: pid, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true }));
          await new Promise((done) => {
            const f = (now) => {
              frames.push(now - last);
              last = now;
              k++;
              if (game === 'tap') {
                const d = window.__tap && window.__tap();
                if (d && k % 6 === 0) {
                  pe('pointerdown', d.x, d.y, id);
                  pe('pointerup', d.x, d.y, id);
                  id++;
                }
              } else {
                const ph = k % 20;
                const y = 200 + ((k * 7) % 400);
                if (ph === 0) pe('pointerdown', 20, y, id);
                else if (ph < 10) pe('pointermove', 20 + ph * 38, y - ph * 6, id);
                else if (ph === 10) {
                  pe('pointerup', 360, y, id);
                  id++;
                }
              }
              if (performance.now() - t0 < ROUND_MS) requestAnimationFrame(f);
              else done();
            };
            requestAnimationFrame(f);
          });
          inst.destroy();
          inst.destroy(); // idempotent
          const leftover = root.querySelectorAll('canvas').length;
          root.remove();
          frames.sort((a, b) => a - b);
          return { score, p50: frames[Math.floor(frames.length * 0.5)], p95: frames[Math.floor(frames.length * 0.95)], leftover };
        },
        { game, ROUND_MS, r },
      );
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const after = { win: await listenerCount(cdp, 'window'), doc: await listenerCount(cdp, 'document') };
      rounds.push({ ...res, heapMB: +(heap.usedSize / 1e6).toFixed(2), ...after });
    }
    console.log(game);
    console.table(rounds);
    check(`${game}: every round scored (create again after destroy works)`, rounds.every((x) => x.score > 0), rounds.map((x) => x.score));
    check(`${game}: no canvas left after destroy`, rounds.every((x) => x.leftover === 0));
    check(`${game}: no window/document listeners left after destroy`, rounds.every((x) => x.win === base.win && x.doc === base.doc), { base, last: rounds[4] });
    check(`${game}: heap flat over 5 rounds (round 5 <= round 2 + 1.5 MB)`, rounds[4].heapMB <= rounds[1].heapMB + 1.5, rounds.map((x) => x.heapMB));
    check(`${game}: round 5 not slower than round 1 (p95 within 20%)`, rounds[4].p95 <= rounds[0].p95 * 1.2 + 2, rounds.map((x) => x.p95.toFixed(1)));
  }
  // nothing keeps drawing: no rAF callbacks pending from our loops after destroy
  const rafAfter = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const orig = window.requestAnimationFrame;
        window.requestAnimationFrame = (cb) => {
          n++;
          return orig(cb);
        };
        setTimeout(() => {
          window.requestAnimationFrame = orig;
          res(n);
        }, 600);
      }),
  );
  check('no game loop still running after destroy (0 rAF requests in 600 ms)', rafAfter === 0, rafAfter);
  check('no console errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
