// Freeze checks of the tap game: frozen mid-rise, mid-dig, mid set-piece and with the glass
// full, nothing moves (same state, same pixels) and touches count for nothing; after the
// freeze the game continues exactly where it stopped.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-comedy-freeze.cjs
const L = require('./qa-tap-comedy-lib.cjs');
const path = require('path');
const fs = require('fs');

const OUT = L.outDir('qa-tap-comedy');
const HIDE = '.pa-veil,.dv-freeze{display:none!important}';

const CASES = [
  { name: 'mid-rise', hz: 1.6, when: (s) => s.phase === 'sprint' && s.hand === 'rising' && !s.beat && s.taps >= 2 },
  { name: 'mid-dig', hz: 8, when: (s) => s.phase === 'sprint' && s.level >= 4 && !s.beat },
  { name: 'mid-set-piece', hz: 9, when: (s) => s.beat === 'rope' && s.beatT > 0.45 },
  { name: 'glass-full', hz: 12, when: (s) => s.phase === 'sprint' && s.sprites.live >= 5 && s.taps > 90 },
];

function pick(s) {
  return {
    elapsedMs: s.elapsedMs,
    taps: s.taps,
    touches: s.touches,
    level: s.level,
    hand: s.hand,
    frame: s.frame,
    beat: s.beat,
    beatT: +s.beatT.toFixed(4),
    rate: +s.rate.toFixed(4),
    live: s.sprites.live,
    pile: s.sprites.pile,
    fx: s.sprites.fx,
  };
}

async function run(browser, c) {
  const { page, cdp, context, errors } = await L.openTap(browser, { viewport: { width: 390, height: 844 }, seed: 4 });
  const s0 = await L.st(page);
  const clip = { x: 0, y: s0.layout.top, width: 390, height: 844 - s0.layout.top };
  const times = L.steady(c.hz, 1200, 21000, 0.1, 21);
  let stop = false;
  const tapping = (async () => {
    const left = await page.evaluate(() => window.__party.leftMs);
    const zero = Date.now() - (53000 - left);
    for (let i = 0; i < times.length && !stop; i++) {
      const w = zero + times[i] - Date.now();
      if (w > 0) await L.sleep(w);
      if (stop) break;
      void L.tapAt(cdp, [{ x: s0.x + (i % 2 ? 40 : -40), y: s0.y + 50 }]);
    }
  })();
  const hit = await page
    .waitForFunction(`(() => { const s = window.__tap(); return !!s && (${c.when.toString()})(s); })()`, null, { timeout: 40000, polling: 16 })
    .then(() => true)
    .catch(() => false);
  L.check(`${c.name}: reached the state to freeze in`, hit);
  stop = true;
  await page.evaluate(() => window.__party.freeze(2500));
  await L.sleep(150);
  await page.addStyleTag({ content: HIDE });
  const a = pick(await L.st(page));
  const imgA = await page.screenshot({ clip });
  // touches during the freeze
  for (let i = 0; i < 10; i++) {
    await L.tapAt(cdp, [{ x: 195 + (i % 3) * 30, y: 500 }]);
    await L.sleep(40);
  }
  await L.sleep(700);
  const b = pick(await L.st(page));
  const imgB = await page.screenshot({ clip });
  fs.writeFileSync(path.join(OUT, `390x844-freeze-${c.name}.png`), imgA);
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 6000 });
  const cS = pick(await L.st(page));
  await tapping;
  await context.close();
  const same = JSON.stringify(a) === JSON.stringify(b);
  const pixels = Buffer.compare(imgA, imgB) === 0;
  const resumedDt = cS.elapsedMs - a.elapsedMs;
  L.check(`${c.name}: state does not move while frozen`, same, same ? a : { a, b });
  L.check(`${c.name}: pixels do not move while frozen`, pixels);
  L.check(`${c.name}: touches during the freeze count for nothing`, b.taps === a.taps && b.touches === a.touches, [a.touches, b.touches]);
  L.check(`${c.name}: resumes where it stopped (game time continues from the frozen value)`, resumedDt >= 0 && resumedDt < 250, resumedDt);
  if (a.beat && cS.beat === a.beat) L.check(`${c.name}: the set piece continues from the same beat time`, Math.abs(cS.beatT - a.beatT - resumedDt / 1000) < 0.02, [a.beatT, cS.beatT]);
  L.check(`${c.name}: no console errors`, errors.length === 0, errors.slice(0, 2));
  console.log(c.name, JSON.stringify(a));
}

(async () => {
  const browser = await L.chromium.launch();
  for (const c of CASES) await run(browser, c);
  await browser.close();
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
