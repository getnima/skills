// sweep-phone-games: six phones (the six profiles of sweep-phone-lib) + 14 socket bots = 20 guests in one
// real room driven by a raw socket host, through every game and every screen around it:
//   tap (start window, sprint, the auto-start, the final frame), icy, flappy x2 (the out view and the
//   finale on every phone), plotzel (typing, a rejected word, skip + confirm), ninja (a sliced bomb),
//   the freeze overlay + resume 3-2-1 in every game, intro / countdown, sending, suspense, the win
//   moment, who-won, results with 20 players, the between-rounds lobby, a late joiner, kicked, rotate
//   mid-game, the reconnect banner mid-game, the final podium, rotate + banner on the final screen,
//   a server restart (room closed), and kicked on every phone.
//
// It starts (and restarts) its OWN game server on PORT 8951 (stop any other first) and needs vite:
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/sweep-phone-games.cjs          (GAMES=tap,icy to run some rounds)
//
// Outputs: tests/e2e/out/sweep-phone-/games/ (screenshots <phone>-<game>-<beat>.png, findings.jsonl)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const S = require('./sweep-phone-lib.cjs');

const { L } = S;
const OUT = path.join(S.OUT_ROOT, 'games');
const log = S.makeLog('games', OUT);
const PORT = 8951;
const DURATION = 30000;
const ROOT = path.join(__dirname, '../..');

const NAMES = { se: 'שושנה דמארי 99', ip14: 'דנה Dana 2', promax: 'אלכסנדרה הגדול', pixel7: 'יוסי 🎉 המלך', s8: 'מיכל בת 30', a412: 'Avi אבי 7 🍺' };
const BOT_NAMES = ['רוני', 'Guest 2', 'מוזמנת 3', 'אורח עם שם ארוך', 'דניאלה', 'Mike', 'שירה 🎉', 'בני', 'עמית', 'ליאת', 'Yael יעל', 'גל', 'נועה', 'Tom'];

// ───────── server ─────────
let server = null;
let serverLog = '';
async function startServer() {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), PARTY_TEST_FAST: '', PARTY_TEST_DURATION_MS: String(DURATION) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  await L.waitFor(async () => {
    try {
      return (await fetch(`http://localhost:${PORT}/healthz`)).ok;
    } catch {
      return false;
    }
  }, 30000, 'server up');
}
function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {}
  server = null;
}

// ───────── state ─────────
let host = null;
let skew = 0;
const pages = {};
const all = () => S.ORDER.map((k) => pages[k]).filter(Boolean);
let bots = null;
const wins = {}; // profile -> rounds won (seen as the 'win' screen)

function hookHost(h) {
  h.socket.on('state', (st) => (skew = st.serverNow - Date.now()));
}
function elapsed() {
  const st = host.state();
  if (!st || !st.round) return -1;
  const r = st.round;
  const now = r.frozenAt !== null ? r.frozenAt : Date.now() + skew;
  return now - r.startAt;
}
async function atRound(ms, maxWait = 60000) {
  await L.waitFor(() => elapsed() >= ms || (host.state() && host.state().phase !== 'playing' && host.state().phase !== 'countdown' && host.state().phase !== 'intro'), maxWait, `round time ${ms}`);
}
const phase = () => (host.state() ? host.state().phase : null);

async function shotAll(list, label, opts) {
  await Promise.all(list.map((p) => S.sweepShot(p, OUT, label, log, opts)));
}
async function waitAll(list, screens, ms, label) {
  const res = await Promise.allSettled(list.map((p) => L.waitScreen(p, screens, ms)));
  res.forEach((r, i) => {
    if (r.status === 'rejected') log.issue('stuck', `${list[i].__name}@${label}`, r.reason.message);
  });
}

// ───────── drivers ─────────
const W = (p) => p.viewportSize().width;
const H = (p) => p.viewportSize().height;

async function tapN(p, n, perSec = 7) {
  for (let i = 0; i < n; i++) {
    await S.touchTap(p, W(p) / 2 + ((i * 37) % 80) - 40, H(p) * 0.6 + ((i * 53) % 60) - 30);
    await L.sleep(1000 / perSec);
  }
}

