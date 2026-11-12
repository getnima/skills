// Frame times of tap + ninja over a whole 60 s round on a slow phone (CDP CPU throttle 4x),
// played by the expert bots through real CDP touches. Also: game clock vs round clock drift.
//   node tests/e2e/qa-tap-perf.cjs [tap|ninja|both] [cpuRate]
const { chromium, check, fails, sleep, openGame, pct } = require('./qa-tap-lib.cjs');
const tapBot = require('./qa-tap-play.cjs');
const ninjaBot = require('./qa-ninja-play.cjs');
const WHICH = process.argv[2] || 'both';
const CPU = Number(process.argv[3] || 4);
const DURATION = Number(process.env.QA_DURATION || 60000);

// every rAF delta, with the round time it happened at
const RECORD = `(() => {
  const orig = window.requestAnimationFrame.bind(window);
  window.__ft = []; let last = 0;
  const tick = (now) => { if (last) window.__ft.push([now - last, window.__party ? window.__party.leftMs : 0]); last = now; orig(tick); };
  orig(tick);
})();`;

async function run(game) {
  const browser = await chromium.launch();
  const { page, cdp, context, errors } = await openGame(browser, game, { device: 'iPhone 14', cpu: CPU, init: RECORD, query: `seed=11&duration=${DURATION}` });
  if (game === 'tap') {
    await page.waitForFunction(() => window.__tap && window.__tap());
    await tapBot.play('expert', page, cdp, tapBot.STRATS.expert, 77);
  } else {
    await page.waitForFunction(() => !!window.__ninja);
    await ninjaBot.play('expert', page, cdp, ninjaBot.STRATS.expert, 77);
  }
  // drift: game clock vs round clock, read just before the end
  const drift = await page.evaluate((g) => {
    const elapsed = g === 'tap' ? (window.__tap && window.__tap() ? window.__tap().elapsedMs : null) : window.__ninja.elapsedMs;
    return { elapsed, round: window.__party.leftMs };
  }, game);
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 20000 });
  const ft = await page.evaluate(() => window.__ft);
  const score = await page.evaluate(() => window.__party.score);
  await context.close();
  await browser.close();
  const all = ft.filter(([, left]) => left > 0 && left < DURATION).map(([d]) => d);
  const busy = ft.filter(([, left]) => left > 0 && left < 15000).map(([d]) => d);
  const roundElapsed = DURATION - drift.round;
  const res = { game, cpu: CPU, score, frames: all.length, p50: pct(all, 50).toFixed(1), p95: pct(all, 95).toFixed(1), p99: pct(all, 99).toFixed(1), busyP95: pct(busy, 95).toFixed(1), max: Math.max(...all).toFixed(0), driftMs: drift.elapsed === null ? null : Math.round(roundElapsed - drift.elapsed) };
  console.log(JSON.stringify(res));
  check(`${game} cpu ${CPU}x: p95 frame < 34 ms over the round`, pct(all, 95) < 34, res.p95);
  check(`${game} cpu ${CPU}x: p95 frame < 34 ms in the busiest last 15 s`, pct(busy, 95) < 34, res.busyP95);
  if (res.driftMs !== null) check(`${game} cpu ${CPU}x: game clock within 250 ms of the round clock at the end`, Math.abs(res.driftMs) < 250, res.driftMs);
  check(`${game}: no console errors`, errors.length === 0, errors.slice(0, 3));
  return res;
}

(async () => {
  if (WHICH !== 'ninja') await run('tap');
  if (WHICH !== 'tap') await run('ninja');
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
