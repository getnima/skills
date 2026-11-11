// ninja game check. Needs vite on :5215 (PARTY_CLIENT_PORT=5215 npx vite).
// node tests/e2e/ninja-play.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.NINJA_BASE || 'http://localhost:5215';
const OUT = path.join(__dirname, 'out', 'ninja');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const party = (page) => page.evaluate(() => ({ score: window.__party.score, ended: window.__party.ended, frozen: window.__party.frozen, leftMs: window.__party.leftMs }));
const ninja = (page) =>
  page.evaluate(() => {
    const n = window.__ninja;
    if (!n) return null;
    return { signature: n.signature, steps: n.steps, launched: n.launched, sliced: n.sliced, golds: n.golds, bombsHit: n.bombsHit, comboBonus: n.comboBonus, score: n.score, stunned: n.stunned, active: n.active, snapshot: n.snapshot() };
  });
const targets = (page) => page.evaluate(() => (window.__ninja ? window.__ninja.targets() : []));
const layout = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, 200);
    const de = document.documentElement;
    return { scrollY: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight };
  });

function segDist(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + dx * t - cx, ay + dy * t - cy);
}

async function swipe(page, x0, y0, x1, y1, steps = 6) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await sleep(10);
  }
  await page.mouse.up();
}

/** One bot move: slice fruit (a line through several when they line up), avoid bombs unless told to hit one. */
async function botMove(page, vp, opts = {}) {
  const ts = await targets(page);
  const lead = 0.06;
  const pts = ts.map((t) => ({ ...t, px: t.x + t.vx * lead, py: t.y + (t.vy + 600) * lead }));
  const bombs = pts.filter((t) => t.kind === 'bomb');
  const top = 130;
  if (opts.hitBomb && bombs.length > 0) {
    const b = bombs.find((q) => q.py > top && q.py < vp.height - 60 && Math.abs(q.vy) < 320);
    if (b) {
      await swipe(page, b.px - b.r * 1.6, b.py, b.px + b.r * 1.6, b.py);
      return 'bomb';
    }
  }
  const fruit = pts.filter((t) => t.kind !== 'bomb' && t.py > top && t.py < vp.height - 40).sort((a, b) => (a.kind === 'gold' ? -1 : 0) - (b.kind === 'gold' ? -1 : 0));
  if (fruit.length === 0) return 'none';
  const safe = (ax, ay, bx, by) => bombs.every((b) => segDist(ax, ay, bx, by, b.px, b.py) > b.r * 2.2);
  // try a combo line first
  const first = fruit[0];
  const row = fruit.filter((f) => Math.abs(f.py - first.py) < first.r * 1.2).sort((a, b) => a.px - b.px);
  if (row.length >= 2) {
    const l = row[0], r = row[row.length - 1];
    const ax = l.px - l.r * 1.4, ay = l.py, bx = r.px + r.r * 1.4, by = r.py;
    if (safe(ax, ay, bx, by)) {
      await swipe(page, ax, ay, bx, by, 8);
      return 'row' + row.length;
    }
  }
  for (const f of fruit) {
    const options = [
      [f.px - f.r * 1.5, f.py, f.px + f.r * 1.5, f.py],
      [f.px, f.py - f.r * 1.5, f.px, f.py + f.r * 1.5],
      [f.px - f.r * 1.2, f.py - f.r * 1.2, f.px + f.r * 1.2, f.py + f.r * 1.2],
    ];
    for (const [ax, ay, bx, by] of options) {
      if (safe(ax, ay, bx, by)) {
        await swipe(page, ax, ay, bx, by);
        return f.kind;
      }
    }
  }
  return 'blocked';
}

