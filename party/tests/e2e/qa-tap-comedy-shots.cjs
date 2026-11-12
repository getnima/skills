// Burst screenshots of the tap game, frozen at each beat of the ladder, the hand stages, the
// mess and the final frame, at one phone size. Frozen = the dev harness freeze (the veil and
// the harness banner are hidden for the picture), so every shot is an exact game state.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-comedy-shots.cjs 390x844 [fast|slow|idle|all]
const L = require('./qa-tap-comedy-lib.cjs');
const path = require('path');

const SIZE = process.argv[2] || '390x844';
const WHICH = process.argv[3] || 'all';
const [W, H] = SIZE.split('x').map(Number);
const OUT = L.outDir('qa-tap-comedy');
const HIDE = '.pa-veil,.dv-freeze{display:none!important}';

async function shot(page, name) {
  await page.evaluate(() => window.__party.freeze(1500));
  await L.sleep(90);
  await page.addStyleTag({ content: HIDE });
  const file = path.join(OUT, `${SIZE}-${name}.png`);
  await page.screenshot({ path: file });
  const s = await L.st(page);
  console.log(`shot ${name}: taps ${s.taps} level ${s.level} hand ${s.hand} frame ${s.frame} beat ${s.beat}@${s.beatT.toFixed(2)} live ${s.sprites.live} pile ${s.sprites.pile}`);
  // unfreeze: the harness only extends; wait it out
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 5000 });
}

/** Shots taken when a predicate on __tap() becomes true (each once). */
async function watch(page, plan, stopWhen) {
  const done = new Set();
  while (true) {
    const s = await L.st(page).catch(() => null);
    if (!s) break;
    for (const p of plan) {
      if (done.has(p.name)) continue;
      if (p.when(s)) {
        done.add(p.name);
        await shot(page, p.name);
      }
    }
    if (stopWhen(s) || done.size === plan.length) break;
    await L.sleep(12);
  }
  return done;
}

const beatAt = (id, t) => (s) => s.beat === id && s.beatT >= t;

async function runFast(browser) {
  const { page, cdp, context, errors } = await L.openTap(browser, { viewport: { width: W, height: H }, seed: 3 });
  const plan = [
    { name: '01-waiting', when: (s) => s.elapsedMs > 1100 },
    { name: '02-first-tap-click', when: beatAt('first', 0.12) },
    { name: '03-first-tap-shrug', when: beatAt('first', 0.75) },
    { name: '10-yossi', when: beatAt('yossi', 0.3) },
    { name: '11-rope-stretch', when: beatAt('rope', 0.6) },
    { name: '12-rope-snap', when: beatAt('rope', 0.85) },
    { name: '13-ear', when: beatAt('ear', 0.55) },
    { name: '14-mini-slide', when: beatAt('mini', 0.5) },
    { name: '15-mini-nod', when: beatAt('mini', 1.2) },
    { name: '16-sneeze-windup', when: beatAt('sneeze', 0.35) },
    { name: '17-sneeze-burst', when: beatAt('sneeze', 0.62) },
    { name: '18-squeegee', when: beatAt('squeegee', 0.45) },
    { name: '19-king-pull', when: beatAt('king', 0.85) },
    { name: '20-king-pop', when: beatAt('king', 1.25) },
    { name: '21-spin', when: beatAt('spin', 0.55) },
    { name: '22-spin-dizzy', when: beatAt('spin', 1.05) },
    { name: '23-cork-windup', when: beatAt('cork', 0.42) },
    { name: '24-cork-pop', when: beatAt('cork', 0.6) },
    { name: '25-cork-back', when: beatAt('cork', 1.2) },
    { name: '30-hand-absurd', when: (s) => s.level === 5 && !s.beat && !s.lastQuarter && s.taps > 100 },
    { name: '31-mess-sprint-10s', when: (s) => s.phase === 'sprint' && s.elapsedMs - s.t0 > 10000 && !s.beat },
    { name: '32-last5', when: (s) => s.lastQuarter && s.elapsedMs - s.t0 > 15800 && !s.beat },
    { name: '34-last1', when: (s) => s.lastQuarter && s.elapsedMs - s.t0 > 19200 },
        { name: '40-final', when: (s) => s.phase === 'done' && s.beatT > 0.9 },
    { name: '41-final-alive', when: (s) => s.phase === 'done' && s.beatT > 6.1 },
  ];
  const times = L.steady(13, 1500, 20500, 0.1, 9);
  const tapping = L.tapSchedule(page, cdp, times);
  await watch(page, plan, (s) => s.phase === 'done' && s.beatT > 6.5);
  await tapping;
  const s = await L.st(page);
  console.log(JSON.stringify({ run: 'fast', taps: s.taps, beats: s.beats.map((b) => `${b.id}@${b.taps}/${b.sprintMs}`) }));
  console.log('errors', errors);
  await context.close();
}

