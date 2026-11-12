// Scripted players over full production rounds (50 s) of the tap game, driven with real CDP
// touches on a wall-clock schedule: slow / normal / fast (two thumbs) / five-finger mash / a
// held finger / starts at 1 s / starts at 25 s / never taps. Prints raw scores, the beats each
// saw and when, and checks the round-format rules.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-comedy-play.cjs [WxH] [fps] [seed]
const L = require('./qa-tap-comedy-lib.cjs');

const SIZE = process.argv[2] || '390x844';
const FPS = Number(process.argv[3] || 0);
const SEED = Number(process.argv[4] || 7);
const [W, H] = SIZE.split('x').map(Number);
const DURATION = 50000;

const PLAYERS = [
  { name: 'slow', times: () => L.steady(3, 2000, 21000, 0.6, 11) },
  { name: 'normal', times: () => L.steady(6, 2000, 21000, 0.3, 12) },
  { name: 'fast', times: () => L.steady(11, 2000, 21000, 0.15, 13) },
  { name: 'mash5', fingers: 5, times: () => L.steady(8, 2000, 21000, 0.2, 14) },
  // five fingers drumming one after the other (5 x 5/s, staggered): 25 touches/s
  { name: 'drum5', times: () => L.steady(25, 2000, 21000, 0.3, 17) },
  { name: 'held', held: true, times: () => [2000] },
  { name: 'start1s', times: () => L.steady(6, 1000, 21000, 0.3, 15) },
  { name: 'start25s', times: () => L.steady(6, 25000, 21000, 0.3, 16) },
  { name: 'never', times: () => [] },
];

let ids = 50000;
async function play(browser, p) {
  const { page, cdp, context, errors } = await L.openTap(browser, { viewport: { width: W, height: H }, seed: SEED, duration: DURATION, fps: FPS || undefined });
  const s0 = await L.st(page);
  const left = await page.evaluate(() => window.__party.leftMs);
  const roundZero = Date.now() - (DURATION - left);
  const times = p.times();
  const cx = s0.x;
  const cy = s0.y + s0.r * 0.3;
  let sent = 0;
  for (let i = 0; i < times.length; i++) {
    const due = roundZero + times[i];
    const wait = due - Date.now();
    if (wait > 0) await L.sleep(wait);
    const side = i % 2 === 0 ? -1 : 1;
    const n = p.fingers || 1;
    const pts = [];
    for (let f = 0; f < n; f++) pts.push({ x: cx + side * 40 + f * 22 - (n - 1) * 11, y: cy + f * 9, id: ids++ });
    if (p.held) {
      await L.touch(cdp, 'touchStart', pts);
    } else {
      void Promise.all([L.touch(cdp, 'touchStart', pts), L.touch(cdp, 'touchEnd', [])]);
    }
    sent++;
  }
  // follow the state until the round ends (the last state before the end is kept)
  let s = null;
  while (true) {
    const now = await page.evaluate(() => ({ s: window.__tap ? window.__tap() : null, ended: window.__party.ended }));
    if (now.s) s = now.s;
    if (now.ended) break;
    await L.sleep(now.s && now.s.phase === 'done' ? 250 : 60);
  }
  const endedAtWall = Date.now() - roundZero;
  if (p.held) await L.touch(cdp, 'touchEnd', []);
  await context.close();
  return { p, s, sent, errors, endedAtWall };
}

function gaps(s) {
  // what the player sees during the sprint: beats + drips + innocence + soft stickers
  const t0 = s.t0;
  const marks = [...s.beats, ...s.events].filter((e) => e.roundMs >= t0 && e.roundMs <= s.endAt).map((e) => e.roundMs).sort((a, b) => a - b);
  let worst = 0;
  let prev = t0;
  for (const m of [...marks, s.endAt]) {
    worst = Math.max(worst, m - prev);
    prev = m;
  }
  return worst;
}

(async () => {
  const browser = await L.chromium.launch();
  const results = [];
  for (let i = 0; i < PLAYERS.length; i += 4) {
    const batch = PLAYERS.slice(i, i + 4);
    results.push(...(await Promise.all(batch.map((p) => play(browser, p)))));
  }
  await browser.close();
  const by = {};
  for (const r of results) {
    const s = r.s;
    by[r.p.name] = s;
    const beats = s ? s.beats.filter((b) => !b.id.startsWith('wait-')).map((b) => `${b.id}@${b.taps}t/${(b.sprintMs / 1000).toFixed(1)}s`) : [];
    console.log(
      JSON.stringify({
        player: r.p.name,
        size: SIZE,
        fps: FPS || 60,
        touchstarts: r.sent,
        score: s ? s.taps : null,
        bounces: s ? s.bounces : null,
        t0: s ? s.t0 : null,
        sprintMs: s && s.endAt >= 0 ? s.endAt - s.t0 : null,
        finishedAt: s ? s.finishedAtMs : null,
        worstGapS: s && s.t0 >= 0 ? +(gaps(s) / 1000).toFixed(2) : null,
        beats,
        waitingBits: s ? s.beats.filter((b) => b.id.startsWith('wait-')).map((b) => `${b.id}@${(b.roundMs / 1000).toFixed(1)}s`) : [],
        errors: r.errors.slice(0, 2),
      }),
    );
  }
  const sc = (n) => (by[n] ? by[n].taps : -1);
  L.check('order fast > normal > slow > never', sc('fast') > sc('normal') && sc('normal') > sc('slow') && sc('slow') > sc('never'), [sc('fast'), sc('normal'), sc('slow'), sc('never')]);
  L.check('five-finger slaps do not beat the fast player', sc('mash5') < sc('fast'), [sc('mash5'), sc('fast')]);
  L.check('five-finger drumming stays under the 283 ceiling', sc('drum5') <= 283, sc('drum5'));
  L.check('never: auto-start at 30 s, score 0', by.never && by.never.t0 === 30000 && sc('never') === 0, by.never && by.never.t0);
  L.check('held finger counts once', sc('held') === 1, sc('held'));
  for (const r of results) {
    const s = r.s;
    if (!s || s.endAt < 0) continue;
    L.check(`${r.p.name}: sprint is exactly 20 s of round time`, s.endAt - s.t0 === 20000 || s.endAt === DURATION, s.endAt - s.t0);
    if (s.finishedAtMs >= 0) L.check(`${r.p.name}: finished within one step of the sprint end`, s.finishedAtMs - s.endAt >= 0 && s.finishedAtMs - s.endAt <= 17, s.finishedAtMs - s.endAt);
    L.check(`${r.p.name}: round ends at the cap (50 s)`, r.endedAtWall >= 49000 && r.endedAtWall < 53500, r.endedAtWall);
  }
  if (by.slow) L.check('slow player sees something new at least every 3 s', gaps(by.slow) <= 3000, gaps(by.slow));
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