function icyDriver(p, seed) {
  let stop = false;
  let r = seed;
  const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const run = (async () => {
    while (!stop && (phase() === 'playing' || phase() === 'countdown')) {
      if (host.state().round && host.state().round.frozenAt !== null) {
        await L.sleep(200);
        continue;
      }
      const left = rnd() < 0.5;
      const x = left ? W(p) * 0.18 : W(p) * 0.82;
      const y = H(p) * 0.72;
      try {
        await S.touchDown(p, x, y, 5);
        await L.sleep(250 + rnd() * 900);
        await S.touchUp(p, x, y, 5);
      } catch {}
      await L.sleep(60 + rnd() * 200);
    }
  })();
  return { stop: async () => ((stop = true), await run) };
}

async function flappy(p, fn) {
  await L.waitFor(() => p.evaluate(() => !!window.__flappy), 10000, 'flappy hook').catch(() => {});
  return p.evaluate(fn).catch((e) => 'ERR ' + e.message);
}

async function typeWord(p, word) {
  for (const ch of word) {
    const loc = p.locator(`.pz-key[data-k="${ch}"]`);
    if ((await loc.count()) === 0) {
      log.issue('plotzel-key-missing', p.__name, `no key for "${ch}" of "${word}"`);
      continue;
    }
    await loc.first().tap();
    await L.sleep(90);
  }
  await p.locator('.pz-key[data-k="ENTER"]').first().tap();
  await L.sleep(250);
}

function ninjaDriver(p, everyMs, avoidBombs = true) {
  let stop = false;
  let swipes = 0;
  const run = (async () => {
    while (!stop && phase() === 'playing') {
      if (host.state().round && (host.state().round.frozenAt !== null || host.state().round.resumeAt)) {
        await L.sleep(200);
        continue;
      }
      let st = null;
      try {
        st = await p.evaluate(() => (window.__ninja ? { ts: window.__ninja.targets(), top: window.__ninja.fieldTop, fh: window.__ninja.fieldH } : null));
      } catch {}
      if (st && st.ts.length) {
        const bombs = st.ts.filter((t) => t.kind === 'bomb');
        const fruit = st.ts.filter((t) => t.kind !== 'bomb' && t.y > st.top + 20 && t.y < st.top + st.fh - 10 && t.x > 10 && t.x < W(p) - 10);
        const f = fruit[0];
        if (f) {
          const L2 = f.r * 1.8;
          const seg = [f.x - L2, f.y + 6, f.x + L2, f.y - 6];
          const near = bombs.some((b) => Math.hypot(b.x - f.x, b.y - f.y) < b.r * 3);
          if (!avoidBombs || !near) {
            await S.swipe(p, S.line(seg[0], seg[1], seg[2], seg[3], 4)).catch(() => {});
            swipes++;
          }
        }
      }
      await L.sleep(everyMs);
    }
  })();
  return { stop: async () => ((stop = true), await run, swipes) };
}

async function sliceBomb(p, untilMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < untilMs) {
    const st = await p.evaluate(() => (window.__ninja ? { ts: window.__ninja.targets(), top: window.__ninja.fieldTop, fh: window.__ninja.fieldH, hit: window.__ninja.bombsHit } : null)).catch(() => null);
    if (st && st.hit > 0) return true;
    const b = st && st.ts.find((t) => t.kind === 'bomb' && t.y > st.top + 30 && t.y < st.top + st.fh - 30);
    if (b) {
      await S.swipe(p, S.line(b.x - b.r * 1.6, b.y + b.r * 0.2, b.x + b.r * 1.6, b.y - b.r * 0.2, 4)).catch(() => {});
      await L.sleep(120);
    } else await L.sleep(80);
  }
  return false;
}

