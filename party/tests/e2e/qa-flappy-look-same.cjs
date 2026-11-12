// qa-flappy-look-same: the guest's dressed head is looks only. Records what a flight IS (every
// fixed step [step, mode, y, vy, dist, passed], the course, the final raw score) in the dev
// harness with the game's own pilot, so a run before a change and a run after it (with or
// without ?look=) can be compared byte for byte.
//   PARTY_CLIENT_PORT=5381 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   QA_BASE=http://localhost:5381 node tests/e2e/qa-flappy-look-same.cjs record <label> [look]
//   node tests/e2e/qa-flappy-look-same.cjs compare <labelA> <labelB>
// The flights run one at a time (QA_PARALLEL=1: all at once). The dev harness's clock runs while the
// page loads, so a page that boots late (a busy machine) is put back on the live course (a rejoin) and
// its flight differs: such a run is flagged "harness rejoin" and should be recorded again.
// Files: tests/e2e/out/qa-flappy-look/same-<label>.json
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { phoneContext } = require('./qa-icy-lib.cjs');

const BASE = process.env.QA_BASE || 'http://localhost:5381';
const OUT = path.join(__dirname, 'out', 'qa-flappy-look');
fs.mkdirSync(OUT, { recursive: true });

/** Flights: a seed, a phone size and the harness query (the pilot lets go, or flies into the finale). */
const RUNS = [
  { seed: 7, size: '390x844', q: '&field=8&pilot=1&pilotUntil=700' },
  { seed: 7, size: '320x568', q: '&field=8&pilot=1&pilotUntil=700' },
  { seed: 21, size: '430x932', q: '&finaleAt=6000&pilot=1' },
  { seed: 21, size: '320x568', q: '&finaleAt=6000&pilot=1' },
  { seed: 3, size: '390x844', q: '&field=3&pilot=1&pilotUntil=260' },
];

async function flight(browser, run, look) {
  const context = await phoneContext(browser, run.size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const lq = look ? `&look=${encodeURIComponent(look)}` : '';
  await page.goto(`${BASE}/dev.html?game=flappy&seed=${run.seed}${run.q}&trace=6000${lq}`);
  await page.waitForFunction(() => !!window.__flappy, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__flappy.mode !== 'fly', null, { timeout: 90000, polling: 100 });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({
    traced: window.__flappy.traced.map((t) => [...t]),
    course: window.__flappy.course(120),
    raw: window.__flappy.raw,
    run: window.__flappy.run,
    score: window.__party.score,
  }));
  await context.close();
  return { ...run, look: look || null, ...r, errors };
}

async function record(label, look) {
  const browser = await chromium.launch();
  try {
    const results = [];
    if (process.env.QA_PARALLEL === '1') results.push(...(await Promise.all(RUNS.map((run) => flight(browser, run, look)))));
    else for (const run of RUNS) results.push(await flight(browser, run, look));
    const file = path.join(OUT, `same-${label}.json`);
    fs.writeFileSync(file, JSON.stringify(results));
    for (const r of results) console.log(`${r.seed} ${r.size} ${r.q}: steps ${r.traced.length}, passed ${r.run}, raw ${r.raw}, stage score ${r.score}, errors ${r.errors.length}${rejoined(r) ? ', HARNESS REJOIN (record again on a quieter machine)' : ''}`);
    console.log('wrote', file);
    const bad = results.filter((r) => r.errors.length > 0);
    if (bad.length) {
      console.log('FAIL page errors', bad.map((r) => r.errors));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

/** The page booted late or stalled: the flight was put back on the live course (first step not 1, or a jump). */
function rejoined(r) {
  const t = r.traced;
  if (t.length === 0 || t[0][0] !== 1) return true;
  for (let k = 1; k < t.length; k++) if (t[k][0] !== t[k - 1][0] + 1) return true;
  return false;
}

function compare(a, b) {
  const A = JSON.parse(fs.readFileSync(path.join(OUT, `same-${a}.json`), 'utf8'));
  const B = JSON.parse(fs.readFileSync(path.join(OUT, `same-${b}.json`), 'utf8'));
  let fails = 0;
  for (let i = 0; i < A.length; i++) {
    const x = A[i];
    const y = B[i];
    const tag = `${x.seed} ${x.size} ${x.q}`;
    const sameTrace = JSON.stringify(x.traced) === JSON.stringify(y.traced);
    const sameCourse = JSON.stringify(x.course) === JSON.stringify(y.course);
    const sameScore = x.raw === y.raw && x.run === y.run && x.score === y.score;
    const ok = sameTrace && sameCourse && sameScore;
    if (!ok) fails++;
    const why = !ok && (rejoined(x) || rejoined(y)) ? ' (harness rejoin: record again)' : '';
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${tag}${why}: trace ${sameTrace ? 'same' : 'DIFFERENT'} (${x.traced.length}/${y.traced.length} steps), course ${sameCourse ? 'same' : 'DIFFERENT'}, raw ${x.raw}/${y.raw}, passed ${x.run}/${y.run}`);
  }
  console.log(fails === 0 ? `ok   ${a} and ${b}: identical flights, courses and scores` : `FAIL ${fails} flight(s) differ`);
  process.exitCode = fails === 0 ? 0 : 1;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'record') record(args[0] || 'run', args[1]).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'compare') compare(args[0], args[1]);
else console.log('usage: record <label> [look] | compare <a> <b>');
