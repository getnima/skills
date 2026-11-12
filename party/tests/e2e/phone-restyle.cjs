// phone-restyle: every phone screen from the round intro to the final podium, in a real room,
// on four phones (320x568, 390x844, 430x932 and a notched 393x852 with safe areas), with a
// table of 20 players and long / emoji / Latin names. A raw socket host drives the room,
// scripted socket bots fill it, and every real phone has a puppet socket on the SAME player
// (same playerId + secret) that sends that player's final, so the places are exact:
//
//   round 1 (tap)     the 320 phone wins: intro, 3-2-1, the cutscene overlay, "we go on", sending,
//                     suspense, the WIN moment (toured through every size), "who won" on the other
//                     three, the results of the winner, a mid place and a zero; a reload on the results
//   between rounds    the waiting room (welcome.css, for reference) and the reconnect banner
//   round 2 (flappy)  an elimination round: a guest joins late, the notched phone is last in the
//                     air; the results show places, not distances
//   round 3 (tap)     nobody scores: "nobody won"; the banner over the game
//   final             a champion, a podium place, two places off the podium; kicked; the room is
//                     gone; still connecting; the phone held sideways
//
//   PORT=8893 PARTY_TEST_DURATION_MS=16000 npx tsx server/index.ts        (real intro + 3-2-1, 16 s rounds)
//   PARTY_SERVER_PORT=8893 PARTY_CLIENT_PORT=5303 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   SERVER_URL=http://localhost:8893 CLIENT_URL=http://localhost:5303 node tests/e2e/phone-restyle.cjs
//
// Env: OUT_NAME (default "phone-restyle": the folder under tests/e2e/out/), ONLY=round1 stops after round 1.
// Every screenshot is audited (qa-phone-lib: no page scroll, nothing outside the viewport,
// tap targets >= 44 px, no text cut inside a box, no overlapping text). LOOK at the pictures:
// a weak layout is not an assertion. Exit code 1 when a check failed.
process.env.SERVER_URL = process.env.SERVER_URL || 'http://localhost:8893';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5303';
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const L = require('./qa-phone-lib.cjs');

const OUT = path.join(__dirname, 'out', process.env.OUT_NAME || 'phone-restyle');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const { check, done } = L.makeChecker('restyle');
const sleep = L.sleep;
const log = (...a) => console.log('[restyle]', ...a);