// ───────── after the round ─────────
async function endBeats(game, opts = {}) {
  const list = all();
  // sending (short), suspense, then the win / who-won moment, results
  await Promise.all(
    list.map(async (p) => {
      try {
        await L.waitScreen(p, ['sending', 'suspense', 'win', 'reveal', 'results'], 70000);
        if ((await L.screen(p)) === 'sending') await S.sweepShot(p, OUT, `${game}-7-sending`, log);
      } catch (e) {
        log.issue('stuck', `${p.__name}@${game}-end`, e.message);
      }
    }),
  );
  await waitAll(list, ['suspense', 'win', 'reveal', 'results'], 15000, `${game}-suspense`);
  if (!opts.quick) {
    await L.sleep(500);
    const sus = [];
    for (const p of list) if ((await L.screen(p)) === 'suspense') sus.push(p);
    await shotAll(sus, `${game}-8-suspense`);
    // nothing of the round may show yet: the me bar keeps the old standing
    for (const p of sus) {
      const mb = await p.evaluate(() => window.__player.meBar).catch(() => null);
      log.check(mb && mb.hidingRound, 'spoiler', `${p.__name}/${game}-suspense`, `me bar during suspense ${JSON.stringify(mb)}`);
    }
  }
  await waitAll(list, ['win', 'reveal', 'results'], 20000, `${game}-reveal`);
  await L.sleep(1500);
  const st = host.state();
  const res = st.results;
  const winnerId = res && res.winnerIds[0];
  const winners = [];
  for (const p of list) {
    const scr = await L.screen(p);
    const me = await p.evaluate(() => window.__player.snap.playerId).catch(() => null);
    if (scr === 'win') {
      winners.push(p.__name);
      log.check(me === winnerId, 'wrong-winner-screen', `${p.__name}/${game}`, `shows WIN but the round winner is ${winnerId} (me ${me})`);
      wins[p.__key] = (wins[p.__key] || 0) + 1;
    } else if (me === winnerId) log.issue('winner-no-win-screen', `${p.__name}/${game}`, `round winner shows "${scr}"`);
  }
  const winRow = res && res.rows.find((r) => r.playerId === winnerId);
  console.log(`  [games ${S.stamp()}] ${game}: winner ${winRow ? winRow.name : 'nobody'} raw ${winRow ? winRow.raw : '-'}; phones on WIN: ${winners.join(',') || 'none'}; rows ${res ? res.rows.length : 0}`);
  log.check(res && res.rows.length === 20, 'results-rows', game, `results have ${res ? res.rows.length : 0} rows (20 guests)`);
  if (res) {
    const rr = res.rows.map((r) => r.roundRank).sort((a, b) => a - b);
    log.check(rr.every((v, i) => v === i + 1), 'round-rank', game, `round ranks ${rr.join(',')}`);
    const pts = res.rows.filter((r) => r.raw > 0).map((r) => r.points);
    log.check(new Set(pts).size === pts.length, 'tied-points', game, `points ${pts.join(',')}`);
    const tots = res.rows.filter((r) => r.total > 0).map((r) => r.total);
    log.check(new Set(tots).size === tots.length, 'tied-totals', game, `totals ${tots.join(',')}`);
    log.check(!winRow || winRow.roundRank === 1, 'winner-rank', game, `winner's round rank ${winRow && winRow.roundRank}`);
  }
  await Promise.all(list.map(async (p) => {
    const scr = await L.screen(p);
    if (scr === 'win' || scr === 'reveal') await S.sweepShot(p, OUT, `${game}-9-${scr}`, log);
  }));
  // leave the moment: the win button, a tap on who-won
  for (const p of list) {
    const scr = await L.screen(p);
    try {
      if (scr === 'win') await p.locator('.pp-win .pp-btn').first().tap({ timeout: 5000 });
      else if (scr === 'reveal') await p.locator('.pp-reveal').first().tap({ timeout: 5000 });
    } catch (e) {
      log.issue('dismiss', `${p.__name}/${game}`, `could not leave the ${scr} moment: ${e.message.split('\n')[0]}`);
    }
  }
  await waitAll(list, 'results', 20000, `${game}-results`);
  await L.sleep(1800);
  await shotAll(list, `${game}-a-results`, { fonts: game === 'tap' });
  // the 20-row list
  for (const p of list) {
    const info = await p.evaluate(() => {
      const l = document.querySelector('.pp-on-results .pp-top3, .pp-on-results ol');
      if (!l) return null;
      return { n: l.children.length, sh: l.scrollHeight, ch: l.clientHeight, oy: getComputedStyle(l).overflowY };
    }).catch(() => null);
    if (info) {
      log.check(info.n === 20, 'results-list', `${p.__name}/${game}`, `the phone's results list has ${info.n} rows`);
      if (info.sh > info.ch + 2) log.check(/auto|scroll/.test(info.oy), 'results-unreachable', `${p.__name}/${game}`, JSON.stringify(info));
    }
  }
  await host.call('host:lobby', {});
  await waitAll(list, 'lobby', 15000, `${game}-lobby`);
  await L.sleep(1200);
  if (!opts.quick) await shotAll(list, `${game}-b-lobby-between`);
}