async function play(name, device, { seed = 7, duration = 30000, shots = true } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  const vp = page.viewportSize();
  const shot = (f) => (shots ? page.screenshot({ path: path.join(OUT, `${name}-${f}.png`) }) : null);
  await page.goto(`${BASE}/dev.html?game=ninja&seed=${seed}&duration=${duration}`);
  await page.waitForSelector('.pa-stage-game canvas');
  await page.waitForFunction(() => !!window.__ninja);
  await sleep(1300);
  await shot('1-hint');
  const l = await layout(page);
  check(`${name}: no scroll / overflow`, l.scrollY === 0 && l.sw <= l.iw && l.sh <= l.ih, l);

  let froze = false, bombDone = false, bombAir = false, midShot = false, comboShot = false, goldShot = false;
  let lastScore = 0;
  const moves = {};
  while (true) {
    const p = await party(page);
    if (p.ended) break;
    const played = duration - p.leftMs;
    if (!froze && played > 9000 && (await ninja(page)).active >= 2) {
      froze = true;
      // freeze in the middle of the action
      const before = await ninja(page);
      await page.evaluate(() => window.__party.freeze(2500));
      await sleep(80);
      const a = await ninja(page);
      await swipe(page, 40, vp.height * 0.5, vp.width - 40, vp.height * 0.4); // dropped while frozen
      await sleep(1100);
      const b = await ninja(page);
      await shot('4-frozen');
      check(`${name}: frozen: no steps, same positions, same score`, a.steps === b.steps && a.snapshot === b.snapshot && a.score === b.score, { a: a.steps, b: b.steps, sa: a.snapshot.slice(0, 60), sb: b.snapshot.slice(0, 60) });
      check(`${name}: frozen in the middle of action`, a.active > 0 || before.active > 0, { active: a.active });
      await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 5000 });
      await sleep(300);
      const c = await ninja(page);
      check(`${name}: resumes after freeze`, c.steps > b.steps && c.steps - b.steps < 40, { b: b.steps, c: c.steps });
      continue;
    }
    if (!bombAir && played > 12000) {
      const ts = await targets(page);
      const b = ts.find((t) => t.kind === 'bomb' && t.y < vp.height * 0.6);
      if (b) { bombAir = true; await shot('3c-bomb-air'); }
    }
    if (!bombDone && played > 15000 && p.score >= 120) {
      const hitsBefore = (await ninja(page)).bombsHit;
      const r = await botMove(page, vp, { hitBomb: true });
      if (r === 'bomb') {
        await sleep(90);
        if ((await ninja(page)).bombsHit === hitsBefore) continue; // the bot missed: try another bomb
        bombDone = true;
        await shot('5-bomb');
        const s = await ninja(page);
        check(`${name}: bomb stuns`, s.stunned && s.bombsHit === hitsBefore + 1, { stunned: s.stunned, hits: s.bombsHit, hitsBefore });
        await sleep(300);
        await shot('5b-stun');
        continue;
      }
    }
    const r = await botMove(page, vp);
    moves[r] = (moves[r] || 0) + 1;
    const now = await party(page);
    if (!midShot && played > 5000 && r !== 'none') { midShot = true; await shot('2-mid'); }
    if (!comboShot && now.score - lastScore >= 25 && r.startsWith('row')) { comboShot = true; await sleep(60); await shot('3-combo'); }
    if (!goldShot && r === 'gold') { goldShot = true; await sleep(60); await shot('3b-gold'); }
    if (shots && played > duration - 9500 && played < duration - 9000) await shot('6-late');
    lastScore = now.score;
    if (r === 'none' || r === 'blocked') await sleep(40);
  }
  const end = await party(page);
  await sleep(800);
  await shot('7-end');
  const n = await ninja(page);
  const expected = 10 * (n.sliced - n.golds) + 50 * n.golds + n.comboBonus - 50 * n.bombsHit;
  check(`${name}: final score matches the play`, end.score === expected && n.score === end.score, { score: end.score, expected, ...n, snapshot: undefined });
  console.log(`${name}: moves`, moves);
  await browser.close();
  return { end, errors };
}

async function main() {
  // ── full rounds on two phones, with a mid-action freeze and one bomb ──
  for (const [name, dev] of [['iphone14', devices['iPhone 14']], ['pixel7', devices['Pixel 7']]]) {
    const res = await play(name, dev, { duration: Number(process.env.NINJA_DURATION || 30000) });
    check(`${name}: round ended`, res.end.ended, res.end);
    check(`${name}: no errors`, res.errors.length === 0, res.errors.slice(0, 5));
  }
}

module.exports = { play, botMove, swipe, ninja, party, targets, check, fails, sleep, OUT, BASE };

if (require.main === module) {
  main()
    .then(() => {
      console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall ok');
      process.exit(fails.length ? 1 : 0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
