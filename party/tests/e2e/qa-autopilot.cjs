// qa-autopilot: the TV carries the show on by itself between rounds (client/src/host/actions.ts
// autopilotStep), and a round has no prize (the owner's calls, 13.11).
//
// One TV (/host?auto=1&bar=0) and two phones play a whole competition on a fast server:
//   - the first game does NOT start by itself; the host's Space starts it
//   - the phone's suspense title "מי זכה בסיבוב?" fits every phone width
//   - the round ceremony (TV and phones) celebrates the round and never mentions the prize
//   - results -> lobby -> next game by itself, with a countdown on the next game's card
//   - P holds the autopilot and lets it go again
//   - after the last game: the podium by itself, the prize there and only there, and it stays there
//   - the TV as the party opens it (not an automated browser): autopilot on, fullscreen on the first click
//   - שימי טאפ: the TV's clock is the phones' clock: it reaches zero when every phone's sprint is over
//   - the music: the lobby song until the first game, the winner's song on the TV only, and it plays
//     on (not restarted) in the lobby between games
//   - flappy: the last one standing gets the bonus on top
//
// Needs a build (npm run build). Starts its own server on PORT (default 8831), or uses BASE_URL.
//   NODE_PATH=<playwright>/node_modules node tests/e2e/qa-autopilot.cjs
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out/qa-autopilot');
const PORT = Number(process.env.PORT || 8831);
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
}
async function waitFor(what, fn, ms = 10000, step = 100) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(step);
  }
  throw new Error(`timeout: ${what} (last: ${JSON.stringify(last)})`);
}
const tvState = (tv) => tv.evaluate(() => { const s = window.__host.state(); return s && { code: s.code, phase: s.phase, game: s.round ? s.round.gameId : null, played: s.played.length, players: s.players.length }; });
const phase = async (tv) => (await tvState(tv)).phase;
const screen = (p) => p.evaluate(() => (window.__player ? window.__player.screen : null));
const waitScreen = (p, name, ms = 15000) => waitFor(`${p.__name} on ${name}`, async () => (await screen(p)) === name, ms, 60);

async function openTv(browser, query, init) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  if (init) await ctx.addInitScript(init);
  const tv = await ctx.newPage();
  tv.on('pageerror', (e) => check(`TV page error: ${e.message.slice(0, 120)}`, false));
  await tv.goto(`${BASE}/host${query}`);
  await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 30000 });
  return tv;
}

async function openPhone(browser, code, name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.__name = name;
  page.on('pageerror', (e) => check(`${name} page error: ${e.message.slice(0, 120)}`, false));
  await page.goto(`${BASE}/?room=${code}`);
  await waitScreen(page, 'join');
  await page.fill('.pp-name-input', name);
  await page.click('.pp-btn-go');
  await waitScreen(page, 'lobby');
  return page;
}

/** The suspense title inside the phone's window at this width (sampled over its throb animation). */
async function titleFit(page, width, height) {
  await page.setViewportSize({ width, height });
  await sleep(120);
  let worst = { left: 1e9, right: -1e9 };
  for (let i = 0; i < 6; i++) {
    const m = await page.evaluate(() => {
      const h = document.querySelector('.ps-susp-title');
      if (!h) return null;
      const boxes = [h, ...h.querySelectorAll('span')].map((e) => e.getBoundingClientRect());
      // each line of text, not the block box: a range over the text nodes
      const r = document.createRange();
      r.selectNodeContents(h);
      for (const b of r.getClientRects()) boxes.push(b);
      return { left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)), w: window.innerWidth, lines: h.querySelectorAll('span').length + 1 };
    });
    if (m === null) return null;
    worst = { left: Math.min(worst.left, m.left), right: Math.max(worst.right, m.right), w: m.w, lines: m.lines };
    await sleep(150);
  }
  return worst;
}