async function freezeBeat(game, extraShots) {
  await host.call('host:cutscene', { id: 'joker_1' });
  await Promise.all(all().map((p) => L.waitFor(() => p.evaluate(() => window.__player.cutscene), 6000, 'cutscene').catch(() => log.issue('freeze-missing', `${p.__name}/${game}`, 'no cutscene overlay within 6 s'))));
  await L.sleep(700);
  await shotAll(all(), `${game}-5-freeze`);
  // the game must not move under the overlay
  const before = await Promise.all(all().map((p) => S.playInfo(p)));
  await L.sleep(1500);
  const after = await Promise.all(all().map((p) => S.playInfo(p)));
  all().forEach((p, i) => {
    if (before[i] && after[i]) log.check(Math.abs(before[i].leftMs - after[i].leftMs) < 120, 'freeze-clock', `${p.__name}/${game}`, `round clock moved during the freeze: ${before[i].leftMs} -> ${after[i].leftMs}`);
  });
  if (extraShots) await extraShots();
  await host.call('host:cutsceneEnd', {});
  await Promise.all(all().map((p) => L.waitFor(() => p.evaluate(() => !!document.querySelector('.pp-resume')), 4000, 'resume').catch(() => null)));
  await L.sleep(250);
  const res = [];
  for (const p of all()) res.push(await p.evaluate(() => !!document.querySelector('.pp-resume')).catch(() => false));
  all().forEach((p, i) => log.check(res[i], 'resume-missing', `${p.__name}/${game}`, 'no resume 3-2-1 after the freeze'));
  await shotAll(all(), `${game}-6-resume`, { allowOverlap: true });
  await Promise.all(all().map((p) => L.waitFor(() => p.evaluate(() => !document.querySelector('.pp-resume')), 6000, 'resumed').catch(() => log.issue('resume-stuck', `${p.__name}/${game}`, 'resume 3-2-1 still up after 6 s'))));
}

async function startRound(game) {
  for (const p of all()) p.__label = `${game}-start`;
  await host.call('host:start', { gameId: game });
  await waitAll(all(), 'intro', 10000, `${game}-intro`);
  await L.sleep(1500);
  await L.sleep(300);
  await shotAll(all(), `${game}-1-intro`);
  await waitAll(all(), ['countdown', 'playing'], 12000, `${game}-countdown`);
  await L.sleep(200);
  const cd = [];
  for (const p of all()) if ((await L.screen(p)) === 'countdown') cd.push(p);
  await shotAll(cd, `${game}-2-countdown`, { allowOverlap: true });
  await waitAll(all(), 'playing', 8000, `${game}-playing`);
}

