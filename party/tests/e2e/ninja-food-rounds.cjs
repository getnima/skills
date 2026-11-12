// ninja with the food set: real 60 s rounds at three phone sizes through real touch events
// (CDP), checked and photographed.
//   - every one of the 11 foods flies; the joke items (chair, flip-flop) come now and then;
//   - both host bombs appear and take turns (A, B, A, B) in the schedule and in the air;
//   - the golden falafel can be sliced (+50); slicing a bomb stuns (-50, blade down);
//   - the final score is what the slices add up to.
// Pictures (tests/e2e/out/ninja-food-look/): per size a full screenshot of the first throw,
// of both hosts in the air, of the stun and of a busy moment; a close-up of every target in
// the air and right after its cut (the halves, the splash); close-ups of both bombs (the
// fuse on the cap); and one contact sheet of all the close-ups.
//   PARTY_CLIENT_PORT=5261 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   QA_BASE=http://localhost:5261 node tests/e2e/ninja-food-rounds.cjs [320x568,390x844,430x932]
process.env.QA_BASE = process.env.QA_BASE || 'http://localhost:5261';
const path = require('path');
const fs = require('fs');
const { chromium, check, fails, sleep, outDir, openGame, touch } = require('./qa-tap-lib.cjs');

const OUT = outDir('ninja-food-look');
const FOODS = ['shawarma', 'hummus', 'sabich', 'falafel', 'bourekas', 'shakshuka', 'schnitzel', 'sufganiya', 'pickle', 'limonana', 'peanut_puffs'];
const JOKES = ['garden_chair', 'flip_flop'];
const BOMBS = ['bomb_host_a', 'bomb_host_b'];
const ALL = [...FOODS, ...JOKES, 'gold_falafel'];
const DURATION = 60000;
const SEEDS = { '320x568': 3, '390x844': 11, '430x932': 2 };

const read = (page) =>
  page.evaluate(() => {
    const n = window.__ninja;
    const p = window.__party;
    return { ts: n.targets(), top: n.fieldTop, fh: n.fieldH, g: n.gravityPx, stunned: n.stunned, sliced: n.sliced, golds: n.golds, bombsHit: n.bombsHit, combo: n.comboBonus, score: n.score, left: p.leftMs, ended: p.ended };
  });

function segDist(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + dx * t - cx, ay + dy * t - cy);
}

/** A horizontal swipe as a finger does it: down, a move every ~16 ms, up. */
async function swipe(cdp, id, ax, y, bx) {
  const pend = [touch(cdp, 'touchStart', [{ x: ax, y, id }])];
  for (let i = 1; i <= 6; i++) {
    await sleep(16);
    pend.push(touch(cdp, 'touchMove', [{ x: ax + ((bx - ax) * i) / 6, y, id }]));
  }
  await sleep(16);
  pend.push(touch(cdp, 'touchEnd', []));
  await Promise.all(pend);
}