async function runSlow(browser) {
  const { page, cdp, context, errors } = await L.openTap(browser, { viewport: { width: W, height: H }, seed: 5 });
  const plan = [
    { name: '50-slow-rising', when: (s) => s.phase === 'sprint' && s.hand === 'rising' && !s.beat },
    { name: '51-slow-nostril', when: (s) => s.phase === 'sprint' && s.hand === 'nostril' && !s.beat },
    { name: '52-slow-knuckle', when: (s) => s.phase === 'sprint' && s.hand === 'knuckle' && !s.beat },
    { name: '53-slow-innocent', when: (s) => s.phase === 'sprint' && s.frame === 'face_whistle' && !s.beat },
    { name: '54-slow-filler', when: (s) => s.beat && s.beat.startsWith('filler') && s.beatT > 0.3 },
    { name: '55-slow-deep', when: (s) => s.phase === 'sprint' && s.hand === 'deep' && !s.beat },
    { name: '56-slow-last5', when: (s) => s.lastQuarter && s.elapsedMs - s.t0 > 16200 },
    { name: '57-slow-final', when: (s) => s.phase === 'done' && s.beatT > 0.9 },
  ];
  // a slow, irregular tapper (about 3/s) with a pause, then a short faster burst
  const times = [...L.steady(3, 2000, 7000, 0.6, 4), ...L.steady(1.2, 9200, 2600, 0.3, 5), ...L.steady(5.5, 12000, 3000, 0.3, 6), ...L.steady(3, 15200, 7000, 0.5, 7)];
  const tapping = L.tapSchedule(page, cdp, times);
  await watch(page, plan, (s) => s.phase === 'done' && s.beatT > 1.2);
  await tapping;
  const s = await L.st(page);
  console.log(JSON.stringify({ run: 'slow', taps: s.taps, beats: s.beats.map((b) => `${b.id}@${b.taps}/${b.sprintMs}`) }));
  console.log('errors', errors);
  await context.close();
}

async function runIdle(browser) {
  const { page, context, errors } = await L.openTap(browser, { viewport: { width: W, height: H }, seed: 2 });
  const plan = [
    { name: '60-wait-start', when: (s) => s.elapsedMs > 1500 },
    { name: '61-wait-bit-a', when: (s) => s.beat && s.beat.startsWith('wait-') && s.beatT > 0.6 },
    { name: '62-wait-sneak-caught', when: beatAt('wait-sneak', 2.1) },
    { name: '63-wait-sneak-whistle', when: beatAt('wait-sneak', 3.0) },
    { name: '64-wait-yawn', when: beatAt('wait-yawn', 0.65) },
    { name: '65-wait-knock', when: beatAt('wait-knock', 0.42) },
    { name: '65b-wait-knock-press', when: beatAt('wait-knock', 1.5) },
    { name: '65c-wait-sleep', when: beatAt('wait-sleep', 1.2) },
    { name: '65d-wait-awake', when: beatAt('wait-sleep', 2.2) },
    { name: '65e-wait-peek', when: beatAt('wait-peek', 0.8) },
    { name: '66-countdown-5', when: (s) => s.elapsedMs > 25150 },
    { name: '67-countdown-2', when: (s) => s.elapsedMs > 28300 },
    { name: '68-autostart', when: beatAt('autostart', 0.2) },
    { name: '69-zero-sprint', when: (s) => s.phase === 'sprint' && s.elapsedMs > 36000 },
    { name: '70-zero-final', when: (s) => s.phase === 'done' && s.beatT > 0.9 },
  ];
  await watch(page, plan, (s) => s.phase === 'done' && s.beatT > 1.2);
  const s = await L.st(page);
  if (s) console.log(JSON.stringify({ run: 'idle', taps: s.taps, finished: s.finished, beats: s.beats.map((b) => `${b.id}@${b.roundMs}`) }));
  else console.log('idle: the round ended (auto-start at the window end + 20 s = the cap)');
  console.log('errors', errors);
  await context.close();
}

(async () => {
  const browser = await L.chromium.launch();
  if (WHICH === 'all' || WHICH === 'fast') await runFast(browser);
  if (WHICH === 'all' || WHICH === 'slow') await runSlow(browser);
  if (WHICH === 'all' || WHICH === 'idle') await runIdle(browser);
  await browser.close();
})();