// ───────── rounds ─────────
const ROUNDS = {
  async tap() {
    await startRound('tap');
    await atRound(1200);
    await shotAll(all(), 'tap-3-window');
    const starters = { se: 45, ip14: 20, promax: 15, pixel7: 28, a412: 10 };
    const tappers = Object.entries(starters).map(([k, n]) => tapN(pages[k], n, 7));
    await atRound(4000);
    await shotAll(all(), 'tap-4-sprint', { allowSmall: true });
    await Promise.all(tappers);
    await atRound(6000);
    await freezeBeat('tap');
    // the waiting phone: the last 5 s of the window, then the auto-start
    const tapT = await pages.s8.evaluate(() => (window.__tap ? window.__tap() : null)).catch(() => null);
    console.log(`  [games] tap s8 before auto-start: phase ${tapT && tapT.phase} layout ${tapT && JSON.stringify(tapT.layout)}`);
    await atRound(14200);
    await S.sweepShot(pages.s8, OUT, 'tap-c-autostart-countdown', log);
    await atRound(18200);
    await S.sweepShot(pages.s8, OUT, 'tap-d-autostarted', log);
    const t2 = await pages.s8.evaluate(() => (window.__tap ? window.__tap() : null)).catch(() => null);
    log.check(t2 && (t2.phase === 'sprint' || t2.phase === 'last'), 'tap-autostart', 's8', `17 s window over: the tap engine is in "${t2 && t2.phase}"`);
    // the finished phones show their final frame
    await shotAll(['se', 'ip14', 'promax', 'pixel7', 'a412'].map((k) => pages[k]), 'tap-e-final-frame');
    await tapN(pages.s8, 12, 6);
    await endBeats('tap');
  },

  async icy() {
    await startRound('icy');
    const drivers = all().map((p, i) => icyDriver(p, 7 + i * 13));
    await atRound(1500);
    await shotAll(all(), 'icy-3-start');
    // a late joiner on the smallest phone and on the notch phone
    const late = [];
    for (const k of ['se', 'promax']) {
      const p = await S.openProfile(browserRef, k, log, { name: `late-${k}` });
      await p.goto(`${L.CLIENT}/?room=${code}`);
      await L.waitScreen(p, 'join', 20000);
      await p.fill('.pp-name-input', 'מאחרת');
      await p.tap('.pp-btn-go');
      late.push(p);
    }
    await Promise.all(late.map((p) => L.waitScreen(p, 'late', 10000).catch((e) => log.issue('late', p.__name, e.message))));
    await L.sleep(800);
    await shotAll(late, 'icy-late');
    await atRound(9000);
    await shotAll(all(), 'icy-4-mid');
    await freezeBeat('icy', () => shotAll(late, 'icy-late-freeze'));
    // kick the late joiners: the kicked screen, then a fresh join form
    for (const p of late) {
      const id = await p.evaluate(() => window.__player.snap.playerId);
      await host.call('host:kick', { playerId: id });
    }
    await Promise.all(late.map((p) => L.waitScreen(p, 'kicked', 8000).catch((e) => log.issue('kicked', p.__name, e.message))));
    await L.sleep(600);
    await shotAll(late, 'icy-kicked');
    for (const p of late) {
      await p.locator('.pp-btn').first().tap().catch(() => {});
      await L.waitScreen(p, 'join', 5000).catch((e) => log.issue('kicked-restart', p.__name, e.message));
      await S.sweepShot(p, OUT, 'icy-after-kicked', log);
      await p.__ctx.close();
    }
    // rotate mid-game
    const px = pages.pixel7;
    const vp = px.viewportSize();
    await L.exitFs(px);
    await px.setViewportSize({ width: vp.height, height: vp.width });
    await L.sleep(800);
    await S.sweepShot(px, OUT, 'icy-r-rotated', log);
    const rot = await px.evaluate(() => ({ landscape: !!document.querySelector('.pp-landscape'), shown: getComputedStyle(document.querySelector('.pp-rotate')).display !== 'none' }));
    log.check(rot.landscape && rot.shown, 'rotate-overlay', 'pixel7/icy', JSON.stringify(rot));
    await px.setViewportSize(vp);
    await L.sleep(800);
    const cv = await px.evaluate(() => {
      const c = document.querySelector('.pa-stage-game canvas');
      const r = c ? c.getBoundingClientRect() : null;
      return r ? { w: Math.round(r.width), h: Math.round(r.height), iw: innerWidth, ih: innerHeight } : null;
    });
    log.check(cv && cv.w === cv.iw && Math.abs(cv.h - cv.ih) <= 1, 'rotate-canvas', 'pixel7/icy', `canvas after rotating back ${JSON.stringify(cv)}`);
    await S.sweepShot(px, OUT, 'icy-s-rotated-back', log);
    await atRound(24000);
    await shotAll(all(), 'icy-z-late');
    await Promise.all(drivers.map((d) => d.stop()));
    await endBeats('icy');
  },

  async flappyA() {
    await flappyRound('flappyA', ['promax', 'pixel7', 'a412'], ['pixel7', 'promax']);
  },
  async flappyB() {
    await flappyRound('flappyB', ['se', 'ip14', 's8'], ['se', 'ip14']);
  },

  async plotzel() {
    await startRound('plotzel');
    await atRound(800);
    await shotAll(all(), 'plotzel-3-start', { fonts: true });
    const info = await pages.pixel7.evaluate(() => ({ start: window.__plotzel.start, par: window.__plotzel.par, path: window.__plotzel.path() })).catch((e) => ({ err: e.message }));
    console.log(`  [games] plotzel: ${JSON.stringify(info)}`);
    // pixel7 solves the ladder; promax types a word that is not a step; a412 types and erases;
    // s8 makes one good step
    const solver = (async () => {
      for (let i = 0; i < 8; i++) {
        const st = await pages.pixel7.evaluate(() => ({ path: window.__plotzel.path(), solved: window.__plotzel.solved, idx: window.__plotzel.puzzleIndex })).catch(() => null);
        if (!st || st.idx > 0 || st.path.length < 2) break;
        await typeWord(pages.pixel7, st.path[1]);
      }
    })();
    const wrong = (async () => {
      await typeWord(pages.promax, 'שמשמ');
      await L.sleep(250);
      await S.sweepShot(pages.promax, OUT, 'plotzel-4-rejected', log);
    })();
    const eraser = (async () => {
      for (const ch of 'שימ') await pages.a412.locator(`.pz-key[data-k="${ch}"]`).first().tap();
      await S.sweepShot(pages.a412, OUT, 'plotzel-4-typing', log);
      for (let i = 0; i < 3; i++) await pages.a412.locator('.pz-key[data-k="BACK"]').first().tap();
    })();
    const step = (async () => {
      const p = await pages.s8.evaluate(() => window.__plotzel.path()).catch(() => []);
      if (p.length > 1) await typeWord(pages.s8, p[1]);
      await S.sweepShot(pages.s8, OUT, 'plotzel-4-one-step', log);
    })();
    await Promise.all([solver, wrong, eraser, step]);
    await atRound(7000);
    await shotAll(all(), 'plotzel-4-mid');
    await freezeBeat('plotzel');
    // skip: unlocks after 15 s on one ladder, a second tap confirms
    await atRound(16500);
    for (const k of ['se', 'ip14']) {
      const p = pages[k];
      const ready = await p.evaluate(() => window.__plotzel && window.__plotzel.skipReady).catch(() => false);
      log.check(ready, 'plotzel-skip-ready', k, 'skip not ready 16.5 s into the first ladder');
      await p.locator('[data-act="skip"]').first().tap().catch((e) => log.issue('plotzel-skip', k, e.message.split('\n')[0]));
      await L.sleep(300);
      await S.sweepShot(p, OUT, 'plotzel-5-skip-armed', log);
      await p.locator('[data-act="skip"]').first().tap().catch(() => {});
      await L.sleep(500);
      await S.sweepShot(p, OUT, 'plotzel-5-skip-reveal', log);
      const ph = await p.evaluate(() => window.__plotzel.phase).catch(() => null);
      log.check(ph === 'reveal', 'plotzel-skip', k, `after skip + confirm the phase is ${ph}`);
    }
    await atRound(21000);
    await shotAll(all(), 'plotzel-z-late');
    const solved = await pages.pixel7.evaluate(() => window.__plotzel.results).catch(() => null);
    console.log(`  [games] plotzel pixel7 results ${JSON.stringify(solved)}`);
    await endBeats('plotzel');
  },

  async ninja() {
    await startRound('ninja');
    const sched = await pages.s8.evaluate(() => window.__ninja && window.__ninja.schedule(40)).catch(() => null);
    const firstBomb = sched ? sched.find((t) => t.kind === 'bomb') : null;
    console.log(`  [games] ninja first bomb ${JSON.stringify(firstBomb)}`);
    const drivers = { ip14: ninjaDriver(pages.ip14, 120), se: ninjaDriver(pages.se, 350), promax: ninjaDriver(pages.promax, 450), pixel7: ninjaDriver(pages.pixel7, 500), s8: ninjaDriver(pages.s8, 600) };
    await atRound(1200);
    await shotAll(all(), 'ninja-3-start');
    // a412 slices a bomb on purpose
    const hit = await sliceBomb(pages.a412, 15000);
    log.check(hit, 'ninja-bomb', 'a412', 'could not slice a bomb in 15 s');
    if (hit) {
      await S.sweepShot(pages.a412, OUT, 'ninja-4-bomb-hit', log);
      const st = await pages.a412.evaluate(() => ({ stunned: window.__ninja.stunned, score: window.__ninja.score, bombs: window.__ninja.bombsHit }));
      console.log(`  [games] ninja a412 after the bomb ${JSON.stringify(st)}`);
    }
    drivers.a412 = ninjaDriver(pages.a412, 500);
    await atRound(9000);
    await shotAll(all(), 'ninja-4-mid');
    await freezeBeat('ninja');
    // the reconnect banner mid-game
    const p = pages.ip14;
    p.__offline = true;
    await p.__ctx.setOffline(true);
    const t0 = Date.now();
    await L.waitFor(() => p.evaluate(() => window.__player.banner), 30000, 'banner').catch((e) => log.issue('banner', 'ip14/ninja', e.message));
    console.log(`  [games] ninja ip14 banner after ${Date.now() - t0} ms offline`);
    await S.sweepShot(p, OUT, 'ninja-o-offline-banner', log);
    await L.sleep(2500);
    await p.__ctx.setOffline(false);
    await L.waitFor(async () => !(await p.evaluate(() => window.__player.banner)), 20000, 'banner gone').catch((e) => log.issue('banner-stuck', 'ip14/ninja', e.message));
    p.__offline = false;
    await atRound(22000);
    await shotAll(all(), 'ninja-z-late');
    const swipes = {};
    for (const [k, d] of Object.entries(drivers)) swipes[k] = await d.stop();
    console.log(`  [games] ninja swipes ${JSON.stringify(swipes)}`);
    await endBeats('ninja');
  },

  async tap2() {
    for (const p of all()) p.__label = 'tap2';
    await host.call('host:start', { gameId: 'tap' });
    await waitAll(all(), 'playing', 25000, 'tap2-playing');
    await atRound(800);
    await Promise.all([tapN(pages.promax, 50, 8), tapN(pages.se, 5), tapN(pages.ip14, 5), tapN(pages.pixel7, 5), tapN(pages.s8, 5), tapN(pages.a412, 5)]);
    await endBeats('tap2', { quick: true });
  },
};

