// sweep-tv-tieboard: the TV's live race against the server's "no ties" order. Two guests land on
// the SAME score inside one 250 ms broadcast window, the one who was BEHIND a moment ago reaching
// it first. The server (shared/scoring.ts, and the `scores` broadcast, which is in that order)
// puts the earlier one first, and so do the results and the ceremony. What does the live board
// on the TV show at #1 (with the crown) for the rest of the round, and after a TV reload?
//
//   SWEEP_TREE=<temp tree> node tests/e2e/sweep-tv-tieboard.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const L = require('./sweep-tv-lib.cjs');

const OUT = L.outDir('tieboard');
const { check, failures } = L.checker();

async function player(code, name) {
  const s = io(L.SERVER, { transports: ['websocket'], forceNew: true });
  await new Promise((res) => s.once('connect', res));
  const ack = await new Promise((res) => s.emit('player:join', { code, name }, res));
  const p = { s, id: ack.playerId, name, state: ack.state, scores: null };
  s.on('state', (st) => (p.state = st));
  s.on('scores', (m) => (p.scores = m));
  return p;
}

const boardTop = (tv) =>
  tv.evaluate(() =>
    [...document.querySelectorAll('[data-testid=race-card]')]
      .sort((a, b) => Number(a.dataset.slot) - Number(b.dataset.slot))
      .slice(0, 3)
      .map((r) => ({ rank: (r.querySelector('.pc-rank') || {}).textContent, name: ((r.querySelector('.pc-name') || {}).textContent || '').trim(), score: ((r.querySelector('.pc-score') || {}).textContent || '').trim(), lead: r.classList.contains('is-first') })),
  );

(async () => {
  await L.startServer({ PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '40000' });
  const browser = await chromium.launch();
  const players = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const tv = await ctx.newPage();
    await tv.goto(`${L.SERVER}/host`);
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 60000 });
    const code = await tv.evaluate(() => window.__host.state().code);
    // A = אבי (joined first, and first by name), B = בני
    const A = await player(code, 'אבי');
    const B = await player(code, 'בני');
    const C = await player(code, 'גלי');
    players.push(A, B, C);
    await tv.mouse.click(960, 6);
    await L.sleep(1800);
    // ninja: a score game with no automatic cutscene in the middle (before_ninja: auto off for this test)
    await tv.keyboard.press('KeyC');
    await tv.waitForSelector('[data-testid=cutscene-menu]');
    await tv.click('[data-testid=auto-switch]');
    await tv.waitForFunction(() => window.__host.state().autoCutscenes === false, null, { timeout: 5000 });
    await tv.keyboard.press('Escape');
    await L.sleep(1800);
    await tv.click('[data-testid=game-ninja]');
    await tv.waitForFunction(() => window.__host.state().phase === 'playing', null, { timeout: 30000 });
    const r = (await tv.evaluate(() => window.__host.state())).round;
    const send = (p, score) => p.s.emit('player:score', { round: r.index, score });
    await L.sleep(1000);
    // A is ahead, then B reaches the next level first and A 5 ms later (usually one broadcast);
    // repeated, because the 250 ms broadcast window may fall between the two
    const tries = [];
    let level = 100;
    for (let i = 0; i < 6; i++) {
      send(A, level + 10);
      send(B, level);
      send(C, Math.max(1, level - 60));
      await L.sleep(700);
      send(B, level + 50);
      await L.sleep(5);
      send(A, level + 50);
      await L.sleep(1300);
      const server = A.scores.scores.slice(0, 2).map(([id, v]) => [players.find((p) => p.id === id).name, v]);
      const tvTop = await boardTop(tv);
      tries.push({ level: level + 50, server, tv: tvTop.slice(0, 2).map((x) => [x.name, x.score, x.lead]) });
      level += 100;
    }
    await tv.screenshot({ path: path.join(OUT, 'tie-live.jpg'), type: 'jpeg', quality: 75 });
    for (const t of tries) console.log(L.stamp(), `tie at ${t.level}: server ${JSON.stringify(t.server)} | TV ${JSON.stringify(t.tv)}`);
    const wrong = tries.filter((t) => t.tv[0] && t.tv[0][0] !== t.server[0][0]);
    check(tries.every((t) => t.server[0][0] === 'בני'), 'server: בני (reached each tied level first) is always first in the live order', tries.map((t) => t.server));
    check(wrong.length === 0, `TV live board: #1 (with the crown) is the server's #1 on every tie (${tries.length - wrong.length}/${tries.length})`, wrong);
    // the TV reloads in the middle of the round: nothing changes for 6 s
    const lastServer = A.scores.scores.slice(0, 3).map(([id, v]) => [players.find((p) => p.id === id).name, v]);
    await tv.reload();
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 60000 });
    await tv.mouse.click(960, 6);
    await L.sleep(6000);
    const reloaded = await boardTop(tv);
    const empty = await tv.evaluate(() => (document.querySelector('.sh-empty') || {}).textContent || null);
    await tv.screenshot({ path: path.join(OUT, 'after-reload-no-change.jpg'), type: 'jpeg', quality: 75 });
    console.log(L.stamp(), 'TV board 6 s after a reload (no score changed):', JSON.stringify(reloaded), 'empty text:', empty);
    check(reloaded.length > 0, 'TV reloaded mid-round: the race shows the current scores without waiting for a new score', { reloaded, empty, server: lastServer });
    // one unrelated score changes: the board comes back; is the tie still in the server's order?
    send(C, 5);
    await L.sleep(1500);
    const back = await boardTop(tv);
    console.log(L.stamp(), 'after one more score:', JSON.stringify(back), 'server', JSON.stringify(A.scores.scores.slice(0, 3).map(([id, v]) => [players.find((p) => p.id === id).name, v])));
    check(back[0] && back[0].name === 'בני', 'TV reloaded mid-round: the tied #1 is still the server\'s #1 (בני)', back);
    await tv.screenshot({ path: path.join(OUT, 'after-reload-tie.jpg'), type: 'jpeg', quality: 75 });
    // finals and the results
    await tv.waitForFunction(() => window.__host.state().phase === 'results', null, { timeout: 60000 });
    const res = await tv.evaluate(() => window.__host.state().results);
    const win = res.rows.find((x) => x.playerId === res.winnerIds[0]);
    check(win && win.name === 'בני', 'results: בני wins the round (reached the top score first)', win && win.name);
  } catch (e) {
    console.error(e);
    failures.push({ msg: 'exception', extra: String(e && e.stack) });
  } finally {
    for (const p of players) p.s.close();
    await browser.close();
    L.stopAll();
  }
  fs.writeFileSync(path.join(OUT, 'failures.json'), JSON.stringify(failures, null, 1));
  console.log(failures.length === 0 ? 'sweep-tv-tieboard: ALL OK' : `sweep-tv-tieboard: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