async function round(browser, w, h) {
  const tag = `${w}x${h}`;
  const seed = SEEDS[tag] || 11;
  const { page, cdp, context, errors } = await openGame(browser, 'ninja', { viewport: { width: w, height: h }, query: `seed=${seed}&duration=${DURATION}` });
  await page.waitForFunction(() => !!window.__ninja, null, { timeout: 30000 });
  const plan = await page.evaluate(() => ({ kinds: window.__ninja.schedule(1000).map((t) => t.kind), skins: window.__ninja.skins(1000), art: window.__ninja.art }));
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) });
  /** A close-up around (x, y), bw x bh CSS px, kept inside the page. */
  const crop = (name, x, y, bw, bh) => {
    const cx = Math.max(0, Math.min(w - bw, x - bw / 2));
    const cy = Math.max(0, Math.min(h - bh, y - bh / 2));
    return page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`), clip: { x: cx, y: cy, width: Math.min(bw, w), height: Math.min(bh, h) } });
  };
  const air = new Set();
  const cut = new Set();
  const seenSkins = new Set();
  const bombsInAir = new Map(); // id → skin
  const done = {};
  let id = 10;
  let stun = null;
  let goldTries = 0;
  for (;;) {
    const st = await read(page);
    if (st.ended || st.left < 400) break;
    for (const t of st.ts) {
      seenSkins.add(t.skin);
      if (t.kind === 'bomb') bombsInAir.set(t.id, t.skin);
    }
    const lo = st.top + 50;
    const hi = st.top + st.fh - 40;
    const inView = st.ts.filter((t) => t.y > lo && t.y < hi && t.x > 20 && t.x < w - 20);
    const bombs = st.ts.filter((t) => t.kind === 'bomb');
    const R = st.ts[0] ? st.ts[0].r : 40;
    if (!done.first && inView.length > 0) {
      done.first = true;
      await shot('1-first');
      continue;
    }
    // close-ups in the air: one per picture, when it is high and slow (sharp, whole)
    const slow = inView.find((t) => !air.has(t.skin) && Math.abs(t.vy) < 420 && t.y < st.top + st.fh * 0.7);
    if (slow) {
      air.add(slow.skin);
      const bomb = slow.kind === 'bomb';
      await crop(`air-${slow.skin}`, slow.x, slow.y - (bomb ? R * 0.9 : 0), R * (bomb ? 5 : 3.6), R * (bomb ? 6.2 : 3.6));
      continue;
    }
    const hosts = new Set(bombs.filter((b) => b.y > lo && b.y < hi).map((b) => b.skin));
    if (!done.both && hosts.size === 2) {
      done.both = true;
      await shot('3-both-hosts');
      continue;
    }
    if (!done.busy && inView.length >= 5) {
      done.busy = true;
      await shot('2-busy');
      continue;
    }
    if (st.stunned) {
      await sleep(30);
      continue;
    }
    // once, past the middle and with points to lose: slice a bomb on purpose
    const victim = bombs.find((b) => b.y > lo + 40 && b.y < hi - 60 && Math.abs(b.vy) < 380);
    if (!stun && st.left < 34000 && st.score >= 100 && victim) {
      const y = victim.y + victim.vy * 0.07;
      await swipe(cdp, id++, victim.x - R * 1.9, y, victim.x + R * 1.9);
      const after = await read(page);
      if (after.bombsHit > st.bombsHit) {
        stun = { stunned: after.stunned, before: st.score, after: after.score, hit: after.bombsHit - st.bombsHit };
        await shot('4-stun');
      }
      continue;
    }
    // a target: gold first, then a picture not cut yet, then whatever is lowest; never next to a bomb
    const lead = 0.075;
    const cands = inView
      .filter((t) => t.kind !== 'bomb')
      .map((t) => ({ ...t, px: t.x + t.vx * lead, py: t.y + t.vy * lead + 0.5 * st.g * lead * lead }))
      .filter((t) => t.py > lo && t.py < hi && bombs.every((b) => segDist(t.px - R * 1.8, t.py, t.px + R * 1.8, t.py, b.x + b.vx * lead, b.y + b.vy * lead) > b.r * 2.5))
      .sort((a, b) => (b.kind === 'gold') - (a.kind === 'gold') || !cut.has(b.skin) - !cut.has(a.skin) || b.y - a.y);
    const t = cands[0];
    if (!t) {
      await sleep(25);
      continue;
    }
    if (t.kind === 'gold') goldTries++;
    await swipe(cdp, id++, t.px - R * 1.8, t.py, t.px + R * 1.8);
    if (!cut.has(t.skin)) {
      await sleep(70);
      const after = await read(page);
      if (after.sliced > st.sliced && !after.ts.some((o) => o.id === t.id)) {
        cut.add(t.skin);
        await crop(`cut-${t.skin}`, t.px + t.vx * 0.1, t.py + 20, R * 5.6, R * 5.2);
      }
    }
    await sleep(40);
  }
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 20000 });
  const end = await read(page);
  await context.close();

  // ── checks ──
  const bombPlan = plan.skins.filter((_, i) => plan.kinds[i] === 'bomb');
  const fruitPlan = plan.skins.filter((_, i) => plan.kinds[i] === 'fruit');
  const jokesPlanned = fruitPlan.filter((s) => JOKES.includes(s)).length;
  check(`${tag}: every picture is a real file`, [...ALL, ...BOMBS].every((k) => plan.art[k] === true), plan.art);
  check(`${tag}: every one of the 11 foods flew`, FOODS.every((f) => seenSkins.has(f)), FOODS.filter((f) => !seenSkins.has(f)));
  check(`${tag}: the joke items came, and rarely`, JOKES.every((j) => seenSkins.has(j)) && jokesPlanned / fruitPlan.length < 0.09, { planned: jokesPlanned, of: fruitPlan.length });
  check(`${tag}: schedule: bombs take turns A, B, A, B`, bombPlan.length >= 2 && bombPlan.every((s, i) => i === 0 || s !== bombPlan[i - 1]), bombPlan.map((s) => s.slice(-1)).join(''));
  const airBombs = [...bombsInAir.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  check(`${tag}: both hosts were in the air`, BOMBS.every((b) => airBombs.includes(b)), { a: airBombs.filter((s) => s === BOMBS[0]).length, b: airBombs.filter((s) => s === BOMBS[1]).length });
  check(`${tag}: in the air the hosts take turns too`, airBombs.every((s, i) => i === 0 || s !== airBombs[i - 1]), airBombs.map((s) => s.slice(-1)).join(''));
  check(`${tag}: the golden falafel was sliced`, end.golds >= 1, { golds: end.golds, tries: goldTries });
  check(`${tag}: slicing a bomb stuns and costs 50`, !!stun && stun.stunned && stun.after === Math.max(0, stun.before - 50 * stun.hit), stun);
  const expected = 10 * (end.sliced - end.golds) + 50 * end.golds + end.combo - 50 * end.bombsHit;
  check(`${tag}: the final score is what the slices add up to`, end.score === expected && end.score > 0, { score: end.score, expected, sliced: end.sliced, golds: end.golds, combo: end.combo, bombs: end.bombsHit });
  check(`${tag}: a close-up of every target in the air and cut`, ALL.filter((k) => k !== 'gold_falafel').every((k) => air.has(k) && cut.has(k)), { noAir: ALL.filter((k) => !air.has(k)), noCut: ALL.filter((k) => !cut.has(k)) });
  check(`${tag}: no errors`, errors.length === 0, errors.slice(0, 3));
  return { tag, air: [...air], cut: [...cut] };
}

/** One sheet of the close-ups of a round: every target in the air and cut, then the bombs. */
async function sheet(browser, r) {
  const img = (name) => {
    const f = path.join(OUT, `${r.tag}-${name}.png`);
    return fs.existsSync(f) ? `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" style="height:150px;border:2px solid #ffd21f;border-radius:8px;display:block">` : '<div style="height:150px;width:150px;border:2px dashed #888;border-radius:8px"></div>';
  };
  const cell = (k) => `<figure style="margin:0"><figcaption style="margin-bottom:4px">${k}</figcaption><div style="display:flex;gap:6px">${img(`air-${k}`)}${img(`cut-${k}`)}</div></figure>`;
  const bomb = (k) => `<figure style="margin:0"><figcaption style="margin-bottom:4px">${k}</figcaption>${img(`air-${k}`).replace('height:150px', 'height:330px')}</figure>`;
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.setContent(
    `<body style="margin:0;background:#150a33;font:700 15px system-ui;color:#fff;padding:16px"><div style="font-size:20px;margin-bottom:10px">${r.tag}: in the air | right after the cut</div><div style="display:flex;flex-wrap:wrap;gap:14px;width:1460px">${ALL.map(cell).join('')}</div><div style="display:flex;gap:14px;margin-top:14px">${BOMBS.map(bomb).join('')}</div></body>`,
  );
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
  await page.setViewportSize({ width: box.w, height: box.h });
  const file = path.join(OUT, `${r.tag}-closeups.png`);
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

(async () => {
  const sizes = (process.argv[2] || '320x568,390x844,430x932').split(',').map((s) => s.split('x').map(Number));
  const browser = await chromium.launch();
  for (const [w, h] of sizes) {
    const r = await round(browser, w, h);
    console.log(`${r.tag}: close-ups → ${await sheet(browser, r)}`);
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
