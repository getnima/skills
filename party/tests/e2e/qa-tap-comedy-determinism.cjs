// Determinism of the tap game in real browsers: the same seed on 320x568, 430x932 and
// 390x844 at 20 fps. CDP cannot deliver touches at exactly the same round time on every run,
// so each run is checked against an ORACLE: the round times the game stamped its touches with
// (window.__tap().touchTimes) are replayed through the pure engine (pick.ts, imported in the
// page) at 60 Hz, and the game's score and the tap counts of its set pieces must equal the
// replay's. Across the runs the level (seeded gags) and the order of the beats and lines must match.
// (The engine itself is checked step-exact under any batching in tests/unit/tap-pick.test.ts.)
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-comedy-determinism.cjs [durationMs]
const L = require('./qa-tap-comedy-lib.cjs');

const DUR = Number(process.argv[2] || 53000);
const K = DUR / 53000;
const RUNS = [
  { name: '320x568', viewport: { width: 320, height: 568 } },
  { name: '430x932', viewport: { width: 430, height: 932 } },
  { name: '390x844@20fps', viewport: { width: 390, height: 844 }, fps: 20 },
];
// a regular player (7 taps/s) with a pause in the middle
const TIMES = [...L.steady(7, 1500 * K, 9000 * K, 0, 1), ...L.steady(2, 10600 * K, 2500 * K, 0, 2), ...L.steady(7, 13200 * K, 6600 * K, 0, 3)];

async function run(browser, r) {
  const { page, cdp, context, errors } = await L.openTap(browser, { viewport: r.viewport, fps: r.fps, seed: 99, duration: DUR });
  const s0 = await L.st(page);
  const left = await page.evaluate(() => window.__party.leftMs);
  const zero = Date.now() - (DUR - left);
  const pend = [];
  for (let i = 0; i < TIMES.length; i++) {
    const w = zero + TIMES[i] - Date.now();
    if (w > 0) await L.sleep(w);
    pend.push(L.tapAt(cdp, [{ x: s0.x + (i % 2 ? 30 : -30), y: s0.y + 40 }]));
  }
  await Promise.allSettled(pend);
  await page.waitForFunction(() => window.__tap() && window.__tap().phase === 'done', null, { timeout: 60000 });
  const s = await L.st(page);
  // the oracle: replay the stamped touches through the pure engine at 60 Hz
  const oracle = await page.evaluate(
    async ({ dur, times }) => {
      const { createTapEngine } = await import('/src/games/tap/pick.ts');
      const ms = [];
      const e = createTapEngine(dur, { milestone: (id, _i, taps) => ms.push(`${id}@${taps}`) });
      const sorted = [...times].sort((a, b) => a - b);
      let qi = 0;
      for (let i = 1; i * (1000 / 60) <= dur + 50 && e.state.phase !== 'done'; i++) {
        const now = i * (1000 / 60);
        while (qi < sorted.length && sorted[qi] <= now) e.tap(sorted[qi++]);
        e.step(now);
      }
      return { taps: e.state.taps, milestones: ms };
    },
    { dur: DUR, times: s.touchTimes },
  );
  await context.close();
  return {
    name: r.name,
    fingerprint: s.fingerprint,
    score: s.taps,
    touches: s.touches,
    bounces: s.bounces,
    oracle,
    // every milestone is a line (an event) at its tap count
    milestones: s.events.filter((e) => e.id.startsWith('milestone-')).map((e) => `${e.id.slice(10)}@${e.taps}`),
    order: [...s.beats.filter((b) => !b.id.startsWith('wait-')).map((b) => b.id), ...s.events.filter((e) => e.id.startsWith('milestone-') || e.id === 'last').map((e) => e.id)],
    errors,
  };
}

(async () => {
  const browser = await L.chromium.launch();
  const res = [];
  for (const r of RUNS) res.push(await run(browser, r));
  await browser.close();
  for (const r of res) console.log(JSON.stringify({ name: r.name, score: r.score, oracle: r.oracle.taps, touches: r.touches, bounces: r.bounces, milestones: r.milestones }));
  for (const r of res) {
    L.check(`${r.name}: score = replay of its own touches through pick.ts`, r.score === r.oracle.taps, [r.score, r.oracle.taps]);
    L.check(`${r.name}: every milestone fired at the replay's tap count`, JSON.stringify(r.milestones) === JSON.stringify(r.oracle.milestones), [r.milestones, r.oracle.milestones]);
    L.check(`${r.name}: no console errors`, r.errors.length === 0, r.errors.slice(0, 2));
  }
  const a = res[0];
  for (const r of res.slice(1)) {
    L.check(`${r.name} vs ${a.name}: same level (seeded gags)`, r.fingerprint === a.fingerprint);
    L.check(`${r.name} vs ${a.name}: same order of beats and lines`, JSON.stringify(r.order) === JSON.stringify(a.order), [a.order, r.order]);
  }
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
