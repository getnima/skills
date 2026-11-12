// No ties, anywhere: a TV page + 4 real phone pages whose scores are scripted to be EQUAL.
//
//   PARTY_SERVER_PORT=8871 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8871 PARTY_CLIENT_PORT=5271 npx vite
//   node tests/e2e/qa-ties.cjs            (BASE_URL / SERVER_URL override the defaults)
//
// Every phone is a real page; next to each one a raw socket attached to the SAME player
// (same playerId + secret) sends that player's score, so the raw scores are exact:
//   round 1 (flappy): all four end on 6, a moment apart       → one winner, 4 different points
//   round 2 (ninja):  two on 40 (one got there first), 25, 0  → one winner, "⏱" on the ceremony
// Asserts one winner on the TV ceremony, exactly one phone on the WIN moment, distinct points,
// ranks 1..n on the TV standings, the podium and the phones. Screenshots: tests/e2e/out/qa-ties/.
const { chromium, devices } = require('playwright');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'http://localhost:5271').replace(/\/+$/, '');
const SERVER = (process.env.SERVER_URL || 'http://localhost:8871').replace(/\/+$/, '');
const OUT = path.join(__dirname, 'out', 'qa-ties');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg, extra) => {
  console.log(ok ? '  ok  ' : '  FAIL', msg, !ok && extra !== undefined ? JSON.stringify(extra).slice(0, 700) : '');
  if (!ok) failures.push(msg);
  return ok;
};
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // page busy: try again
    }
    await sleep(60);
  }
  throw new Error('timeout: ' + label);
}
const call = (s, ev, req) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ack timeout ' + ev)), 8000);
    s.emit(ev, req, (res) => {
      clearTimeout(t);
      if (res && res.ok === false) reject(new Error(`${ev}: ${res.error} ${res.message}`));
      else resolve(res);
    });
  });
async function socket() {
  const s = io(SERVER, { transports: ['websocket'], forceNew: true });
  await new Promise((res, rej) => {
    s.once('connect', res);
    s.once('connect_error', rej);
  });
  return s;
}

const NAMES = ['דנה', 'יוסי', 'מיכל', 'רון'];