(async () => {
  let server = null;
  if (!process.env.BASE_URL) {
    server = spawn(process.execPath, ['dist/server/index.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '9000' }, stdio: 'ignore' });
    await waitFor('server up', async () => (await fetch(`${BASE}/healthz`).then((r) => r.ok).catch(() => false)), 15000, 200);
  }
  const browser = await chromium.launch();
  try {
    const tv = await openTv(browser, '?auto=1&bar=0');
    const code = (await tvState(tv)).code;
    check('TV: the autopilot is on (?auto=1)', (await tv.evaluate(() => window.__host.autopilot())) === true);
    const A = await openPhone(browser, code, 'דנה');
    const B = await openPhone(browser, code, 'יוסי');

    // ── the first game is the host's press ──
    // (a key first: a browser plays no sound before a gesture; Shift does nothing else on the TV)
    await tv.keyboard.press('Shift');
    const music = () => tv.evaluate(() => ({ cur: window.__hostMusic.current(), victory: window.__partyMusic.info('victory'), lobby: window.__partyMusic.info('lobby'), starts: window.__partyMusic.started.filter((n) => n === 'victory').length }));
    await sleep(11500);
    const m0 = await music();
    const songs = { lobby: m0.lobby !== null && m0.lobby.source === 'file', victory: null };
    if (songs.lobby) check('music: the lobby song in the first lobby', m0.cur !== null && m0.cur.slot === 'lobby', m0.cur);
    else console.log('  (no lobby song in this build: the lobby music check is skipped)');
    check('the first game does not start by itself', (await phase(tv)) === 'lobby' && (await tv.locator('[data-testid=auto-start]').count()) === 0);
    await tv.keyboard.press('Space');
    await waitFor('intro', async () => (await phase(tv)) === 'intro', 5000, 50);
    const introPrize = await tv.textContent('.hs-intro-prize').catch(() => '');
    check('intro: the prize is for the end of the evening', introPrize.includes('הפרס בסוף הערב'), introPrize.trim());

    // ── round 1: דנה taps, יוסי does not ──
    await waitFor('playing', async () => (await phase(tv)) === 'playing', 10000, 50);
    const vp = A.viewportSize();
    // the TV's clock and each phone's game, sampled together until the round is over
    const tapDone = (p) => p.evaluate(() => { const c = document.querySelector('canvas[data-level]'); return c !== null && c.dataset.tapFinal === '1'; }).catch(() => false);
    const tvClock = () => tv.evaluate(() => { const n = document.querySelector('.sh-ring-num'); return n ? n.textContent : null; }).catch(() => null);
    const seen = { tvOverAt: 0, aDoneAt: 0, bDoneAt: 0, tvAtADone: null, tvBeforeOver: null, playStart: Date.now() };
    let stopSampling = false;
    const sampler = (async () => {
      while (!stopSampling) {
        const [clock, a, b] = await Promise.all([tvClock(), tapDone(A), tapDone(B)]);
        const now = Date.now();
        if (clock === 'סוף!' && seen.tvOverAt === 0) seen.tvOverAt = now;
        if (clock !== null && clock !== 'סוף!' && seen.tvOverAt === 0) seen.tvBeforeOver = clock;
        if (a && seen.aDoneAt === 0) { seen.aDoneAt = now; seen.tvAtADone = clock; }
        if (b && seen.bDoneAt === 0) seen.bDoneAt = now;
        await sleep(40);
      }
    })();
    const tapUntil = Date.now() + 8200;
    while (Date.now() < tapUntil && (await phase(tv)) === 'playing') await A.mouse.click(vp.width / 2, vp.height * 0.55).catch(() => undefined);
    await waitFor('results', async () => (await phase(tv)) === 'results', 15000, 50);
    const resultsAt = Date.now();
    stopSampling = true;
    await sampler;
    // (the owner, 13.11: "the tv says 10s remaining but is over") the round is 9 s here: a 7.8 s sprint, 1.2 s of hold
    check('tap: the TV says "סוף!" when the phones are done, not seconds later',
      seen.tvOverAt > 0 && seen.aDoneAt > 0 && seen.bDoneAt > 0 && Math.abs(seen.tvOverAt - seen.aDoneAt) < 500 && Math.abs(seen.tvOverAt - seen.bDoneAt) < 500 && (seen.tvAtADone === 'סוף!' || seen.tvAtADone === '0:01' || seen.tvAtADone === '1'),
      { tvOverAfterMs: seen.tvOverAt - seen.playStart, aDoneAfterMs: seen.aDoneAt - seen.playStart, bDoneAfterMs: seen.bDoneAt - seen.playStart, tvAtADone: seen.tvAtADone, tvBeforeOver: seen.tvBeforeOver });
    check('tap: the round goes on a moment after the clock (the hold for the final frame)', resultsAt - seen.tvOverAt > 600 && resultsAt - seen.tvOverAt < 4000, { holdMs: resultsAt - seen.tvOverAt });

    // ── the suspense title fits every phone ──
    await waitScreen(B, 'suspense', 8000);
    // the phone went fullscreen on its first tap: a fullscreen window cannot be resized
    await B.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined)).catch(() => undefined);
    await sleep(250);
    for (const [w, h] of [[320, 568], [360, 740], [375, 667], [390, 844], [414, 896], [430, 932]]) {
      const m = await titleFit(B, w, h);
      check(`suspense title fits a ${w}px phone`, m !== null && m.left >= -0.5 && m.right <= m.w + 0.5 && m.lines === 2, m);
      if (w === 320 || w === 390) await B.screenshot({ path: path.join(OUT, `suspense-${w}.png`) });
    }
    await B.setViewportSize({ width: 390, height: 844 });

    // ── the round ceremony: the round, never the prize ──
    await waitFor('TV ceremony', async () => (await tv.locator('.sh-cer-name').count()) > 0, 15000, 50);
    const cer = await tv.evaluate(() => ({ name: document.querySelector('.sh-cer-name').textContent, line: document.querySelector('.sh-cer-line').textContent, prize: document.querySelectorAll('.sh-cer .sh-prize').length, medal: document.querySelectorAll('.sh-cer .sh-medal').length, all: document.querySelector('.sh-cer').textContent }));
    check('TV ceremony: the round winner with a medal, no prize', cer.name.includes('דנה') && cer.line.includes('ניצחון בסיבוב') && cer.prize === 0 && cer.medal === 1 && !/אנג׳ל|מלאך/.test(cer.all), cer);
    await waitScreen(A, 'win', 6000);
    // the winner's song: on the TV, and on no phone (the owner, 13.11: the trumpets on the TV only)
    const m1 = await waitFor('the TV starts the song', async () => { const m = await music(); return m.starts > 0 ? m : null; }, 3000, 100).catch(() => null);
    songs.victory = m1 !== null && m1.victory !== null && m1.victory.source === 'file';
    songs.starts = m1 !== null ? m1.starts : 0;
    const phoneSong = await A.evaluate(() => (window.__partyMusic ? window.__partyMusic.started.length : 0));
    check("music: the winner's song is on the TV and not on the winner's phone", m1 !== null && phoneSong === 0, { tv: m1 && m1.starts, phone: phoneSong });
    const win = await A.textContent('.pp-win');
    check("winner's phone: the round is theirs, no prize", win.includes('ניצחת') && win.includes('הסיבוב הזה שלך') && win.includes('רק בסוף') && !/אנג׳ל|לקחת את הפרס/.test(win) && (await A.locator('.pp-win .pp-prize').count()) === 0, win.slice(0, 90));
    await waitScreen(B, 'reveal', 6000);
    const rev = await B.textContent('.pp-reveal');
    check("the other phone: who took the round, no prize", rev.includes('הסיבוב הולך ל') && rev.includes('דנה') && !/אנג׳ל|הפרס/.test(rev) && (await B.locator('.pp-reveal .pp-prize').count()) === 0, rev.slice(0, 90));
    await sleep(1500);
    await tv.screenshot({ path: path.join(OUT, 'tv-ceremony.png') });
    await A.screenshot({ path: path.join(OUT, 'phone-win.png') });
    await B.screenshot({ path: path.join(OUT, 'phone-reveal.png') });

    // ── the standings, then the lobby by itself ──
    await waitFor('standings banner', async () => (await tv.locator('.sh-banner-text').count()) > 0, 20000, 100);
    const banner = await tv.textContent('.sh-banner');
    check('standings banner: the round is theirs, no prize', banner.includes('הסיבוב של') && banner.includes('דנה') && !/אנג׳ל|מלאך/.test(banner), banner.trim());
    await sleep(2500);
    await tv.screenshot({ path: path.join(OUT, 'tv-standings.png') });
    await waitFor('lobby by itself', async () => (await phase(tv)) === 'lobby', 30000, 100);
    const toLobby = Date.now() - resultsAt;
    // 8 s suspense + 10.6 s ceremony + 9 s standings
    check('results -> lobby by itself, after the ceremony and the standings', toLobby > 24000 && toLobby < 34000, { ms: toLobby });
    // between games the winner's song plays on: the same track, not restarted, a step quieter; no lobby song
    if (songs.victory) {
      await sleep(900);
      const m2 = await music();
      check("music: between games the winner's song plays on (no restart, no lobby song)",
        m2.cur !== null && m2.cur.slot === 'victory' && m2.cur.key === 'between' && m2.victory !== null && m2.victory.playing && m2.starts === songs.starts && m2.victory.time > 15 && m2.victory.volume < 0.6 && (m2.lobby === null || !m2.lobby.playing),
        { cur: m2.cur, time: m2.victory && Math.round(m2.victory.time), volume: m2.victory && m2.victory.volume, starts: m2.starts, lobby: m2.lobby && m2.lobby.playing });
    } else console.log('  (no victory song in this build: the between-games music check is skipped)');
    const count = await waitFor('countdown on the next game', async () => (await tv.locator('[data-testid=auto-start]').count()) > 0 && (await tv.textContent('[data-testid=auto-start]')), 4000, 100);
    check('the lobby counts down to the next game', /מתחילים/.test(count), count.trim());
    await tv.screenshot({ path: path.join(OUT, 'tv-recap-countdown.png') });

    // ── P holds it, P lets it go ──
    await tv.keyboard.press('KeyP');
    await waitFor('autopilot off', async () => (await tv.evaluate(() => window.__host.autopilot())) === false, 3000, 50);
    const toast = await tv.textContent('.hs-toast').catch(() => '');
    check('P: the autopilot is off and the TV says so', toast.includes('כבוי'), toast.trim());
    await tv.screenshot({ path: path.join(OUT, 'tv-autopilot-off.png') });
    await sleep(12500);
    check('held: the next game does not start', (await phase(tv)) === 'lobby' && (await tv.locator('[data-testid=auto-start]').count()) === 0);
    await tv.keyboard.press('KeyP');
    await waitFor('autopilot on', async () => (await tv.evaluate(() => window.__host.autopilot())) === true, 3000, 50);
    await waitFor('the next game starts by itself', async () => ['intro', 'countdown', 'playing'].includes(await phase(tv)), 6000, 100);
    check('P again: the next game starts by itself', (await tvState(tv)).game === 'icy');
    if (songs.victory) {
      await sleep(1500);
      const m3 = await music();
      check("music: the next game's own song takes over", m3.cur !== null && m3.cur.slot !== 'victory' && (m3.victory === null || !m3.victory.playing), { cur: m3.cur, victory: m3.victory && m3.victory.playing });
    }

    // ── the rest of the evening by itself (nobody plays: the nobody-won path) ──
    let nobodySeen = false;
    let flappySeen = false;
    let lastPhase = '';
    const end = Date.now() + 420000;
    for (;;) {
      const s = await tvState(tv);
      if (s.phase !== lastPhase) {
        console.log(`  ${new Date().toISOString().slice(11, 19)} ${s.phase} ${s.game || ''} played=${s.played}`);
        lastPhase = s.phase;
      }
      if (s.phase === 'final') break;
      // flappy: both phones fall at the first stand; whoever fell last outlasted the other
      if (!flappySeen && s.phase === 'results') {
        const rows = await tv.evaluate(() => { const r = window.__host.state().results; return r && r.gameId === 'flappy' ? r.rows.map((x) => ({ name: x.name, raw: x.raw, points: x.points, roundRank: x.roundRank })) : null; });
        if (rows !== null) {
          flappySeen = true;
          const by = [...rows].sort((x, y) => x.roundRank - y.roundRank);
          const scorers = by.filter((x) => x.raw > 0);
          if (scorers.length >= 2) check('flappy: the last one standing gets 300 on top (1000 + 100 + 300), the other scores as always', scorers[0].points >= 1398 && scorers[0].points <= 1400 && scorers[1].points <= 1060, by);
          else console.log(`  (flappy had ${scorers.length} scorer(s): the bonus needs two)`, JSON.stringify(by));
        }
      }
      if (!nobodySeen && s.phase === 'results' && (await tv.locator('.sh-cer--nobody').count()) > 0) {
        await sleep(2600);
        const t = await tv.textContent('.sh-cer--nobody').catch(() => '');
        if (t) {
          nobodySeen = true;
          check('nobody scored: no prize talk', t.includes('אף אחד לא זכה') && !/אנג׳ל|מלאך/.test(t), t.trim());
          await tv.screenshot({ path: path.join(OUT, 'tv-nobody.png') });
        }
      }
      if (Date.now() > end) throw new Error(`the evening did not reach the podium (stuck in ${s.phase} ${s.game || ''})`);
      await sleep(250);
    }
    check('five games and the podium, by itself', (await tvState(tv)).played === 5);
    check('the nobody-won ceremony was seen', nobodySeen);

    // ── the podium: the prize, here and only here; and it stays ──
    await waitFor('champion on the TV', async () => (await tv.locator('.sh-champ-kicker').count()) > 0, 40000, 200);
    const kicker = await tv.textContent('.sh-champ-kicker');
    check('podium: the champion wins the angel', kicker.includes('זוכה בשימי אנג׳ל'), kicker.trim());
    await waitScreen(A, 'final', 10000);
    const fin = await A.textContent('.pp-final');
    check("champion's phone: you won the angel", fin.includes('זכית בשימי אנג׳ל'), fin.slice(0, 80));
    const finB = await B.textContent('.pp-final');
    check("the other phone: no angel", !/אנג׳ל/.test(finB));
    await sleep(1200);
    await tv.screenshot({ path: path.join(OUT, 'tv-final.png') });
    await A.screenshot({ path: path.join(OUT, 'phone-final-champion.png') });
    await sleep(13000);
    check('the podium stays (no reset by itself)', (await phase(tv)) === 'final');

    // ── the TV as the party opens it: no ?auto, not an automated browser ──
    const party = await openTv(browser, '', () => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    });
    const p0 = await party.evaluate(() => ({ auto: window.__host.autopilot(), fs: document.fullscreenElement !== null, strip: getComputedStyle(document.querySelector('[data-testid=strip]')).visibility }));
    check('party TV: autopilot on by default, no strip, not yet fullscreen', p0.auto === true && p0.fs === false && p0.strip === 'hidden', p0);
    await party.mouse.click(600, 300);
    const fsOn = await waitFor('fullscreen', async () => party.evaluate(() => document.fullscreenElement !== null), 4000, 100).catch(() => false);
    check('party TV: the first click goes fullscreen', fsOn === true);
    await party.evaluate(() => document.exitFullscreen().catch(() => undefined));
    await sleep(400);
    await party.mouse.click(600, 300);
    await sleep(600);
    check('party TV: only the first click (Esc stays out of fullscreen)', (await party.evaluate(() => document.fullscreenElement !== null)) === false);
    const off = await openTv(browser, '?auto=0&fs=0', () => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    });
    await off.mouse.click(600, 300);
    await sleep(600);
    const o = await off.evaluate(() => ({ auto: window.__host.autopilot(), fs: document.fullscreenElement !== null }));
    check('?auto=0&fs=0: neither', o.auto === false && o.fs === false, o);
  } catch (e) {
    check(`run: ${e.message.slice(0, 300)}`, false);
  } finally {
    await browser.close().catch(() => undefined);
    if (server !== null) server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
})();