const dev = (width, height) => ({ viewport: { width, height }, screen: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
/** The phones: tag, size, safe areas [top, bottom], name (14 characters is the server's limit), look. */
const PHONES = [
  { tag: 's320', w: 320, h: 568, safe: null, name: 'אלכסנדרה גדולה', look: '1.3.14.9.0.0.15' },
  { tag: 's390', w: 390, h: 844, safe: null, name: 'Dana 😀🎉 דנה', look: '1.8.8-17.9.0.0.7' },
  { tag: 's430', w: 430, h: 932, safe: null, name: 'WWWWWWWWWWWWWW', look: '1.5.3.0.0.11.0' },
  { tag: 'notch', w: 393, h: 852, safe: [59, 34], name: 'יוסי', look: '1.2.12.5.0.0.15' },
];
const SIZES = PHONES.map((p) => ({ tag: p.tag, w: p.w, h: p.h, safe: p.safe }));
const BOT_NAMES = ['מיכל הגדולה', 'Mike 🎸', 'רון', '🦄 יוני', 'Tal', 'אביגיל', 'Omer K', 'מאיה', 'בן', 'אלכסנדר מגדול', 'שושנה דמארי 99', 'נועה', 'Guest 12 🎉🎉', 'דניאל', 'סבתא רחל', 'עומר'];
const BOT_LOOKS = ['1.4.10.0.13.0.0', '1.7.16.9.0.11.15', '1.1.2.5.6.0.7', '1.0.1.0.0.0.0', '1.9.4.5.0.0.0', '1.10.17.0.6.0.15', '1.11.12.9.13.11.7', '1.6.8.0.0.0.0'];

// ───────── sockets ─────────
function sock() {
  return io(L.SERVER, { transports: ['websocket'], forceNew: true });
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

(async () => {
  const browser = await L.launch();
  const host = L.createHost();
  const sockets = [];
  const phones = [];
  let n = 0;
  const num = () => String(++n).padStart(2, '0');
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    log('room', code);
    const state = () => host.state();
    // who is "out" (final in) and when: tells why a round ended when it did
    const outAt = new Map();
    host.socket.on('scores', (msg) => {
      for (const id of msg.out) if (!outAt.has(`${msg.round}:${id}`)) outAt.set(`${msg.round}:${id}`, Date.now());
    });
    const waitPhase = (p, ms = 60000) => L.waitFor(() => state() && state().phase === p, ms, `phase ${p}`);

    async function open(tag, size, look, extra = {}) {
      const page = await L.openPhone(
        browser,
        tag,
        dev(size.w, size.h),
        {
          ...extra,
          initScript: `try { if (!localStorage.getItem('party.lastLook')) localStorage.setItem('party.lastLook', ${JSON.stringify(look)}); } catch {}`,
        },
        check,
      );
      if (size.safe) await L.setSafeArea(page, size.safe[0], size.safe[1]);
      return page;
    }
    /** One audited screenshot. */
    const shot = (page, label, opts) => L.shot(page, OUT, label, check, opts);
    /** The same screen on every phone, same label. */
    const shotAll = (label, opts, list = phones) => Promise.all(list.map((p) => shot(p.page, label, opts)));
    /** One phone's current screen at every size (the page is resized; the safe areas follow). */
    async function tour(p, label, opts, hold) {
      const name = p.page.__name;
      for (const s of SIZES) {
        if (hold && !(await hold())) {
          log(`(${label}: the screen ended during the size tour, before ${s.tag})`);
          break;
        }
        await L.resize(p.page, { width: s.w, height: s.h });
        await L.setSafeArea(p.page, s.safe ? s.safe[0] : 0, s.safe ? s.safe[1] : 0);
        await sleep(350);
        p.page.__name = `${name}-as-${s.tag}`;
        await shot(p.page, label, opts);
      }
      p.page.__name = name;
      await L.resize(p.page, { width: p.w, height: p.h });
      await L.setSafeArea(p.page, p.safe ? p.safe[0] : 0, p.safe ? p.safe[1] : 0);
      await sleep(200);
    }

    // ── the phones, each with a puppet socket on the same player ──
    for (const ph of PHONES) {
      const page = await open(ph.tag, ph, ph.look);
      await L.join(page, code, ph.name);
      const ident = await page.evaluate((c) => JSON.parse(localStorage.getItem('party.player.' + c)), code);
      const s = sock();
      sockets.push(s);
      await call(s, 'player:join', { code, name: ph.name, playerId: ident.playerId, secret: ident.secret });
      phones.push({ ...ph, page, id: ident.playerId, s });
    }
    const [A, B, C, D] = phones;

    // ── 16 bots: a room of 20 ──
    const bots = [];
    for (let i = 0; i < BOT_NAMES.length; i++) {
      const s = sock();
      sockets.push(s);
      const res = await call(s, 'player:join', { code, name: BOT_NAMES[i], look: BOT_LOOKS[i % BOT_LOOKS.length] });
      bots.push({ s, id: res.playerId, name: BOT_NAMES[i] });
    }
    await L.waitFor(() => state() && state().players.length === 20, 10000, '20 players');
    await sleep(1200);
    await shotAll(`${num()}-waiting-room-20`);

    /** Finals of one round: [socket, score, ms after the round began]. Everything else scores nothing. */
    async function playRound(gameId, finals, during) {
      await host.call('host:start', { gameId });
      await L.waitFor(() => state().phase === 'intro', 5000, 'intro');
      const before = during && during.intro ? during.intro() : null;
      await Promise.all(phones.map((p) => L.waitScreen(p.page, ['intro', 'late'], 8000)));
      await sleep(1300);
      await shotAll(`${num()}-intro-${gameId}`);
      if (before) await before;
      // 3-2-1: one phone per digit, then GO
      await Promise.all(phones.map((p) => L.waitScreen(p.page, ['countdown', 'late'], 12000)));
      const digit = (p) => p.page.evaluate(() => (document.querySelector('.pp-cd-num') || {}).textContent || '');
      const cdLabel = `${num()}-countdown-${gameId}`;
      const order = gameId === 'tap' ? [A, B, C, D] : [D, C, B, A];
      for (const want of ['3', '2', '1']) {
        const p = order.shift();
        const seen = await L.waitFor(async () => (await digit(p)).trim() === want, 4000, `digit ${want}`).catch(() => false);
        // a slow machine can miss a digit: no picture of a number still zooming in
        if (!seen) continue;
        await sleep(380);
        await shot(p.page, `${cdLabel}-${want}`, { allowOverlap: true });
      }
      const g = order.shift();
      await L.waitFor(() => g.page.evaluate(() => !!document.querySelector('.pp-countdown.is-go')), 4000, 'GO').catch(() => {});
      await sleep(140);
      await g.page.screenshot({ path: path.join(OUT, `${g.page.__name}-${cdLabel}-go.png`) });
      await waitPhase('playing');
      const round = state().round.index;
      const t0 = Date.now();
      const sent = finals.map(async ([s, score, at]) => {
        await sleep(Math.max(0, at - (Date.now() - t0)));
        // a frozen round (a video) takes no finals: wait it out
        await L.waitFor(() => state().cutscene === null && state().round && state().round.frozenAt === null, 20000, 'not frozen').catch(() => {});
        if (state().phase !== 'playing') return;
        await call(s, 'player:final', { round, score }).catch((e) => log('final refused:', e.message));
      });
      if (during && during.playing) await during.playing(round);
      await Promise.all(sent);
      return round;
    }

    // ═════════ round 1: tap. A wins, B is in the middle, C is on zero, D near the top ═════════
    const r1 = playRound(
      'tap',
      [
        [A.s, 187, 9000],
        [D.s, 141, 9200],
        [B.s, 64, 9400],
        // the last bot sends nothing: with a final still missing the round runs its full time, so
        // every phone's own game ends on the clock and shows the "sending" beat
        ...bots.slice(0, -1).map((b, i) => [b.s, 20 + i * 9, 9600 + i * 60]),
      ],
      {
        async playing() {
          await sleep(1500);
          await shot(A.page, `${num()}-playing-tap`, { allowSmall: true, allowOverlap: true, allowInner: true });
          // a video in the middle of the game
          await host.call('host:cutscene', { id: 'tap_freeze' });
          await Promise.all(phones.map((p) => L.waitFor(() => p.page.evaluate(() => window.__player.cutscene), 5000, 'cutscene')));
          await sleep(700);
          await shotAll(`${num()}-cutscene`, { drag: true });
          await host.call('host:cutsceneEnd', {});
          await Promise.all(phones.map((p) => L.waitFor(() => p.page.evaluate(() => !!document.querySelector('.pp-resume')), 4000, 'resume')));
          await sleep(350);
          await shotAll(`${num()}-resume`, { allowOverlap: true });
        },
      },
    );
    await r1;
    log('round 1 scripted, the phones are on:', (await Promise.all(phones.map((p) => L.screen(p.page)))).join(' '), 'phase', state().phase);
    waitPhase('results').then(() => log('round 1 over; finals in from', phones.map((p) => `${p.tag}:${outAt.has(`0:${p.id}`) ? 'yes' : 'no'}`).join(' '), 'of', outAt.size));
    // the round ends: sending → suspense → the moment → results
    {
      const label = `${num()}-sending`;
      await Promise.all(
        phones.map(async (p) => {
          await L.waitScreen(p.page, ['sending', 'suspense'], 40000);
          if ((await L.screen(p.page)) === 'sending') await shot(p.page, label);
        }),
      );
    }
    await Promise.all(phones.map((p) => L.waitScreen(p.page, 'suspense', 10000)));
    await sleep(500);
    await shotAll(`${num()}-suspense`);
    const res1 = (await waitPhase('results')) && state().results;
    check(res1.winnerIds[0] === A.id, `round 1: the 320 phone won (${res1.rows.find((r) => r.playerId === res1.winnerIds[0])?.name})`);
    await L.waitScreen(A.page, 'win', 15000);
    await Promise.all([B, C, D].map((p) => L.waitScreen(p.page, 'reveal', 6000)));
    await sleep(1300);
    {
      const label = `${num()}-moment`;
      await Promise.all([shot(A.page, `${label}-WIN`), ...[B, C, D].map((p) => shot(p.page, `${label}-who-won`))]);
      // the WIN moment at every size (it holds 14 s)
      await tour(A, `${label}-WIN`, undefined, async () => (await L.screen(A.page)) === 'win');
    }
    if ((await L.screen(A.page)) === 'win') await A.page.tap('.pp-win .pp-btn');
    await Promise.all(phones.map((p) => L.waitScreen(p.page, 'results', 12000)));
    await sleep(1900);
    {
      const label = `${num()}-results-tap`;
      await shotAll(label);
      // a reload on the results screen: straight back to it, no second moment
      await C.page.reload();
      await L.waitScreen(C.page, 'results', 10000);
      await sleep(1900);
      await shot(C.page, `${label}-after-reload`);
      // the winner's results and a middle place at every size
      await tour(A, `${label}-winner`);
      await tour(B, `${label}-middle`);
      const list = await A.page.evaluate(() => {
        const el = document.querySelector('.pp-top3');
        const me = el.querySelector('li.is-me');
        return { rows: el.children.length, scrolls: el.scrollHeight > el.clientHeight + 1, me: !!me };
      });
      check(list.rows === 20 && list.me, `the round table lists all 20, with my row (${JSON.stringify(list)})`);
      // my row never scrolls away: scroll the table to its end on the phone that is in the middle
      await B.page.evaluate(() => {
        const el = document.querySelector('.pp-top3');
        el.scrollTop = el.scrollHeight;
      });
      await sleep(300);
      const pinned = await B.page.evaluate(() => {
        const el = document.querySelector('.pp-top3');
        const me = el.querySelector('li.is-me').getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return me.top >= box.top - 1 && me.bottom <= box.bottom + 1;
      });
      check(pinned, 'the round table scrolled to its end still shows my row');
      await shot(B.page, `${label}-scrolled`);
      await B.page.evaluate(() => (document.querySelector('.pp-top3').scrollTop = 0));
    }
    if (process.env.ONLY === 'round1') throw new Error('STOP (ONLY=round1)');

    // ═════════ between rounds: the waiting room with the table, the reconnect banner ═════════
    await host.call('host:lobby', {});
    await Promise.all(phones.map((p) => L.waitScreen(p.page, 'lobby', 10000)));
    await sleep(900);
    await shotAll(`${num()}-between-rounds`);
    await D.page.__ctx.setOffline(true);
    await L.waitFor(() => D.page.evaluate(() => window.__player.banner), 40000, 'banner');
    await sleep(400);
    await shot(D.page, `${num()}-reconnect-banner-lobby`);
    await D.page.__ctx.setOffline(false);
    await L.waitFor(async () => !(await D.page.evaluate(() => window.__player.banner)), 30000, 'banner gone');
    check((await D.page.evaluate(() => window.__player.snap.playerId)) === D.id, 'after the reconnect the phone is the same player');

    // ═════════ round 2: flappy (elimination). B is last in the air; a guest joins late ═════════
    let late = null;
    const r2 = playRound(
      'flappy',
      [
        // the puppets answer before the phones' own birds fall (the first final of a player wins)
        [B.s, 9000, 250],
        [D.s, 3100, 280],
        [C.s, 55, 310],
        [A.s, 40, 340],
        ...bots.map((b, i) => [b.s, 300 + i * 150, 2000 + i * 330]),
      ],
      {
        intro() {
          return (async () => {
            late = { tag: 'late', w: 390, h: 844, safe: null, name: 'מאחרת 🙋', look: '1.6.16.9.0.0.0' };
            late.page = await open('late', late, late.look);
            await L.join(late.page, code, late.name);
            await L.waitScreen(late.page, 'late', 8000);
            late.id = await late.page.evaluate(() => window.__player.snap.playerId);
            await sleep(900);
            await tour(late, `${num()}-late-joiner`);
          })();
        },
        async playing() {
          await sleep(1200);
          await shot(C.page, `${num()}-playing-flappy`, { allowSmall: true, allowOverlap: true, allowInner: true });
        },
      },
    );
    await r2;
    {
      const label = `${num()}-sending-flappy`;
      await Promise.all(
        phones.map(async (p) => {
          await L.waitScreen(p.page, ['sending', 'suspense'], 40000);
          if ((await L.screen(p.page)) === 'sending') await shot(p.page, label);
        }),
      );
    }
    const res2 = (await waitPhase('results')) && state().results;
    check(res2.winnerIds[0] === B.id, `round 2: the 390 phone was last in the air (${res2.rows.find((r) => r.playerId === res2.winnerIds[0])?.name})`);
    await L.waitScreen(B.page, 'win', 20000);
    await sleep(1300);
    {
      const label = `${num()}-moment-flappy`;
      await Promise.all([shot(B.page, `${label}-WIN`), ...[A, C, D, late].map((p) => shot(p.page, `${label}-who-won`))]);
    }
    await B.page.tap('.pp-win .pp-btn');
    await Promise.all([...phones, late].map((p) => L.waitScreen(p.page, 'results', 12000)));
    await sleep(1900);
    {
      const label = `${num()}-results-flappy`;
      await shotAll(label, undefined, [...phones, late]);
      // an elimination round shows places, never the distance
      for (const p of phones) {
        const row = res2.rows.find((r) => r.playerId === p.id);
        const scorers = res2.rows.filter((r) => r.raw > 0).length;
        const card = await p.page.evaluate(() => ({
          rank: document.querySelector('.pp-res-rank').textContent.replace(/\s+/g, ' ').trim(),
          raw: (document.querySelector('.pp-res-raw') || {}).textContent || '',
          totals: [...document.querySelectorAll('.pp-top3 .pp-st-total')].map((e) => e.textContent.trim()),
          card: document.querySelector('.pp-res-card').textContent,
        }));
        check(card.rank === `מקום ${row.roundRank} בסיבוב`, `${p.tag}: flappy results say the place (${card.rank})`);
        check(p === B ? /באוויר/.test(card.raw) : card.raw.includes(`מתוך ${scorers}`), `${p.tag}: ...out of the ${scorers} who flew (${card.raw})`);
        check(!new RegExp(`(^|[^0-9,])${row.raw}([^0-9,]|$)`).test(card.card) || row.raw === row.points, `${p.tag}: the distance ${row.raw} is not on the result card (${card.card.replace(/\s+/g, ' ').slice(0, 80)})`);
        check(card.totals[0] === 'אחרון באוויר' && card.totals.every((t) => !t.includes('⭐')), `${p.tag}: the table marks who was last in the air and shows no raw score (${card.totals.slice(0, 3).join(' | ')})`);
      }
      await tour(D, `${label}-place`);
    }

    // ═════════ round 3: tap, nobody scores; the banner over the game ═════════
    await host.call('host:lobby', {});
    await Promise.all(phones.map((p) => L.waitScreen(p.page, 'lobby', 10000)));
    const r3 = playRound('tap', [], {
      async playing() {
        await sleep(1000);
        await C.page.__ctx.setOffline(true);
        await L.waitFor(() => C.page.evaluate(() => window.__player.banner), 40000, 'banner');
        await sleep(300);
        await shot(C.page, `${num()}-reconnect-banner-game`, { allowSmall: true, allowOverlap: true, allowInner: true });
        await C.page.__ctx.setOffline(false);
        await L.waitFor(async () => !(await C.page.evaluate(() => window.__player.banner)), 30000, 'banner gone');
      },
    });
    await r3;
    await waitPhase('results');
    check(state().results.winnerIds.length === 0, 'round 3: nobody scored, no winner');
    await Promise.all(phones.map((p) => L.waitScreen(p.page, ['reveal', 'results'], 20000)));
    await sleep(900);
    await shotAll(`${num()}-moment-nobody-won`, undefined, phones.filter((p) => p !== C));
    await Promise.all(phones.map((p) => L.waitScreen(p.page, 'results', 12000)));
    await sleep(1700);
    await shotAll(`${num()}-results-nobody-scored`);

    // ═════════ the final ═════════
    await host.call('host:final', {});
    await sleep(400);
    if (state().cutscene) await host.call('host:cutsceneEnd', {});
    await Promise.all([...phones, late].map((p) => L.waitScreen(p.page, 'final', 10000)));
    await sleep(2000);
    {
      const label = `${num()}-final`;
      const ranks = Object.fromEntries(state().players.map((p) => [p.id, p.rank]));
      log('final ranks:', phones.map((p) => `${p.tag}=${ranks[p.id]}`).join(' '), `late=${ranks[late.id]}`);
      await shotAll(label, undefined, [...phones, late]);
      const champ = phones.find((p) => ranks[p.id] === 1);
      const off = phones.find((p) => ranks[p.id] > 3);
      if (champ) await tour(champ, `${label}-champion`);
      if (off) await tour(off, `${label}-off-podium`);
      check(champ !== undefined && off !== undefined, 'the final has a champion and a place off the podium among the phones');
    }

    // ── the phone held sideways ──
    await L.resize(C.page, { width: 932, height: 430 });
    await sleep(500);
    check(await C.page.evaluate(() => getComputedStyle(document.querySelector('.pp-rotate')).display !== 'none'), 'sideways: the "turn the phone" overlay is on');
    await C.page.screenshot({ path: path.join(OUT, `${C.tag}-${num()}-rotate.png`) });
    await L.resize(A.page, { width: 568, height: 320 });
    await sleep(500);
    await A.page.screenshot({ path: path.join(OUT, `${A.tag}-${n}-rotate.png`) });
    await L.resize(C.page, { width: C.w, height: C.h });
    await L.resize(A.page, { width: A.w, height: A.h });

    // ── kicked ──
    await host.call('host:kick', { playerId: D.id });
    await L.waitScreen(D.page, 'kicked', 6000);
    await sleep(600);
    await tour(D, `${num()}-kicked`);
    await D.page.tap('.pp-btn');
    await L.waitScreen(D.page, 'join', 4000);

    // ── the room is gone (a stale identity) ──
    {
      const p = { tag: 'closed', w: 320, h: 568, safe: null };
      p.page = await open('closed', p, '1.0.0.0.0.0.0');
      await p.page.goto(`${L.CLIENT}/`);
      await p.page.evaluate(() => {
        localStorage.setItem('party.player.QQQQ', JSON.stringify({ playerId: 'x', secret: 'y', name: 'רוני', lateRound: null }));
        localStorage.setItem('party.lastRoom', 'QQQQ');
      });
      await p.page.goto(`${L.CLIENT}/`);
      await L.waitScreen(p.page, 'closed', 10000);
      await sleep(600);
      await tour(p, `${num()}-room-closed`);
      await p.page.tap('.pp-btn');
      await L.waitScreen(p.page, 'join', 4000);
    }

    // ── still connecting (the socket never comes up), and the slow-connection line after 6 s ──
    {
      const p = { tag: 'boot', w: 320, h: 568, safe: null };
      p.page = await open('boot', p, '1.0.0.0.0.0.0');
      await p.page.goto(`${L.CLIENT}/`);
      await p.page.evaluate((c) => {
        localStorage.setItem('party.player.' + c, JSON.stringify({ playerId: 'x', secret: 'y', name: 'רוני', lateRound: null }));
        localStorage.setItem('party.lastRoom', c);
      }, code);
      await p.page.route('**/socket.io/**', (r) => r.abort());
      await p.page.routeWebSocket(/socket\.io/, () => undefined); // opens, and the server never answers
      await p.page.goto(`${L.CLIENT}/?room=${code}`);
      await L.waitScreen(p.page, 'boot', 10000);
      await sleep(700);
      await shot(p.page, `${num()}-connecting`);
      await sleep(6200);
      await tour(p, `${n}-connecting-slow`);
    }
  } catch (err) {
    if (!/^STOP/.test(err.message)) {
      check(false, 'flow: ' + err.message);
      console.error(err);
    }
  } finally {
    for (const s of sockets) s.close();
    host.close();
    await browser.close();
  }
  process.exit(done() ? 1 : 0);
})();