async function flappyRound(game, survivors, crashOrder) {
  await startRound('flappy');
  for (const p of all()) p.__label = game;
  await Promise.all(survivors.map((k) => flappy(pages[k], () => (window.__flappy.autopilot(true), 'on'))));
  await atRound(700);
  await shotAll(all(), `${game}-3-start`);
  const outers = all().filter((p) => !survivors.includes(p.__key));
  // the others crash by themselves (no taps): the out view
  await Promise.all(outers.map((p) => L.waitFor(() => p.evaluate(() => window.__flappy && window.__flappy.mode !== 'fly'), 12000, 'crash').catch((e) => log.issue('flappy-no-crash', `${p.__name}/${game}`, e.message))));
  await L.sleep(1800);
  await shotAll(outers, `${game}-4-out-view`);
  for (const p of outers) {
    const o = await p.evaluate(() => ({ mode: window.__flappy.mode, out: window.__flappy.out, place: window.__flappy.place })).catch(() => null);
    log.check(o && o.out, 'flappy-out-view', `${p.__name}/${game}`, `after the crash: ${JSON.stringify(o)}`);
  }
  // the finale: 3 left
  const sp = pages[survivors[0]];
  await L.waitFor(() => sp.evaluate(() => window.__flappy && window.__flappy.finaleStage >= 0), 20000, 'finale').catch((e) => log.issue('flappy-finale', game, `${e.message} (active ${host.scores && host.scores.active})`));
  await L.sleep(800);
  await shotAll(all(), `${game}-5a-finale`);
  const alive = [];
  for (const k of survivors) alive.push(await pages[k].evaluate(() => ({ mode: window.__flappy.mode, stage: window.__flappy.finaleStage, banner: window.__flappy.banner, active: window.__flappy.active })).catch(() => null));
  console.log(`  [games] ${game} finale: ${JSON.stringify(alive)} at ${Math.round(elapsed())} ms`);
  await freezeBeat(game);
  // two of the three stop flying, one by one
  for (const k of crashOrder) {
    await flappy(pages[k], () => (window.__flappy.autopilot(false), 'off'));
    await L.waitFor(() => pages[k].evaluate(() => window.__flappy.mode !== 'fly'), 8000, 'crash').catch(() => {});
    await L.sleep(1500);
    await S.sweepShot(pages[k], OUT, `${game}-6-out-in-finale`, log);
  }
  await endBeats(game);
}

