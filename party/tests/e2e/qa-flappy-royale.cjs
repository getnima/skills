// qa-flappy-royale: flappy as an elimination round ("last one standing"), end to end.
// The TV page, 4 real phone pages and 8 load bots play one flappy round on a real server:
//   phone-1 (390x844)  plays well (the game's own pilot through window.__flappy.autopilot) and wins
//   phone-2 (320x568)  plays well, is reloaded while flying, and stops tapping 7 s into the finale
//   phone-3 (390x844)  stops tapping after 5 s (out early)
//   phone-4 (320x568)  never taps (falls, out), and is reloaded while out
//   8 bots             out one by one by 34 s of round time (--elim-by)
// with a manual cutscene before the finale and another one during it.
//
//   PARTY_SERVER_PORT=8921 npx tsx server/index.ts            (real timing: no PARTY_TEST_* needed)
//   PARTY_SERVER_PORT=8921 PARTY_CLIENT_PORT=5331 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/qa-flappy-royale.cjs
// Env: SERVER_URL (default http://localhost:8921), CLIENT_URL (default http://localhost:5331).
// Screenshots: tests/e2e/out/qa-flappy-royale/ (look at them).
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SERVER = process.env.SERVER_URL || 'http://localhost:8921';
const CLIENT = process.env.CLIENT_URL || 'http://localhost:5331';
const OUT = path.join(__dirname, 'out', 'qa-flappy-royale');
fs.mkdirSync(OUT, { recursive: true });
const REMOTE_PASSWORD = process.env.PARTY_REMOTE_PASSWORD || 'kioso3tbh';
const STEP_MS = 1000 / 60;

const failures = [];
let passed = 0;
function check(ok, msg, extra) {
  if (ok) {
    passed++;
    console.log('  ok  ', msg);
  } else {
    failures.push(msg + (extra !== undefined ? ' ' + JSON.stringify(extra) : ''));
    console.log('  FAIL', msg, extra !== undefined ? JSON.stringify(extra) : '');
  }
  return !!ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label, every = 40) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(every);
  }
}

const pageErrors = [];
function watch(page, name) {
  page.on('pageerror', (e) => pageErrors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/\/cutscenes\/[\w-]+\.(mp4|webm)/.test(m.location().url || '') || /cutscenes/.test(m.text())) return;
    pageErrors.push(`${name} console: ${m.text()} @ ${m.location().url || ''}`);
  });
}

/** What a phone shows, in one read. */
const PHONE = () => {
  const p = window.__player;
  const pl = window.__playerPlay;
  const f = window.__flappy;
  const r = p && p.snap.state ? p.snap.state.round : null;
  return {
    screen: p ? p.screen : null,
    phase: p && p.snap.state ? p.snap.state.phase : null,
    id: p ? p.snap.playerId : null,
    now: p ? p.now() : 0,
    frozen: pl ? pl.frozen : null,
    leftMs: pl ? pl.leftMs : null,
    active: pl ? pl.active : null,
    outIds: pl ? pl.out : [],
    meOut: pl ? pl.meOut : null,
    place: pl ? pl.place : null,
    finale: r ? r.finale : null,
    f: f
      ? {
          mode: f.mode,
          run: f.run,
          raw: f.raw,
          steps: f.steps,
          clockStep: f.clockStep,
          dist: f.dist,
          active: f.active,
          place: f.place,
          won: f.won,
          grace: f.grace,
          rejoins: f.rejoins,
          finaleStep: f.finaleStep,
          finaleStage: f.finaleStage,
          finaleInMs: f.finaleInMs,
          banner: f.banner,
          countdown: f.countdown,
          out: f.out,
          speed: f.speed,
        }
      : null,
  };
};
const info = (ph) => ph.page.evaluate(PHONE);