(async () => {
  const browser = await chromium.launch();
  const sockets = [];
  const errors = [];
  try {
    // ── the TV ──
    const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const tv = await tvCtx.newPage();
    tv.on('pageerror', (e) => errors.push('TV pageerror ' + e.message));
    await tv.goto(BASE + '/host.html');
    await tv.evaluate(() => localStorage.clear());
    await tv.goto(BASE + '/host.html');
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 30000 });
    const { code, hostKey } = await tv.evaluate(() => ({ code: localStorage.getItem('party.host.code'), hostKey: localStorage.getItem('party.host.key') }));
    await tv.mouse.click(960, 60); // unlock audio
    const st = () => tv.evaluate(() => window.__host.state());
    const tvNow = () => tv.evaluate(() => window.__host.now());
    const waitPhase = (p, ms = 40000) => tv.waitForFunction((x) => window.__host.state().phase === x, p, { timeout: ms });
    const shotTv = (name) => tv.screenshot({ path: path.join(OUT, `tv-${name}.png`) });

    // a second host connection drives the room (the TV page only shows it)
    const host = await socket();
    sockets.push(host);
    await call(host, 'host:create', { code, hostKey });
    await call(host, 'host:setAutoCutscenes', { enabled: false });

    // ── four real phones, each with a puppet socket on the same player ──
    const phones = [];
    for (const name of NAMES) {
      const ctx = await browser.newContext({ ...devices['iPhone 14'] });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${name} pageerror ${e.message}`));
      await page.goto(`${BASE}/?room=${code}`);
      await waitFor(() => page.evaluate(() => window.__player && window.__player.screen === 'join'), 20000, `${name} join screen`);
      await page.fill('.pp-name-input', name);
      await page.tap('.pp-btn-go').catch(() => page.click('.pp-btn-go'));
      await waitFor(() => page.evaluate(() => window.__player.screen === 'lobby'), 20000, `${name} lobby`);
      const ident = await page.evaluate((c) => JSON.parse(localStorage.getItem('party.player.' + c)), code);
      const s = await socket();
      sockets.push(s);
      await call(s, 'player:join', { code, name, playerId: ident.playerId, secret: ident.secret });
      phones.push({ name, page, id: ident.playerId, s });
    }
    const byName = Object.fromEntries(phones.map((p) => [p.name, p]));
    const screenOf = (p) => p.page.evaluate(() => window.__player.screen);
    const shotPhone = (p, name) => p.page.screenshot({ path: path.join(OUT, `phone-${name}.png`) });
    check((await st()).players.length === 4 && (await st()).players.map((p) => p.rank).join() === '1,2,3,4', 'lobby: four players, ranks 1..4 in join order before any round');

    /** Plays one round: `plan` = [name, score, delay ms after the previous one]; everyone gets a final. */
    async function playRound(gameId, plan) {
      await call(host, 'host:start', { gameId });
      await waitPhase('playing');
      const round = (await st()).round.index;
      await sleep(250);
      for (const [name, score, wait] of plan) {
        await sleep(wait);
        await call(byName[name].s, 'player:final', { round, score });
      }
      await waitPhase('results', 30000);
      return (await st()).results;
    }

    function checkStrict(res, tag) {
      const byRound = [...res.rows].sort((a, b) => a.roundRank - b.roundRank);
      const scorers = byRound.filter((r) => r.raw > 0);
      check(res.winnerIds.length === (scorers.length > 0 ? 1 : 0), `${tag}: winnerIds has exactly one id (${res.winnerIds.length})`);
      check(res.rows.map((r) => r.rank).join() === res.rows.map((_, i) => i + 1).join(), `${tag}: overall ranks are 1..n`, res.rows.map((r) => [r.name, r.rank]));
      check(byRound.map((r) => r.roundRank).join() === byRound.map((_, i) => i + 1).join(), `${tag}: round positions are 1..n`);
      check(byRound.every((r, i) => i === 0 || r.raw <= byRound[i - 1].raw), `${tag}: round order follows the raw score`);
      check(scorers.every((r, i) => i === 0 || r.points < scorers[i - 1].points), `${tag}: points strictly decreasing among scorers`, scorers.map((r) => [r.name, r.raw, r.points]));
      check(scorers.every((r, i) => i === 0 || r.raw !== scorers[i - 1].raw || r.reachedAt >= scorers[i - 1].reachedAt), `${tag}: on the same raw score the earlier one is ahead`, scorers.map((r) => [r.name, r.raw, r.reachedAt]));
      const totals = res.rows.map((r) => r.total).filter((t) => t > 0);
      check(new Set(totals).size === totals.length, `${tag}: no two players on the same total`, res.rows.map((r) => [r.name, r.total]));
      return byRound;
    }

    /** The show of one round's results on the TV and the phones. */
    async function watchResults(res, tag, winnerName, expectEarlierOnStage) {
      const winner = byName[winnerName];
      check(res.winnerIds[0] === winner.id, `${tag}: the winner is ${winnerName}, who got to the score first`);
      await waitFor(async () => (await tvNow()) >= res.revealAt - 1300, 15000, 'suspense list complete');
      await shotTv(`${tag}-round-results`);
      const susp = await tv.evaluate(() => ({
        rows: [...document.querySelectorAll('.sh-rrow.is-on')].map((r) => ({ name: r.querySelector('.sh-name').textContent, raw: r.querySelector('.sh-raw').textContent.trim(), hint: !!r.querySelector('.sh-earlier') })),
        cer: document.querySelectorAll('.sh-cer-name').length,
      }));
      check(susp.cer === 0, `${tag}: TV suspense, the winner is still hidden`);
      const wantHints = susp.rows.map((r, i) => i + 1 < susp.rows.length && susp.rows[i + 1].raw === r.raw && r.raw !== '0');
      check(susp.rows.length > 0 && susp.rows.every((r, i) => r.hint === wantHints[i]), `${tag}: TV round results show "⏱ קודם" exactly on a row that is above another row with the same raw`, susp.rows);

      await waitFor(async () => (await tv.locator('.sh-cer-name').count()) > 0, 15000, 'TV ceremony');
      await waitFor(async () => (await Promise.all(phones.map(screenOf))).every((s) => s === 'win' || s === 'reveal'), 8000, 'phones on the reveal');
      const screens = await Promise.all(phones.map(screenOf));
      check(screens.filter((s) => s === 'win').length === 1 && screens[phones.indexOf(winner)] === 'win', `${tag}: exactly ONE phone shows the WIN moment, and it is ${winnerName}'s`, screens);
      check(screens.filter((s) => s === 'reveal').length === 3, `${tag}: the other three phones show who won`, screens);
      const loser = phones.find((p) => p !== winner);
      const revealName = await loser.page.textContent('.pp-reveal-name');
      const faces = await loser.page.locator('.pp-reveal-face').count();
      check(revealName.trim() === winnerName && faces === 1, `${tag}: the "who won" screen names one winner (${revealName.trim()}, ${faces} face)`);
      await sleep(3400);
      await shotTv(`${tag}-ceremony`);
      await shotPhone(winner, `${tag}-WIN-${winner.name}`);
      await shotPhone(loser, `${tag}-who-won-${loser.name}`);
      const cer = await tv.evaluate(() => ({
        names: [...document.querySelectorAll('.sh-cer-name')].map((e) => e.textContent.trim()),
        tie: document.querySelectorAll('.sh-cer-tie, .sh-cer--tie').length,
        kicker: document.querySelector('.sh-cer-kicker').textContent,
        earlier: !!document.querySelector('.sh-cer-earlier'),
        text: document.querySelector('.sh-cer-text').textContent,
      }));
      check(cer.names.length === 1 && cer.names[0] === winnerName && cer.tie === 0 && !/תיקו/.test(cer.text), `${tag}: TV ceremony has ONE winner on stage: ${cer.names.join(', ')} (${cer.kicker})`, cer);
      check(cer.earlier === expectEarlierOnStage, `${tag}: the ceremony ${expectEarlierOnStage ? 'explains' : 'does not mention'} the tie-break`, cer);

      // overall standings on the TV
      await tv.waitForSelector('.sh-results--standings', { timeout: 25000 });
      await sleep(3200);
      await shotTv(`${tag}-standings`);
      const stand = await tv.evaluate(() => [...document.querySelectorAll('.sh-trow:not(.is-hidden)')].map((r) => ({ rank: r.querySelector('.sh-rank').textContent.trim(), name: r.querySelector('.sh-name').textContent.trim(), y: r.getBoundingClientRect().top })).sort((a, b) => a.y - b.y));
      check(stand.map((r) => r.rank).join() === '1,2,3,4', `${tag}: TV standings show ranks 1,2,3,4 (${stand.map((r) => `${r.rank}.${r.name}`).join(' ')})`, stand);
      check(stand.map((r) => r.name).join() === res.rows.map((r) => r.name).join(), `${tag}: TV standings are in the server's order`, stand);
      const banner = await tv.textContent('.sh-banner-text');
      check(banner.includes(winnerName) && !/זוכים|תיקו/.test(banner), `${tag}: the banner names one winner (${banner.trim()})`);

      // the phones' own result cards
      for (const p of phones) {
        if ((await screenOf(p)) !== 'results') await p.page.mouse.click(195, 300).catch(() => undefined);
      }
      await waitFor(async () => (await Promise.all(phones.map(screenOf))).every((s) => s === 'results'), 20000, 'phones on their result card');
      await sleep(1900);
      const cards = [];
      for (const p of phones) {
        const row = res.rows.find((r) => r.playerId === p.id);
        const card = await p.page.evaluate(() => ({
          rank: document.querySelector('.pp-res-rank').textContent,
          table: document.querySelectorAll('.pp-res-v')[1].textContent,
          points: document.querySelector('.pp-res-points').textContent.replace(/[^0-9]/g, ''),
          hint: (document.querySelector('.pp-res-card .pp-earlier') || {}).textContent || '',
          chips: document.querySelectorAll('.pp-top3 .pp-earlier-chip').length,
          winner: !!document.querySelector('.pp-res-card.is-winner'),
        }));
        cards.push({ name: p.name, ...card });
        check(row.raw > 0 ? card.rank.includes(`מקום ${row.roundRank} בסיבוב`) : /לא קלעת/.test(card.rank), `${tag}: ${p.name}'s phone shows round place ${row.roundRank} (${card.rank.trim()})`);
        check(card.table.includes(`#${row.rank}`), `${tag}: ${p.name}'s phone shows overall place #${row.rank} (${card.table.trim()})`);
        check(Number(card.points) === row.points, `${tag}: ${p.name}'s phone shows +${row.points} (${card.points})`);
        check(card.winner === (p === winner), `${tag}: ${p.name}'s card is ${p === winner ? '' : 'not '}the winner's card`);
      }
      check(new Set(cards.filter((c) => /מקום/.test(c.rank)).map((c) => c.rank)).size === cards.filter((c) => /מקום/.test(c.rank)).length, `${tag}: no two phones show the same round place`, cards.map((c) => c.rank));
      check(new Set(cards.map((c) => c.table.replace(/[^#0-9]/g, '').slice(0, 2))).size === 4, `${tag}: no two phones show the same overall place`, cards.map((c) => c.table));
      return cards;
    }

    // ───────── round 1: everybody on 6 ─────────
    console.log('── round 1: four phones, all on 6 ──');
    const res1 = await playRound('flappy', [['מיכל', 6, 0], ['דנה', 6, 350], ['רון', 6, 350], ['יוסי', 6, 350]]);
    const order1 = checkStrict(res1, 'r1');
    check(order1.map((r) => r.name).join() === 'מיכל,דנה,רון,יוסי', `r1: round order is the order they got to 6 (${order1.map((r) => r.name).join(' ')})`);
    check(order1.map((r) => r.points).join() === '1100,1060,1030,1000', `r1: points 1100 / 1060 / 1030 / 1000 (${order1.map((r) => r.points).join(' ')})`);
    const cards1 = await watchResults(res1, 'r1', 'מיכל', true);
    check(/⏱/.test(cards1.find((c) => c.name === 'דנה').hint) && /מיכל/.test(cards1.find((c) => c.name === 'דנה').hint), 'r1: the second place\'s phone explains why it is below the same score', cards1.find((c) => c.name === 'דנה'));
    check(cards1.every((c) => c.chips === 3), 'r1: every row of the round top-3 on the phone is marked (the fourth has the same score too)', cards1.map((c) => c.chips));
    await shotPhone(byName['דנה'], 'r1-results-card-second');
    await shotPhone(byName['מיכל'], 'r1-results-card-winner');
    await shotPhone(byName['יוסי'], 'r1-results-card-fourth');

    // ───────── round 2: two on 40, a 25 and a zero ─────────
    console.log('── round 2: two phones on 40, one on 25, one on 0 ──');
    const res2 = await playRound('ninja', [['יוסי', 40, 0], ['רון', 25, 300], ['דנה', 40, 300], ['מיכל', 0, 300]]);
    const order2 = checkStrict(res2, 'r2');
    check(order2.map((r) => r.name).join() === 'יוסי,דנה,רון,מיכל', `r2: round order (${order2.map((r) => r.name).join(' ')})`);
    check(order2[0].points === 1100 && order2[1].points === 1060 && order2[3].points === 0 && order2[3].reachedAt === null, `r2: 1100 / 1060 / ${order2[2].points} / 0`, order2.map((r) => [r.name, r.points]));
    await watchResults(res2, 'r2', 'יוסי', true);
    await shotPhone(byName['דנה'], 'r2-results-card-second');
    await shotPhone(byName['מיכל'], 'r2-results-card-zero');

    // ───────── lobby between rounds: the TV standings panel and the phones' place pill ─────────
    console.log('── lobby standings ──');
    await call(host, 'host:lobby', {});
    await waitPhase('lobby');
    await sleep(1800);
    await shotTv('lobby-standings');
    const state = await st();
    const serverOrder = [...state.players].sort((a, b) => a.rank - b.rank);
    check(serverOrder.map((p) => p.rank).join() === '1,2,3,4', 'lobby: PlayerPublic.rank is 1..4', state.players.map((p) => [p.name, p.total, p.rank]));
    const panel = await tv.evaluate(() => [...document.querySelectorAll('.sh-prow')].map((r) => ({ rank: r.querySelector('.sh-rank').textContent.trim(), name: r.querySelector('.sh-name').textContent.trim() })));
    check(panel.map((r) => r.rank).join() === '1,2,3,4' && panel.map((r) => r.name).join() === serverOrder.map((p) => p.name).join(), `lobby: TV standings panel shows 1,2,3,4 in the server's order (${panel.map((r) => `${r.rank}.${r.name}`).join(' ')})`, panel);
    await waitFor(async () => (await Promise.all(phones.map(screenOf))).every((s) => s === 'lobby'), 10000, 'phones in the lobby');
    const pills = [];
    for (const p of phones) pills.push((await p.page.textContent('.pp-pill-yellow')).trim());
    phones.forEach((p, i) => check(pills[i].includes(`מקום ${state.players.find((x) => x.id === p.id).rank}`), `lobby: ${p.name}'s phone shows place ${state.players.find((x) => x.id === p.id).rank} (${pills[i]})`));
    const lists = await phones[0].page.evaluate(() => [...document.querySelectorAll('.pp-standings li')].map((li) => li.querySelector('.pp-st-name').textContent.trim()));
    check(lists.join() === serverOrder.map((p) => p.name).join(), `lobby: the phone's standings list is in the server's order (${lists.join(' ')})`);
    await shotPhone(phones[0], 'lobby-standings');

    // ───────── the podium ─────────
    console.log('── podium ──');
    await call(host, 'host:final', {});
    await waitPhase('final');
    await tv.waitForSelector('.sh-champ-name', { timeout: 30000 });
    await sleep(2500);
    await shotTv('podium');
    const pod = await tv.evaluate(() => ({
      nums: [...document.querySelectorAll('.sh-pod')].map((c) => ({ place: [...c.classList].find((x) => /^sh-pod--\d$/.test(x)).slice(-1), num: c.querySelector('.sh-pod-num').textContent.trim(), name: c.querySelector('.sh-pod-name').textContent.trim(), crown: !!c.querySelector('.sh-pod-crown') })),
      champ: document.querySelector('.sh-champ-name').textContent.trim(),
      kicker: document.querySelector('.sh-champ-kicker').textContent,
      also: document.querySelectorAll('.sh-pod-also').length,
      text: document.querySelector('[data-testid=final]').textContent,
    }));
    const end = await st();
    const finalOrder = [...end.players].sort((a, b) => a.rank - b.rank);
    check(pod.nums.length === 3 && pod.nums.every((c) => c.num === c.place) && pod.nums.every((c) => c.name === finalOrder[Number(c.place) - 1].name), `podium: exactly one player per step, steps 1/2/3 = the server's ranks (${pod.nums.map((c) => `${c.num}.${c.name}`).join(' ')})`, pod.nums);
    check(pod.nums.filter((c) => c.crown).length === 1 && pod.nums.find((c) => c.crown).place === '1', 'podium: one crown, on the first step');
    check(pod.champ === finalOrder[0].name && pod.also === 0 && !/תיקו/.test(pod.text), `podium: one champion (${pod.champ}), no "tie" wording anywhere`, pod);
    await waitFor(async () => (await Promise.all(phones.map(screenOf))).every((s) => s === 'final'), 10000, 'phones on the final');
    await sleep(2200);
    const places = [];
    for (const p of phones) places.push((await p.page.textContent('.pp-final-place')).trim());
    const WORD = ['', 'ראשון', 'שני', 'שלישי'];
    phones.forEach((p, i) => {
      const rank = end.players.find((x) => x.id === p.id).rank;
      check(rank <= 3 ? places[i].includes(WORD[rank]) : places[i].includes(`מקום ${rank} `), `final: ${p.name}'s phone shows place ${rank} (${places[i]})`);
    });
    check(new Set(places).size === 4, 'final: four phones, four different places', places);
    await shotPhone(byName[finalOrder[0].name], 'final-champion');
    await shotPhone(byName[finalOrder[3].name], 'final-fourth');
    await tv.waitForSelector('.sh-ftable', { timeout: 20000 });
    await sleep(1500);
    await shotTv('podium-table');
    const table = await tv.evaluate(() => [...document.querySelectorAll('.sh-frow')].map((r) => r.querySelector('.sh-rank').textContent.trim() + '.' + r.querySelector('.sh-name').textContent.trim()));
    check(table.join() === finalOrder.map((p, i) => `${i + 1}.${p.name}`).join(), `final table: 1..4 in the server's order (${table.join(' ')})`, table);

    check(errors.length === 0, 'no page errors', errors.slice(0, 5));
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack ? e.stack : String(e)));
    console.log('  FAIL crashed:', e && e.stack ? e.stack : e);
  } finally {
    for (const s of sockets) s.close();
    await browser.close();
  }
  console.log(failures.length === 0 ? '\nqa-ties: ALL OK' : `\nqa-ties: ${failures.length} FAILED\n - ${failures.join('\n - ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
