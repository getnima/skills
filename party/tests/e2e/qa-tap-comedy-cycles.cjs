// Five create / destroy cycles of the tap game on its own (destroy() called twice each time):
// no canvas, style or loop left behind, window.__tap() null after each destroy.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-comedy-cycles.cjs
const L = require('./qa-tap-comedy-lib.cjs');

(async () => {
  const browser = await L.chromium.launch();
  const { page, context, errors } = await L.openTap(browser, { duration: 50000 });
  const res = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/src/games/tap/index.ts')).pop();
    const mod = await import(url);
    const out = [];
    const canvasesBefore = document.querySelectorAll('canvas').length;
    for (let i = 0; i < 5; i++) {
      const root = document.createElement('div');
      root.style.cssText = 'position:fixed;inset:0;';
      document.body.appendChild(root);
      let clock = null;
      const ctx = {
        root,
        seed: i + 1,
        durationMs: 10000,
        timeLeftMs: () => 10000,
        isPaused: () => false,
        hudHeight: 66,
        safeBottom: 0,
        setScore: () => undefined,
        finish: () => undefined,
        setClock: (l) => {
          clock = l;
        },
      };
      const inst = await mod.game.create(ctx);
      await new Promise((r) => setTimeout(r, 300));
      const alive = !!window.__tap();
      inst.destroy();
      inst.destroy();
      await new Promise((r) => setTimeout(r, 100));
      out.push({ alive, after: window.__tap(), children: root.childElementCount, clock });
      root.remove();
    }
    return { out, canvasesBefore, canvasesAfter: document.querySelectorAll('canvas').length };
  });
  await context.close();
  await browser.close();
  console.log(JSON.stringify(res));
  L.check('each cycle ran (the game was alive)', res.out.every((o) => o.alive));
  L.check('destroy (twice) leaves nothing: __tap() null, root empty, HUD clock restored', res.out.every((o) => o.after === null && o.children === 0 && o.clock === null));
  L.check('no canvases leaked', res.canvasesAfter === res.canvasesBefore, [res.canvasesBefore, res.canvasesAfter]);
  L.check('no console errors', errors.length === 0, errors.slice(0, 3));
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