/** In-page stamp (epoch ms) of the first frame on which the finale banner is visible. */
const WATCH_FINALE_PHONE = () => {
  window.__finaleSeen = null;
  const tick = () => {
    const f = window.__flappy;
    if (f && window.__finaleSeen === null) {
      const on = f.mode === 'fly' ? f.countdown !== '' : f.out !== null && f.out.finale !== '';
      if (on) window.__finaleSeen = { at: Date.now(), text: f.mode === 'fly' ? f.countdown : `${f.out.finale} ${f.out.count}`, inMs: f.finaleInMs };
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const WATCH_FINALE_TV = () => {
  window.__finaleSeen = null;
  const tick = () => {
    const box = document.querySelector('.sh-finale');
    if (box && box.classList.contains('is-on') && window.__finaleSeen === null) window.__finaleSeen = { at: Date.now(), text: box.textContent };
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

(async () => {
  const browser = await chromium.launch();
  let bots = null;
  const remote = io(SERVER, { transports: ['websocket'], forceNew: true });
  const call = (ev, req) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ack timeout ' + ev)), 6000);
      remote.emit(ev, req, (res) => {
        clearTimeout(t);
        resolve(res);
      });
    });
  try {
    // ── the TV ──
    const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const host = await hostCtx.newPage();
    watch(host, 'tv');
    await host.goto(`${CLIENT}/host.html`);
    await host.waitForFunction(() => window.__host && window.__host.state() !== null, null, { timeout: 20000 });
    const hs = () => host.evaluate(() => window.__host.state());
    const code = (await hs()).code;
    await host.mouse.click(960, 60);
    console.log('[royale] room', code);

    // the test's own remote control (what the owner's phone would be)
    const att = await call('remote:attach', { password: REMOTE_PASSWORD, code });
    check(att.ok === true, 'control socket attached to the room', att.ok ? undefined : att);
    await call('host:setAutoCutscenes', { enabled: false });

    // ── four phones ──
    const spec = [
      { label: 'p1-390', name: 'דנה', vp: { width: 390, height: 844 } },
      { label: 'p2-320', name: 'יוסי', vp: { width: 320, height: 568 } },
      { label: 'p3-390', name: 'מיכל', vp: { width: 390, height: 844 } },
      { label: 'p4-320', name: 'אבי', vp: { width: 320, height: 568 } },
    ];
    const phones = [];
    for (const s of spec) {
      const ctx = await browser.newContext({ viewport: s.vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      watch(page, s.label);
      const ph = { page, label: s.label, name: s.name, vp: s.vp };
      phones.push(ph);
      await page.goto(`${CLIENT}/?room=${code}`);
      await waitFor(async () => (await info(ph)).screen === 'join', 20000, `${s.label} join screen`);
      await page.fill('.pp-name-input', s.name);
      await page.locator('.pp-btn-go').tap();
      await waitFor(async () => (await info(ph)).screen === 'lobby', 15000, `${s.label} lobby`);
      ph.id = (await info(ph)).id;
    }
    const [P1, P2, P3, P4] = phones;
    const shot = (ph, name) => ph.page.screenshot({ path: path.join(OUT, `${name}-${ph.vp.width}.png`) });
    const tvShot = (name) => host.screenshot({ path: path.join(OUT, `${name}-tv.png`) });

    // ── eight bots ──
    bots = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', '8', '--play', '--elim-by', '34000', '--quiet'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let botLog = '';
    bots.stdout.on('data', (d) => (botLog += d));
    bots.stderr.on('data', (d) => (botLog += d));
    await waitFor(async () => (await hs()).players.length === 12, 30000, '12 players in the room').catch((e) => {
      console.log(botLog);
      throw e;
    });
    check(true, 'the TV sees 4 phones + 8 bots');

    // ── start flappy ──
    const started = await call('host:start', { gameId: 'flappy' });
    check(started.ok === true, 'host:start flappy');
    await waitFor(async () => (await hs()).phase === 'intro', 5000, 'intro');
    await sleep(1500);
    await tvShot('01-intro');
    const introText = await host.textContent('[data-testid=intro]');
    check(/האחרון שנשאר באוויר מנצח/.test(introText), 'the TV intro shows the new instructions', introText.slice(0, 80));
    await shot(P1, '01-intro');

    // the games are mounted during the countdown; the pilots are armed before GO
    await Promise.all(phones.map((ph) => waitFor(async () => (await info(ph)).f !== null, 20000, `${ph.label} game mounted`)));
    await P1.page.evaluate(() => window.__flappy.autopilot(true));
    await P2.page.evaluate(() => window.__flappy.autopilot(true));
    await P3.page.evaluate(() => window.__flappy.autopilot(true, 300));
    for (const ph of phones) await ph.page.evaluate(WATCH_FINALE_PHONE);
    await host.evaluate(WATCH_FINALE_TV);
    await Promise.all([shot(P1, '02-start'), shot(P2, '02-start')]);

    await waitFor(async () => (await hs()).phase === 'playing', 15000, 'playing');
    const round0 = (await hs()).round;
    check(round0.gameId === 'flappy' && round0.finale === null && round0.endAt - round0.startAt === 90000, 'the round is flappy, 90 s cap, no finale yet', round0);

    // ── everyone starts together: the same step of the same course at the same time ──
    await waitFor(async () => (await info(P1)).f.steps > 60, 8000, 'flying');
    const together = await Promise.all(phones.map(info));
    const now0 = together[0].now;
    // steps are round time: put every phone's reading on one clock
    const at = together.map((t) => t.f.clockStep - (t.now - now0) / STEP_MS);
    check(Math.max(...at) - Math.min(...at) < 6, 'all four phones are at the same step of round time (within 100 ms of clock sync)', at.map((x) => Math.round(x)));
    const courses = await Promise.all(phones.map((ph) => ph.page.evaluate(() => JSON.stringify(window.__flappy.course(30)))));
    check(courses.every((c) => c === courses[0]), 'the same course on every phone (30 obstacles, 390x844 and 320x568)');
    check(together.every((t) => t.active === 12 || t.active === 11), 'every phone knows how many are in the air at GO', together.map((t) => t.active));

    // ── phone-4 never taps: falls and is out ──
    const p4dead = await waitFor(async () => { const i = await info(P4); return i.f && i.f.mode !== 'fly' ? i : null; }, 8000, 'p4 falls', 25);
    await shot(P4, '03-crash');
    check(p4dead.f.run === 0 && p4dead.f.raw > 0 && p4dead.f.raw < 1000, 'the guest who never taps falls before the first obstacle and is out', { run: p4dead.f.run, raw: p4dead.f.raw });
    const p4out = await waitFor(async () => { const i = await info(P4); return i.f && i.f.mode === 'out' && i.f.out && i.outIds.includes(P4.id) ? i : null; }, 6000, 'p4 spectator');
    check(/נפלת/.test(p4out.f.out.verdict) && /מקום 1[12] מתוך 12/.test(p4out.f.out.place), 'out phone shows "!נפלת" and its place', p4out.f.out);
    check(Number(p4out.f.out.air) >= 9 && p4out.f.out.names.length > 0, 'out phone shows how many are still in the air and who', { air: p4out.f.out.air, names: p4out.f.out.names });
    await sleep(500);
    await Promise.all([shot(P4, '04-spectator'), tvShot('03-race')]);
    await shot(P1, '03-midair');
    await shot(P2, '03-midair');

    // ── phone-3 stops tapping after 5 s ──
    const p3dead = await waitFor(async () => { const i = await info(P3); return i.f && i.f.mode === 'dead' ? i : null; }, 15000, 'p3 crashes', 20);
    await shot(P3, '03-crash');
    check(p3dead.f.place !== null && p3dead.f.place >= 8 && p3dead.f.place <= 11, 'a crash shows the place at once (behind everyone still flying)', p3dead.f.place);
    const p3out = await waitFor(async () => { const i = await info(P3); return i.f && i.f.mode === 'out' && i.outIds.includes(P3.id) ? i : null; }, 6000, 'p3 spectator');
    await sleep(400);
    await shot(P3, '04-spectator');
    const tvOut = await host.evaluate(() => ({ marks: document.querySelectorAll('[data-testid=race-card] .pc-mark--out').length, outRows: document.querySelectorAll('[data-testid=race-card].is-out').length, left: document.querySelector('.sh-left')?.getAttribute('data-left') }));
    check(tvOut.outRows >= 2 && tvOut.marks >= 2, 'the TV greys out the cards of who is out, with a "בחוץ" stamp', tvOut);
    check(Number(tvOut.left) === (await info(P1)).active, 'the TV counter "נשארו N" is the active count', tvOut);
    check(p3out.place !== null, 'the HUD of an out phone shows its place', p3out.place);
    check((await info(P1)).place === null, 'the HUD of a flying phone shows no place (everybody flies side by side)');

    // ── cutscene 1, before the finale ──
    const before1 = await Promise.all([info(P1), info(P2)]);
    check(before1.every((i) => i.f.mode === 'fly' && i.finale === null), 'two phones flying, no finale yet');
    await call('host:cutscene', { id: 'joker_1' });
    await waitFor(async () => (await info(P1)).frozen === true && (await info(P2)).frozen === true, 4000, 'frozen');
    await sleep(300);
    const fz1 = await Promise.all([info(P1), info(P2)]);
    await sleep(1500);
    const fz2 = await Promise.all([info(P1), info(P2)]);
    check(fz1.every((a, k) => a.f.steps === fz2[k].f.steps && a.f.raw === fz2[k].f.raw && a.leftMs === fz2[k].leftMs), 'cutscene before the finale: the flight stands still (steps, score, clock)', fz1.map((a, k) => [a.f.steps, fz2[k].f.steps]));
    check(Math.abs(fz1[0].f.steps - fz1[1].f.steps) <= 2 && Math.abs(fz1[0].leftMs - fz1[1].leftMs) < 1, 'both flying phones froze at the same point of round time', fz1.map((a) => [a.f.steps, a.leftMs]));
    await tvShot('05-cutscene');
    await call('host:cutsceneEnd', {});
    await waitFor(async () => (await info(P1)).frozen === false && (await info(P2)).frozen === false, 8000, 'resumed');
    const rs = await Promise.all([info(P1), info(P2)]);
    check(rs.every((a, k) => a.f.mode === 'fly' && a.f.steps >= fz2[k].f.steps && a.f.steps - fz2[k].f.steps < 40 && a.f.rejoins === 0), 'it continues exactly where it stopped (no jump, no rejoin)', rs.map((a, k) => a.f.steps - fz2[k].f.steps));

    // ── reloads: an out phone stays out, a flying phone keeps flying ──
    await P4.page.reload();
    const p4back = await waitFor(async () => { const i = await info(P4); return i.f ? i : null; }, 15000, 'p4 back');
    await sleep(600);
    const p4after = await info(P4);
    check(p4back.f.mode === 'out' && p4after.f.mode === 'out' && p4after.meOut === true, 'a reload of an out phone comes back OUT (no second life)', { mode: p4after.f.mode });
    check(p4after.f.raw === p4dead.f.raw || Math.abs(p4after.f.raw - p4dead.f.raw) < 60, 'with the score it had', { before: p4dead.f.raw, after: p4after.f.raw });
    await P4.page.evaluate(WATCH_FINALE_PHONE);
    for (let i = 0; i < 6; i++) await P4.page.touchscreen.tap(160, 300);
    check((await info(P4)).f.mode === 'out', 'tapping an out phone does nothing');

    const p2before = await info(P2);
    await P2.page.reload();
    const p2back = await waitFor(async () => { const i = await info(P2); return i.f && i.f.rejoins === 1 && i.f.clockStep > 0 ? i : null; }, 15000, 'p2 back', 15);
    await P2.page.evaluate(() => window.__flappy.autopilot(true));
    await P2.page.evaluate(WATCH_FINALE_PHONE);
    check(p2back.f.mode === 'fly' && p2back.meOut === false, 'a reload of a flying phone keeps flying', { mode: p2back.f.mode });
    check(p2back.f.raw > p2before.f.raw && Math.abs(p2back.f.steps - p2back.f.clockStep) <= 3 && p2back.f.steps - p2before.f.steps > 12, 'from the live point of the course (the round clock), not from where it left', { before: p2before.f.steps, after: p2back.f.steps, clock: p2back.f.clockStep });
    await sleep(1200);
    const p2on = await info(P2);
    check(p2on.f.mode === 'fly' && p2on.f.grace === false, 'the rejoin grace is over within a second and the bird flies on', { mode: p2on.f.mode, grace: p2on.f.grace });
    const p1same = await Promise.all([info(P1), info(P2)]);
    check(Math.abs(p1same[0].f.dist - p1same[1].f.dist) < 12, 'both flying phones are at the same distance again', p1same.map((i) => Math.round(i.f.dist)));

    check((await hs()).round.finale === null, 'the reloads were over before the finale was announced (else this run measured nothing: run it again)');
    // ── the finale: 3 left ──
    const fin = await waitFor(async () => { const s = await hs(); return s.round && s.round.finale ? s : null; }, 40000, 'finale announced', 20);
    const finale = fin.round.finale;
    console.log('[royale] finale at', finale.atElapsedMs, 'ms of round time');
    await sleep(700);
    await Promise.all([shot(P1, '06-finale-banner'), shot(P2, '06-finale-banner'), shot(P3, '06-finale-banner'), shot(P4, '06-finale-banner'), tvShot('06-finale-banner')]);
    const seen = await waitFor(async () => {
      const all = await Promise.all([...phones.map((ph) => ph.page.evaluate(() => window.__finaleSeen)), host.evaluate(() => window.__finaleSeen)]);
      return all.every((x) => x !== null) ? all : null;
    }, 6000, 'banner on every screen');
    // the phones' idea of the server clock (the server runs on this machine: the truth is Date.now())
    const clockErr = await Promise.all(phones.map((ph) => ph.page.evaluate(() => Math.round(window.__player.now() - Date.now()))));
    console.log('[royale] clock error per phone (ms):', clockErr.join(', '));
    const stamps = seen.map((x) => x.at);
    const spread = Math.max(...stamps) - Math.min(...stamps);
    check(spread <= 400, `the finale banner appears on the 4 phones and the TV within 400 ms of each other (spread ${spread} ms)`, { texts: seen.map((x) => x.text), ms: stamps.map((t) => t - Math.min(...stamps)) });
    check(seen.every((x) => /נשארו 3/.test(x.text)), 'it says "!נשארו 3" (the real number) with the 3-2-1', seen.map((x) => x.text));
    check(/[123]/.test(seen[0].text.replace('נשארו 3', '')) && /[123]/.test(seen[4].text.replace('נשארו 3', '')), 'a 3-2-1 digit is on the flying phone and on the TV', [seen[0].text, seen[4].text]);
    const steps = await Promise.all([info(P1), info(P2)]);
    const wantStep = Math.ceil(finale.atElapsedMs / STEP_MS - 1e-6);
    check(steps.every((i) => i.f.finaleStep === wantStep), 'both flying phones harden the course at the same step of round time', { want: wantStep, got: steps.map((i) => i.f.finaleStep) });
    const hard = await Promise.all([P1, P2].map((ph) => ph.page.evaluate((k) => JSON.stringify({ course: window.__flappy.course(160), d: [k, k + 300, k + 900].map((s) => window.__flappy.distAt(s)) }), wantStep)));
    check(hard[0] === hard[1], 'the same finale course and scroll on 390x844 and 320x568 (160 obstacles, distance at 3 moments)');

    // ── the finale begins; cutscene 2 during it ──
    await waitFor(async () => (await info(P1)).f.finaleStage >= 0, 8000, 'finale begins', 20);
    await sleep(1200);
    await Promise.all([shot(P1, '07-finale'), shot(P2, '07-finale'), tvShot('07-finale')]);
    await call('host:cutscene', { id: 'joker_2' });
    await waitFor(async () => (await info(P1)).frozen === true && (await info(P2)).frozen === true, 4000, 'frozen 2');
    await sleep(300);
    const g1 = await Promise.all([info(P1), info(P2), info(P3)]);
    await sleep(1500);
    const g2 = await Promise.all([info(P1), info(P2), info(P3)]);
    check(g1[0].f.steps === g2[0].f.steps && g1[1].f.steps === g2[1].f.steps && Math.abs(g1[0].f.finaleInMs - g2[0].f.finaleInMs) < 1 && Math.abs(g1[2].f.finaleInMs - g2[2].f.finaleInMs) < 1, 'cutscene during the finale: the flight and the finale clock stand still', { steps: [g1[0].f.steps, g2[0].f.steps], inMs: [g1[0].f.finaleInMs, g2[0].f.finaleInMs] });
    check((await hs()).round.finale.atElapsedMs === finale.atElapsedMs, 'the finale time did not move');
    await call('host:cutsceneEnd', {});
    await waitFor(async () => (await info(P1)).frozen === false && (await info(P2)).frozen === false, 8000, 'resumed 2');
    const g3 = await Promise.all([info(P1), info(P2)]);
    check(g3.every((a, k) => a.f.steps >= g2[k].f.steps && a.f.steps - g2[k].f.steps < 40 && a.f.finaleStep === wantStep), 'and continue exactly where they stopped, on the same finale', g3.map((a, k) => a.f.steps - g2[k].f.steps));

    // ── phone-2 lets go 7 s into the finale; phone-1 is the last one standing ──
    await P2.page.evaluate((s) => window.__flappy.autopilot(true, s), wantStep + 7 * 60);
    const p2dead = await waitFor(async () => { const i = await info(P2); return i.f && i.f.mode !== 'fly' ? i : null; }, 30000, 'p2 crashes', 20);
    const tDead = Date.now();
    check(p2dead.f.place === 2 || p2dead.f.place === 3, 'the second-to-last crash shows place 2 (or 3 while a bot is still up)', p2dead.f.place);
    // the victory lap is 1.5 s: read the flying phone and an out phone at the same time
    const [p1won, spect] = await Promise.all([
      waitFor(async () => { const i = await info(P1); return i.f && i.f.won ? i : null; }, 6000, 'p1 last one flying', 15).catch(() => null),
      waitFor(async () => { const i = await info(P3); return i.f && i.f.out && i.f.out.winner !== '' ? i : null; }, 6000, 'p3 sees the winner', 15).catch(() => null),
    ]);
    check(p1won !== null && p1won.f.banner === 'ניצחת!', 'the last one flying is told "!ניצחת" while it flies its victory lap', p1won ? p1won.f.banner : null);
    await Promise.all([shot(P1, '08-last-one-flying'), shot(P2, '08-winner-name'), shot(P3, '08-winner-name'), tvShot('08-last-one')]);
    check(spect !== null && /דנה/.test(spect.f.out.winner), 'the out phones show the winner\'s name', spect ? spect.f.out : null);
    await waitFor(async () => (await hs()).phase === 'results', 20000, 'results', 20);
    const endedAfter = Date.now() - tDead;
    const sNow = await hs();
    const res = sNow.results;
    // the round ends 1.5 s after the server learns that one is left (the last bot may have gone after phone-2)
    check(endedAfter > 1000 && endedAfter < 7000, `the round ends about 1.5 s after one is left (${endedAfter} ms after phone-2's crash)`);
    check(res.winnerIds.length === 1 && res.winnerIds[0] === P1.id, 'the results: the last one standing (phone-1) is the single winner', res.winnerIds);
    const byRound = [...res.rows].sort((a, b) => a.roundRank - b.roundRank);
    check(byRound.every((r, k) => r.roundRank === k + 1 && (k === 0 || r.raw < byRound[k - 1].raw)), 'the others follow in elimination order: 12 places, strictly decreasing survival', byRound.map((r) => [r.name, r.raw]));
    const rankOf = (id) => byRound.findIndex((r) => r.playerId === id) + 1;
    check(rankOf(P4.id) >= 11 && rankOf(P3.id) >= 8 && rankOf(P3.id) < rankOf(P4.id) && rankOf(P2.id) <= 3, 'phone-4 (never tapped) is at the bottom, phone-3 above it, phone-2 in the top 3', [rankOf(P1.id), rankOf(P2.id), rankOf(P3.id), rankOf(P4.id)]);
    const roundMs = sNow.serverNow - round0.startAt;
    console.log(`[royale] the round took ${(roundMs / 1000).toFixed(1)} s of wall time (2 cutscenes included)`);
    await sleep(1500);
    await Promise.all([tvShot('09-results'), shot(P1, '09-results'), shot(P2, '09-results')]);
    // the winner ceremony
    await waitFor(async () => (await host.locator('.sh-cer-name').count()) > 0, 20000, 'winner ceremony on the TV').catch(() => check(false, 'winner ceremony on the TV'));
    const cer = await host.textContent('.sh-cer-name').catch(() => '');
    check(/דנה/.test(cer), 'the TV ceremony names the last one standing', cer);
    await sleep(600);
    await Promise.all([tvShot('10-winner'), shot(P1, '10-winner'), shot(P2, '10-winner')]);

    check(pageErrors.length === 0, 'no page error / console error on the TV and the phones', pageErrors.slice(0, 5));
  } catch (err) {
    failures.push(`crashed: ${err && err.stack ? err.stack : err}`);
    console.log('  FAIL', err && err.stack ? err.stack : err);
  } finally {
    if (bots) bots.kill('SIGTERM');
    remote.close();
    await browser.close();
  }
  console.log(failures.length ? `\n[qa-flappy-royale] FAILED ${failures.length} (passed ${passed}):\n - ${failures.join('\n - ')}` : `\n[qa-flappy-royale] ALL OK (${passed} checks)`);
  process.exit(failures.length ? 1 : 0);
})();
