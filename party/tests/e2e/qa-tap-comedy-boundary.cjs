// The automatic cutscene freeze of the tap round lands at 30 s of round time (shared/cutscenes.ts
// tap_freeze, scaled to 60% of the round on the server): exactly the end of the start window.
// Two phones in the same round, frozen by the harness at 30 s for 4 s:
//   - "idle" never touched: it must be auto-started once (t0 = 30 000), not twice, not skipped;
//   - "sprinter" started at 25 s: mid-sprint, it must keep exactly the same time left.
// While frozen nothing advances and touches are dropped.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-comedy-boundary.cjs [durationMs]
const L = require('./qa-tap-comedy-lib.cjs');

const DURATION = Number(process.argv[2] || 50000);
const AT = Math.round(DURATION * 0.6);

function pick(s) {
  return { phase: s.phase, elapsedMs: Math.round(s.elapsedMs), t0: s.t0, endAt: s.endAt, taps: s.taps, touches: s.touches, beat: s.beat, beatT: +s.beatT.toFixed(4), autostarts: s.beats.filter((b) => b.id === 'autostart').length };
}

async function phone(browser, name, tapFrom) {
  const o = await L.openTap(browser, { seed: 5, duration: DURATION, query: `freezeAt=${AT}&freezeMs=4000` });
  const s0 = await L.st(o.page);
  const left = await o.page.evaluate(() => window.__party.leftMs);
  const zero = Date.now() - (DURATION - left);
  const res = { name, ...o, before: null, during: null, after: null, last: null };
  // tap at ~6/s from tapFrom, round-time scheduled (pauses with the freeze)
  const tapping = (async () => {
    if (tapFrom < 0) return;
    for (let t = tapFrom; ; t += 165) {
      const st = await L.st(o.page).catch(() => null);
      if (!st || st.phase === 'done') return;
      if (st.elapsedMs < t) {
        await L.sleep(Math.min(40, t - st.elapsedMs));
        t -= 165;
        continue;
      }
      void L.tapAt(o.cdp, [{ x: s0.x + 30, y: s0.y + 40 }]);
    }
  })();
  void zero;
  await o.page.waitForFunction(() => window.__party.frozen, null, { timeout: 60000, polling: 10 });
  await L.sleep(300);
  res.before = pick(await L.st(o.page));
  for (let i = 0; i < 8; i++) {
    await L.tapAt(o.cdp, [{ x: 195, y: 500 + i }]);
    await L.sleep(60);
  }
  await L.sleep(1500);
  res.during = pick(await L.st(o.page));
  await o.page.waitForFunction(() => !window.__party.frozen, null, { timeout: 10000, polling: 10 });
  res.after = pick(await L.st(o.page));
  // follow to the end of the sprint / round
  while (true) {
    const st = await L.st(o.page).catch(() => null);
    if (!st) break;
    res.last = pick(st);
    if (st.phase === 'done') break;
    await L.sleep(100);
  }
  await tapping;
  await o.context.close();
  return res;
}

(async () => {
  const browser = await L.chromium.launch();
  const [idle, sprinter] = await Promise.all([phone(browser, 'idle', -1), phone(browser, 'sprinter', Math.round(DURATION * 0.5))]);
  await browser.close();
  for (const r of [idle, sprinter]) console.log(r.name, JSON.stringify({ before: r.before, during: r.during, after: r.after, last: r.last }));
  for (const r of [idle, sprinter]) {
    const b = r.before;
    const d = r.during;
    L.check(`${r.name}: nothing advances while frozen`, b.elapsedMs === d.elapsedMs && b.taps === d.taps && b.phase === d.phase && b.beatT === d.beatT, [b, d]);
    L.check(`${r.name}: touches during the freeze are dropped`, b.touches === d.touches && b.taps === d.taps);
    L.check(`${r.name}: continues where it was after the freeze`, r.after.elapsedMs - d.elapsedMs >= 0 && r.after.elapsedMs - d.elapsedMs < 250, r.after.elapsedMs - d.elapsedMs);
    L.check(`${r.name}: no console errors`, r.errors.length === 0, r.errors.slice(0, 2));
  }
  L.check('idle: auto-started exactly once, at the window end', idle.last && idle.last.autostarts === 1 && idle.last.t0 === AT, idle.last);
  L.check('sprinter: same sprint end before and after the freeze, sprint = 40% of the round', sprinter.before.endAt === sprinter.last.endAt && sprinter.last.endAt - sprinter.last.t0 === DURATION - Math.round(DURATION * 0.6), [sprinter.before.endAt, sprinter.last.endAt, sprinter.last.t0]);
  L.check('sprinter: was mid-sprint at the freeze', sprinter.before.phase === 'sprint');
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
