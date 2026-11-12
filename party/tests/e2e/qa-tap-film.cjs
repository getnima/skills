// Film a whole tap round: a scripted player taps (real CDP touches) while a screenshot is
// taken every ~400 ms of round time, then a contact sheet is built (python, Pillow).
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-film.cjs <slow|normal|fast|idle|drum> [390x844] [durationMs] [seed]
// Output: tests/e2e/out/qa-tap-film/<player>-<size>/NNN-<roundMs>.png, sheet-*.png, log.json
const L = require('./qa-tap-comedy-lib.cjs');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WHO = process.argv[2] || 'normal';
const SIZE = process.argv[3] || '390x844';
const DUR = Number(process.argv[4] || 53000);
const SEED = Number(process.argv[5] || 7);
const [W, H] = SIZE.split('x').map(Number);
const OUT = path.join(L.outDir('qa-tap-film'), `${WHO}-${SIZE}`);
const EVERY = Number(process.env.FILM_EVERY || 400);

/** Round times of the player's touches (startWindow 30/53 of the round). */
function plan(who) {
  const k = DUR / 53000;
  const sprint = 20000 * k;
  switch (who) {
    case 'slow':
      return L.steady(3, 3000 * k, sprint, 0.5, 3);
    case 'normal':
      return L.steady(6, 1500 * k, sprint, 0.3, 4);
    case 'fast':
      return L.steady(11, 1000 * k, sprint, 0.15, 5);
    case 'late':
      return L.steady(6, 27000 * k, sprint, 0.3, 6);
    case 'idle':
      return [];
    default:
      throw new Error(`unknown player ${who}`);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
  const browser = await L.chromium.launch();
  const { page, cdp, context, errors } = await L.openTap(browser, { viewport: { width: W, height: H }, duration: DUR, seed: SEED });
  const times = plan(WHO);
  let shooting = true;
  const shots = [];
  const film = (async () => {
    let next = 0;
    let i = 0;
    while (shooting) {
      const s = await L.st(page).catch(() => null);
      const ended = await page.evaluate(() => window.__party.ended).catch(() => true);
      if (!s || ended) break;
      if (s.elapsedMs >= next) {
        const file = path.join(OUT, `${String(i).padStart(3, '0')}-${Math.round(s.elapsedMs)}.png`);
        await page.screenshot({ path: file });
        shots.push({ i, ms: Math.round(s.elapsedMs), taps: s.taps, phase: s.phase, beat: s.beat, frame: s.frame, hand: s.hand });
        i++;
        next = s.elapsedMs + EVERY;
      } else await L.sleep(20);
    }
  })();
  const sent = times.length ? await L.tapSchedule(page, cdp, times) : 0;
  await page.waitForFunction(() => window.__party.ended, null, { timeout: DUR + 20000 });
  shooting = false;
  await film;
  const s = await L.st(page).catch(() => null);
  const final = await page.evaluate(() => window.__party.score);
  await context.close();
  await browser.close();
  const log = { who: WHO, size: SIZE, durationMs: DUR, seed: SEED, sent, score: final, errors, shots };
  fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 1));
  console.log(JSON.stringify({ who: WHO, size: SIZE, sent, score: final, shots: shots.length, errors: errors.slice(0, 3), lastState: s && { taps: s.taps, beats: s.beats.map((b) => `${b.id}@${b.taps}/${b.sprintMs}`) } }));
  try {
    execFileSync('python3', ['-I', path.join(__dirname, 'qa-tap-sheet.py'), OUT], { stdio: 'inherit' });
  } catch (e) {
    console.log('sheet failed', e.message);
  }
})();
