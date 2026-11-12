// flappy-play: a look at flappy alone in the dev harness with a simulated field of 8
// (/dev.html?game=flappy&field=8), on 390x844 and 320x568. Two flights per size, flown by
// the game's own pilot: one that lets go after 7 s (crash, place, the "out" view, the
// finale banner and the winner's name) and one that outlasts the field (the finale and the win).
//   PARTY_CLIENT_PORT=5331 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   QA_BASE=http://localhost:5331 node tests/e2e/flappy-play.cjs
// Screenshots: tests/e2e/out/qa-flappy-royale/dev-<width>-*.png (look at them).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.QA_BASE || 'http://localhost:5331';
const OUT = path.join(__dirname, 'out', 'qa-flappy-royale');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const STATE = () => {
  const f = window.__flappy;
  return f ? { mode: f.mode, run: f.run, active: f.active, cd: f.countdown, stage: f.finaleStage, won: f.won, out: f.out, place: f.place, banner: f.banner, ended: window.__party.ended } : null;
};

async function fly(browser, vp, pilotUntil) {
  const tag = `${vp.width}`;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const until = pilotUntil === null ? '' : `&pilotUntil=${pilotUntil}`;
  await page.goto(`${BASE}/dev.html?game=flappy&seed=7&field=8&pilot=1${until}`);
  await page.waitForFunction(() => window.__flappy, null, { timeout: 15000 });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `dev-${tag}-${name}.png`) });
  const seen = {};
  const once = async (name, cond, wait = 0) => {
    if (seen[name] || !cond) return;
    seen[name] = true;
    if (wait) await page.waitForTimeout(wait);
    await shot(name);
  };
  if (pilotUntil !== null) await shot('start');
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 75000) {
    const s = await page.evaluate(STATE);
    if (!s) break;
    last = s;
    if (pilotUntil !== null) {
      await once('mid', s.mode === 'fly' && s.run >= 3);
      await once('crash', s.mode === 'dead', 250);
      await once('out', s.mode === 'out', 700);
      await once('out-finale', s.out && s.out.finale !== '' && s.out.count !== '');
      await once('out-winner', s.out && s.out.winner !== '', 150);
      if (seen['out-winner']) break;
    } else {
      await once('countdown', s.mode === 'fly' && s.cd !== '');
      await once('finale', s.mode === 'fly' && s.stage >= 2);
      await once('won', s.won, 500);
      if (seen.won && (s.mode !== 'fly' || Date.now() - t0 > 60000)) {
        await once('won-out', s.mode === 'out', 500);
        break;
      }
    }
    await page.waitForTimeout(30);
  }
  const kind = pilotUntil === null ? 'win' : 'out';
  if (pilotUntil !== null) {
    check(`${tag} ${kind}: crash, place, the out view, the finale banner and the winner's name were all shown`, ['mid', 'crash', 'out', 'out-finale', 'out-winner'].every((k) => seen[k]), Object.keys(seen));
    check(`${tag} ${kind}: one life (still out, the round is not over on this phone)`, last && last.mode === 'out' && last.ended === false, last && last.mode);
    check(`${tag} ${kind}: "!נפלת" with the place out of 9`, last && last.out && /נפלת/.test(last.out.verdict) && /מקום \d מתוך 9/.test(last.out.place), last && last.out);
  } else {
    check(`${tag} ${kind}: the finale's 3-2-1, the finale and the win were shown`, ['countdown', 'finale', 'won'].every((k) => seen[k]), Object.keys(seen));
  }
  check(`${tag} ${kind}: no errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await fly(browser, vp, 420);
    await fly(browser, vp, null);
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