let code = null;
let browserRef = null;

(async () => {
  await startServer();
  const browser = await L.launch();
  browserRef = browser;
  const only = process.env.GAMES ? process.env.GAMES.split(',') : ['tap', 'icy', 'flappyA', 'plotzel', 'ninja', 'flappyB', 'tap2'];
  try {
    host = S.createHost();
    hookHost(host);
    code = (await host.call('host:create', {})).code;
    await host.call('host:setAutoCutscenes', { enabled: false });
    console.log(`[games ${S.stamp()}] room ${code}`);
    for (const k of S.ORDER) pages[k] = await S.openProfile(browser, k, log);
    await Promise.all(all().map((p) => L.join(p, code, NAMES[p.__key])));
    await Promise.all(all().map((p) => L.exitFs(p)));
    bots = await S.addPlanBots(code, 14, (i) => BOT_NAMES[i], (game, i) => (game === 'flappy' ? { raw: 5 + i, finalAtMs: 1500 + i * 250 } : { raw: 1 + i, finalAtMs: 1200 + i * 150 }));
    await L.waitFor(() => host.state().players.length === 20, 10000, '20 players');
    await L.sleep(1000);
    await shotAll(all(), '0-lobby-20');

    for (const g of only) {
      console.log(`\n[games ${S.stamp()}] ── ${g} ──`);
      try {
        await ROUNDS[g]();
      } catch (e) {
        log.issue('round-flow', g, e.message);
        await Promise.all(all().map((p) => p.screenshot({ path: path.join(OUT, `${p.__name}-${g}-ERROR.png`) }).catch(() => {})));
        if (phase() === 'playing' || phase() === 'intro' || phase() === 'countdown') await host.call('host:endRound', {}).catch(() => {});
        if (host.state().cutscene) await host.call('host:cutsceneEnd', {}).catch(() => {});
        await L.sleep(3000);
        if (phase() === 'results') await host.call('host:lobby', {}).catch(() => {});
        await L.sleep(2000);
      }
    }
    console.log(`  [games] WIN screens seen: ${JSON.stringify(wins)}`);
    for (const k of S.ORDER) log.check(wins[k] > 0, 'win-not-seen', k, 'this profile never reached the WIN moment in this run');

    // ── final ──
    console.log(`\n[games ${S.stamp()}] ── final ──`);
    await host.call('host:final', {});
    await L.sleep(500);
    if (host.state().cutscene) await host.call('host:cutsceneEnd', {});
    await waitAll(all(), 'final', 10000, 'final');
    await L.sleep(2500);
    await shotAll(all(), 'final-1', { fonts: true });
    // rotate on the final screen
    for (const p of all()) {
      const vp = p.viewportSize();
      p.__vp = vp;
      await L.exitFs(p);
      await p.setViewportSize({ width: vp.height, height: vp.width });
    }
    await L.sleep(800);
    await shotAll(all(), 'final-2-rotated');
    for (const p of all()) {
      const on = await p.evaluate(() => !!document.querySelector('.pp-landscape') && getComputedStyle(document.querySelector('.pp-rotate')).display !== 'none');
      log.check(on, 'rotate-overlay', `${p.__name}/final`, 'landscape without the rotate overlay');
    }
    for (const p of all()) await p.setViewportSize(p.__vp);
    await L.sleep(600);
    // the reconnect banner on every phone
    for (const p of all()) {
      p.__offline = true;
      await p.__ctx.setOffline(true);
    }
    await Promise.all(all().map((p) => L.waitFor(() => p.evaluate(() => window.__player.banner), 30000, 'banner').catch((e) => log.issue('banner', p.__name, e.message))));
    await shotAll(all(), 'final-3-offline-banner');
    for (const p of all()) await p.__ctx.setOffline(false);
    await Promise.all(all().map((p) => L.waitFor(async () => !(await p.evaluate(() => window.__player.banner)), 20000, 'banner gone').catch((e) => log.issue('banner-stuck', p.__name, e.message))));
    for (const p of all()) p.__offline = false;

    // ── the server restarts: the room is gone ──
    console.log(`\n[games ${S.stamp()}] ── server restart ──`);
    for (const p of all()) p.__offline = true;
    bots.close();
    bots = null;
    host.close();
    stopServer();
    await L.sleep(1500);
    await startServer();
    await Promise.all(all().map((p) => L.waitScreen(p, 'closed', 30000).catch((e) => log.issue('closed', p.__name, e.message))));
    await L.sleep(800);
    for (const p of all()) p.__offline = false;
    await shotAll(all(), 'closed-1');
    host = S.createHost();
    hookHost(host);
    code = (await host.call('host:create', {})).code;
    for (const p of all()) {
      await p.locator('.pp-btn').first().tap().catch((e) => log.issue('closed-restart', p.__name, e.message.split('\n')[0]));
    }
    await waitAll(all(), 'join', 8000, 'closed-join');
    await shotAll(all(), 'closed-2-join');
    for (const p of all()) {
      const codeField = await p.locator('.pp-code-input').count();
      log.check(codeField === 1, 'closed-code-field', p.__name, 'after "room closed" there is no code field');
      if (codeField) await p.fill('.pp-code-input', code);
      await p.fill('.pp-name-input', NAMES[p.__key]);
      await p.tap('.pp-btn-go');
    }
    await waitAll(all(), 'lobby', 15000, 'rejoin');
    for (const p of all()) {
      const id = await p.evaluate(() => window.__player.snap.playerId);
      await host.call('host:kick', { playerId: id });
    }
    await waitAll(all(), 'kicked', 8000, 'kicked');
    await L.sleep(600);
    await shotAll(all(), 'kicked');
  } catch (e) {
    log.issue('flow', 'games', e.stack || e.message);
  } finally {
    if (bots) bots.close();
    if (host) host.close();
    await browser.close().catch(() => {});
    stopServer();
    fs.writeFileSync(path.join(OUT, 'server.log'), serverLog);
  }
  process.exit(log.summary() ? 1 : 0);
})();
