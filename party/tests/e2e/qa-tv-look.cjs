// qa-tv-look: the TV in the party look. Drives real rooms (the TV page + scripted phones on
// sockets) and the show demo page through every scene and takes a screenshot of each, at
// 1920x1080 and 1280x720, with a few checks (no console errors, no page scroll, sizes that
// must hold from the sofa, the flappy elimination view, the credits, the designed QR rule).
//
//   PORT=8881 PARTY_TEST_FAST=1 PARTY_REMOTE_PASSWORD=<any> npx tsx server/index.ts
//   PARTY_SERVER_PORT=8881 PARTY_CLIENT_PORT=5291 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   BASE_URL=http://localhost:5291 SERVER_URL=http://localhost:8881 PARTY_REMOTE_PASSWORD=<the same> \
//     node tests/e2e/qa-tv-look.cjs [fhd] [hd] [rooms] [demo]
//
// Env: OUT_TAG (sub-folder of tests/e2e/out/qa-tv-look, e.g. "art" for a tree that has the key
// art and the designed QR), MAP_HOST ("party.test": open BASE_URL through a host name mapped to
// 127.0.0.1, so the page's origin is not localhost), EXPECT_ART=1 / EXPECT_QR=1 (the tree is
// expected to have the pictures: checked instead of only photographed).
// The remote password is only read from the environment; without it the "remote attached" shots are skipped.
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'http://localhost:5291').replace(/\/+$/, '');
const SERVER = (process.env.SERVER_URL || 'http://localhost:8881').replace(/\/+$/, '');
const TAG = process.env.OUT_TAG || '';
const MAP_HOST = process.env.MAP_HOST || '';
const REMOTE_PW = process.env.PARTY_REMOTE_PASSWORD || '';
const EXPECT_ART = process.env.EXPECT_ART === '1';
const EXPECT_QR = process.env.EXPECT_QR === '1';
const args = process.argv.slice(2);
const SIZES = [
  ['fhd', { width: 1920, height: 1080 }],
  ['hd', { width: 1280, height: 720 }],
].filter(([name]) => !args.some((a) => a === 'fhd' || a === 'hd') || args.includes(name));
const PARTS = ['rooms', 'demo'].filter((p) => !args.some((a) => a === 'rooms' || a === 'demo') || args.includes(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(ok, msg, extra) {
  console.log(ok ? '  ok  ' : '  FAIL', msg, !ok && extra !== undefined ? JSON.stringify(extra).slice(0, 500) : '');
  if (!ok) failures.push(msg);
  return ok;
}

const NAMES = [
  'נועה', 'איתי', 'מאיה', 'יונתן', 'תמר', 'עומר', 'שירה', 'דניאל', 'יעל', 'אורי', 'מקסימיליאן כהן', 'רוני',
  'גיא', 'ליה', 'עידו', 'אלכסנדרה ב.', 'נדב', 'הילה', 'אסף', 'מיכל', 'בן', 'טל', 'Jonathan', 'רותם',
  'עדי', 'סבתא רחל', 'אלון', 'ענבל', 'יובל', 'קרן', 'דודו המלך', 'שחר', 'ליאור', 'נטע', 'אביב', 'הדר',
  'מתן', 'אופיר', 'זיו', 'גל', 'רז', 'שני', 'אריאל', 'עמית', 'חן',
];

/** Scripted phones on sockets: join, then `plan(i, elapsedMs)` every 250 ms while the room plays. */
async function joinPhones(code, names) {
  const phones = [];
  for (const name of names) {
    const s = io(SERVER, { transports: ['websocket'], forceNew: true });
    await new Promise((res, rej) => {
      s.once('connect', res);
      s.once('connect_error', rej);
    });
    const ack = await new Promise((res) => s.emit('player:join', { code, name }, res));
    if (!ack.ok) throw new Error('join failed ' + JSON.stringify(ack));
    const p = { s, id: ack.playerId, state: ack.state, last: 0, done: -1 };
    s.on('state', (st) => (p.state = st));
    phones.push(p);
  }
  return phones;
}

/**
 * Drives the phones of a round. `plan(i, elapsedMs)` returns the live score, or { out: score }
 * to send the final right now (an elimination round: this phone is out), or null for nothing.
 */
function playRound(phones, plan) {
  let offset = 0;
  phones[0].s.emit('time:ping', Date.now(), (r) => (offset = r.serverNow - Date.now()));
  const timer = setInterval(() => {
    phones.forEach((p, i) => {
      const st = p.state;
      if (!st || st.phase !== 'playing' || !st.round || st.cutscene) return;
      const r = st.round;
      const now = Date.now() + offset;
      if (r.frozenAt !== null || (r.resumeAt !== null && now < r.resumeAt)) return;
      if (p.done === r.index) return;
      const elapsed = now - r.startAt;
      if (elapsed < 0) return;
      if (now > r.endAt) {
        p.done = r.index;
        p.s.emit('player:final', { round: r.index, score: p.last }, () => undefined);
        return;
      }
      const v = plan(i, elapsed);
      if (v === null || v === undefined) return;
      if (typeof v === 'object') {
        p.done = r.index;
        p.last = Math.max(0, Math.round(v.out));
        p.s.emit('player:final', { round: r.index, score: p.last }, () => undefined);
        return;
      }
      p.last = Math.max(0, Math.round(v));
      p.s.emit('player:score', { round: r.index, score: p.last });
    });
  }, 250);
  return () => clearInterval(timer);
}

const closePhones = (phones) => phones.forEach((p) => p.s.close());

async function openPage(browser, vp, url, errors) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console ' + m.text() + ' @' + ((m.location() && m.location().url) || ''));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`);
  });
  await page.goto(url);
  return page;
}

async function openHost(browser, vp, errors) {
  const url = BASE + '/host.html';
  const page = await openPage(browser, vp, url, errors);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 30000 });
  const code = await page.evaluate(() => window.__host.state().code);
  // the first click unlocks the sound (its hint banner goes away); keys are ignored for 1.5 s after a screen change
  await page.mouse.click(vp.width / 2, 6);
  await sleep(1700);
  return { page, code };
}

const waitPhase = (page, phase, ms = 40000) => page.waitForFunction((p) => window.__host.state() && window.__host.state().phase === p, phase, { timeout: ms });
const waitCut = (page, on, ms = 20000) => page.waitForFunction((v) => !!(window.__host.state() && window.__host.state().cutscene) === v, on, { timeout: ms });
const waitChips = async (page, n) => {
  await page.waitForFunction((k) => document.querySelectorAll('[data-testid=chip]').length >= k, n, { timeout: 30000 });
  // the dolls are composed (the picture on screen is the one of the look)
  await page
    .waitForFunction(() => [...document.querySelectorAll('.hs-chip-av')].every((el) => el.getAttribute('data-drawn') === '1'), null, { timeout: 15000 })
    .catch(() => undefined);
  await sleep(900);
};
const noScroll = (page) =>
  page.evaluate(() => {
    const de = document.documentElement;
    return de.scrollWidth <= innerWidth && de.scrollHeight <= innerHeight && document.body.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight;
  });
/** Font size of the first match in px, scaled to a 1080p board (so one threshold serves both sizes). */
const px1080 = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? (parseFloat(getComputedStyle(el).fontSize) * 1080) / innerHeight : null;
  }, sel);
/** Server time relative to the winner reveal of the results on screen. */
const untilReveal = async (page, T) => {
  await page.waitForFunction((t) => window.__host.state().results && window.__host.now() >= window.__host.state().results.revealAt + t, T, { timeout: 60000, polling: 50 });
};

async function rooms(browser, sizeName, vp, shot) {
  const errors = [];
  let phones = [];
  let stop = () => undefined;
  try {
    // ───────── room A: 3 guests through a score round (tap), then 12 through flappy, then the podium ─────────
    console.log(`[${sizeName}] room A`);
    const A = await openHost(browser, vp, errors);
    const page = A.page;
    await shot(page, '01-lobby-0');
    check(await noScroll(page), 'lobby: the page does not scroll');
    const qr = await page.evaluate(() => {
      const card = document.querySelector('.hs-qr-card');
      const r = card.getBoundingClientRect();
      const join = document.querySelector('[data-testid=join]');
      return { side: (Math.min(r.width, r.height) * 1080) / innerHeight, mode: join.getAttribute('data-qr'), url: document.querySelector('[data-testid=join-url]').textContent.trim(), code: document.querySelector('[data-testid=room-code]').textContent.trim() };
    });
    check(qr.side >= 500, `the QR card is ${Math.round(qr.side)} px of a 1080p board`, qr);
    check(qr.code === A.code, 'the room code tiles read the code', qr);
    if (EXPECT_QR) {
      const d = await page.evaluate(() => {
        const img = document.querySelector('[data-testid=qr-designed]');
        if (!img) return null;
        const r = img.getBoundingClientRect();
        const cs = getComputedStyle(img);
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { side: (Math.min(r.width, r.height) * 1080) / innerHeight, ratio: r.width / r.height, natural: img.naturalWidth, radius: cs.borderRadius, filter: cs.filter, fit: cs.objectFit, covered: top !== img };
      });
      check(d !== null && qr.mode === 'designed', 'the designed QR picture is shown (qr.json vouches for this origin)', qr);
      if (d !== null) {
        check(d.side >= 420 && Math.abs(d.ratio - 1) < 0.01 && d.natural > 0, `the designed QR is ${Math.round(d.side)} px square of a 1080p board`, d);
        check(d.radius === '0px' && d.filter === 'none' && d.fit === 'contain' && !d.covered, 'the picture is not rounded, tinted, cropped or covered', d);
      }
      check(/\/j$/.test(qr.url) && !/room=/.test(qr.url), `the short link is shown under it (${qr.url})`);
    } else {
      check(qr.mode === 'generated' && (await page.locator('[data-testid=qr]').count()) === 1, 'the generated QR is shown (no designed picture for this origin)', qr);
      check(qr.url.includes('room=' + A.code), `the join address is shown under it (${qr.url})`);
    }

    phones = await joinPhones(A.code, NAMES.slice(0, 3));
    await waitChips(page, 3);
    await shot(page, '02-lobby-3');
    const big = await page.evaluate(() => {
      const r = document.querySelector('.hs-chip-av').getBoundingClientRect();
      return (r.width * 1080) / innerHeight;
    });
    check(big >= 200, `3 guests: a doll is ${Math.round(big)} px of a 1080p board`);

    // the menu, the credits, the sound check, the cutscene menu
    await page.click('[data-testid=btn-more]');
    await sleep(500);
    await shot(page, '03-menu');
    await page.click('[data-testid=btn-credits]');
    await page.waitForSelector('[data-testid=credits]');
    await sleep(500);
    await shot(page, '04-credits');
    const credits = await page.$$eval('[data-testid=credit]', (els) => els.map((e) => e.textContent));
    check(credits.length === 10 && credits.some((t) => /Gryffindor/.test(t) && /CC BY-SA 3\.0/.test(t)) && credits.some((t) => /Metropolitan Museum/.test(t) && /CC0/.test(t)), `the credits list the 10 accessory photos with author and licence`, credits.slice(0, 3));
    await page.keyboard.press('Escape');
    await page.click('[data-testid=btn-more]');
    await page.click('[data-testid=btn-sound-check]');
    await page.waitForSelector('[data-testid=sound-check]');
    await sleep(500);
    await shot(page, '05-sound-check');
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.keyboard.press('KeyC');
    await page.waitForSelector('[data-testid=cutscene-menu]');
    await sleep(600);
    await shot(page, '06-cutscene-menu');
    await page.keyboard.press('Escape');
    await sleep(300);

    // round 1: tap (a score round), with its automatic cutscene in the middle
    stop = playRound(phones, (i, t) => [9, 7, 4][i] * (t / 250) * (i === 2 && t < 2500 ? 0 : 1));
    await page.keyboard.press('Space');
    await waitPhase(page, 'intro');
    await sleep(650);
    await shot(page, '10-intro-tap');
    const intro = { title: await px1080(page, '.hs-intro-title'), text: await px1080(page, '.hs-intro-text') };
    check(intro.title >= 120 && intro.text >= 48, 'intro: a huge title and instructions of 48 px or more', intro);
    if (EXPECT_ART) check((await page.locator('.hs-intro-emoji.is-pic img').count()) === 1, 'intro: the key art is shown');
    await waitPhase(page, 'countdown');
    await sleep(420);
    await shot(page, '11-countdown');
    await waitPhase(page, 'playing');
    await sleep(220);
    await shot(page, '12-go');
    await waitCut(page, true, 12000);
    await page
      .waitForFunction(() => {
        const v = document.querySelector('[data-testid=cutscene-video]');
        return v && v.currentTime > 0.8;
      }, null, { timeout: 12000 })
      .catch(() => undefined);
    await shot(page, '13-cutscene-video');
    await waitCut(page, false, 20000);
    await sleep(350);
    await shot(page, '14-resume-321');
    await page.waitForFunction(() => document.querySelector('[data-testid=resume]') === null, null, { timeout: 8000 });
    await sleep(2600);
    await shot(page, '15-live-3');
    const live3 = await page.evaluate(() => {
      const row = document.querySelector('.sh-row');
      const av = row.querySelector('.sh-avatar').getBoundingClientRect();
      return { doll: (av.height * 1080) / innerHeight, name: (parseFloat(getComputedStyle(row.querySelector('.sh-name')).fontSize) * 1080) / innerHeight, odo: document.querySelectorAll('.sh-row .sh-score.sh-odo').length };
    });
    check(live3.doll >= 140 && live3.name >= 60 && live3.odo === 3, `live scoreboard with 3: dolls ${Math.round(live3.doll)} px, names ${Math.round(live3.name)} px, odometer scores`, live3);
    await waitPhase(page, 'results', 30000);
    stop();
    await untilReveal(page, -1500);
    await shot(page, '20-results-suspense');
    await untilReveal(page, 5200);
    await shot(page, '21-ceremony');
    const cer = await page.evaluate(() => ({ name: document.querySelector('.sh-cer-name').textContent, line: document.querySelector('.sh-cer-line').textContent, prize: (document.querySelector('.sh-cer-prize .sh-prize-img') || {}).naturalWidth || 0, doll: !!document.querySelector('.sh-cer .sh-avatar--hero img'), stickers: document.querySelectorAll('.sh-cer .sh-burst').length }));
    check(cer.name.includes('נועה') && cer.line.includes('שימי אנג׳ל') && cer.prize > 0 && cer.doll && cer.stickers === 2, 'ceremony: the winner, the doll, the prize picture and two stickers', cer);
    await untilReveal(page, 10600 + 4200);
    await shot(page, '22-standings');
    await page.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
    await page.click('[data-testid=btn-primary]');
    await waitPhase(page, 'lobby');
    await sleep(1500);
    await shot(page, '30-lobby-between-3');
    check(await noScroll(page), 'lobby between rounds: the page does not scroll');

    // round 2: flappy with 12 (elimination: who is in the air, who is out, the finale)
    phones = phones.concat(await joinPhones(A.code, NAMES.slice(3, 12)));
    await waitChips(page, 12);
    await shot(page, '31-lobby-between-12');
    // players 0..3 crash at 1.6 s, 4..8 at 3.2 s (3 left: the finale is announced), 9..10 at 8.6 s
    stop = playRound(phones, (i, t) => {
      const outAt = i < 4 ? 1600 + i * 60 : i < 9 ? 3200 + i * 40 : i < 11 ? 8600 + i * 80 : Infinity;
      return t >= outAt ? { out: Math.round(outAt / 6) } : Math.round(t / 6);
    });
    await page.click('[data-testid=game-flappy]');
    await waitPhase(page, 'intro');
    await sleep(650);
    await shot(page, '32-intro-flappy');
    await waitPhase(page, 'playing');
    await page.waitForFunction(() => document.querySelectorAll('.sh-row.is-out').length >= 4, null, { timeout: 15000 });
    await sleep(500);
    await shot(page, '33-live-flappy-12');
    const fl = await page.evaluate(() => ({
      rows: document.querySelectorAll('.sh-row').length,
      inAir: document.querySelectorAll('.sh-row .sh-in-mark').length,
      out: document.querySelectorAll('.sh-row .sh-out-mark').length,
      scores: document.querySelectorAll('.sh-row .sh-score').length,
      tracks: document.querySelectorAll('.sh-row .sh-track').length,
      left: document.querySelector('.sh-left').getAttribute('data-left'),
      order: [...document.querySelectorAll('.sh-row')].sort((a, b) => Number(a.dataset.slot) - Number(b.dataset.slot)).map((r) => (r.classList.contains('is-out') ? 'x' : 'o')).join(''),
    }));
    check(fl.rows === 12 && fl.inAir + fl.out === 12 && fl.out >= 4 && fl.scores === 0 && fl.tracks === 0, 'flappy live: every row says "באוויר" or "בחוץ", no distance number, no bar', fl);
    check(Number(fl.left) === fl.inAir && /^o+x+$/.test(fl.order), 'flappy live: the counter is the number in the air; who is out sits under who is in', fl);
    await page.waitForFunction(() => {
      const f = document.querySelector('.sh-finale');
      return f && f.classList.contains('is-on') && f.classList.contains('is-counting');
    }, null, { timeout: 15000 });
    await sleep(450);
    await shot(page, '34-live-flappy-finale');
    const banner = await page.textContent('.sh-finale');
    check(/נשארו 3/.test(banner) && /[123]$/.test(banner.trim()), `flappy: the finale banner counts down (${banner.trim()})`);
    await page.waitForFunction(() => document.querySelector('.sh-playing').classList.contains('is-finale'), null, { timeout: 15000 }).catch(() => undefined);
    await sleep(500);
    await shot(page, '35-live-flappy-last-3');
    await waitPhase(page, 'results', 30000);
    stop();
    await untilReveal(page, -1500);
    await shot(page, '36-results-flappy-suspense');
    const fr = await page.evaluate(() => ({ rows: document.querySelectorAll('.sh-rrow.is-on').length, out: document.querySelectorAll('.sh-rrow.is-on .sh-out-mark').length, rawShown: [...document.querySelectorAll('.sh-rrow .sh-raw')].filter((e) => e.getBoundingClientRect().width > 0).length }));
    check(fr.rows >= 6 && fr.out === fr.rows && fr.rawShown === 0, 'flappy results: every revealed row says "בחוץ", the distance is not on screen', fr);
    await untilReveal(page, 5200);
    await shot(page, '37-ceremony-flappy');
    const fc = await page.textContent('.sh-cer-score');
    check(/באוויר/.test(fc) && !/\d/.test(fc), `flappy ceremony: no distance number (${fc.trim()})`);
    await untilReveal(page, 10600 + 4200);
    await shot(page, '38-standings-12');
    await page.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
    await page.click('[data-testid=btn-primary]');
    await waitPhase(page, 'lobby');
    await sleep(1200);

    // the podium (before_podium has no file: the placeholder card first)
    await page.click('[data-testid=btn-final]');
    await sleep(700);
    await shot(page, '39-armed-button');
    await page.click('[data-testid=btn-final]');
    await waitPhase(page, 'final');
    if ((await page.evaluate(() => window.__host.state().cutscene)) !== null) {
      await page.waitForSelector('[data-testid=cutscene-placeholder]', { timeout: 5000 }).catch(() => undefined);
      await sleep(700);
      await shot(page, '40-cutscene-placeholder');
      await waitCut(page, false, 12000);
    }
    await sleep(5600);
    await shot(page, '41-podium-third-second');
    await page.waitForSelector('.sh-champ', { timeout: 20000 });
    await sleep(2200);
    await shot(page, '42-podium-champion');
    const pod = await page.evaluate(() => ({ up: document.querySelectorAll('.sh-pod.is-up').length, dolls: document.querySelectorAll('.sh-pod .sh-avatar img').length, first: (document.querySelector('.sh-pod--1 .sh-avatar').getBoundingClientRect().height * 1080) / innerHeight, champ: (parseFloat(getComputedStyle(document.querySelector('.sh-champ-name')).fontSize) * 1080) / innerHeight }));
    check(pod.up === 3 && pod.dolls === 3 && pod.first >= 200 && pod.champ >= 130, `podium: three dolls up, the champion's doll ${Math.round(pod.first)} px, the name ${Math.round(pod.champ)} px`, pod);
    await page.waitForSelector('.sh-ftable', { timeout: 20000 });
    await sleep(1500);
    await shot(page, '43-podium-table');
    check(await noScroll(page), 'podium: the page does not scroll');
    closePhones(phones);
    phones = [];
    await page.context().close();

    // ───────── room B: 12 guests in a score round (icy), with a phone remote attached ─────────
    console.log(`[${sizeName}] room B`);
    const B = await openHost(browser, vp, errors);
    phones = await joinPhones(B.code, NAMES.slice(0, 12));
    await waitChips(B.page, 12);
    await shot(B.page, '50-lobby-12');
    stop = playRound(phones, (i, t) => (t / 100) * (16 - i) * (1 + 0.35 * Math.sin(t / 900 + i)));
    await B.page.click('[data-testid=game-icy]');
    await waitPhase(B.page, 'playing');
    await sleep(5200);
    await shot(B.page, '51-live-12');
    const live12 = await B.page.evaluate(() => {
      const rows = [...document.querySelectorAll('.sh-row')];
      const av = rows[0].querySelector('.sh-avatar').getBoundingClientRect();
      const nums = rows.sort((a, b) => Number(a.dataset.slot) - Number(b.dataset.slot)).map((r) => Number(r.querySelector('.sh-score').textContent.replace(/[^0-9]/g, '')));
      return { rows: rows.length, doll: (av.height * 1080) / innerHeight, name: (parseFloat(getComputedStyle(rows[0].querySelector('.sh-name')).fontSize) * 1080) / innerHeight, score: (parseFloat(getComputedStyle(rows[0].querySelector('.sh-score')).fontSize) * 1080) / innerHeight, ordered: nums.every((v, k) => k === 0 || v <= nums[k - 1] * 1.02 + 1) };
    });
    check(live12.rows === 12 && live12.doll >= 56 && live12.name >= 44 && live12.score >= 44 && live12.ordered, `live scoreboard with 12: dolls ${Math.round(live12.doll)} px, names ${Math.round(live12.name)} px, scores ${Math.round(live12.score)} px, in order`, live12);
    if (REMOTE_PW !== '') {
      const remote = io(SERVER, { transports: ['websocket'], forceNew: true });
      await new Promise((res, rej) => {
        remote.once('connect', res);
        remote.once('connect_error', rej);
      });
      const ack = await new Promise((res) => remote.emit('remote:attach', { code: B.code, password: REMOTE_PW }, res));
      check(ack.ok === true, 'a phone remote attaches to the room');
      await B.page.waitForFunction(() => window.__host.state().remotes > 0, null, { timeout: 8000 }).catch(() => undefined);
      await sleep(900);
      await shot(B.page, '52-live-12-remote');
      const strip = await B.page.evaluate(() => {
        const s = document.querySelector('[data-testid=strip]');
        const cs = getComputedStyle(s);
        return { display: document.querySelector('.hs-root').classList.contains('is-display'), hidden: cs.visibility === 'hidden' || Number(cs.opacity) === 0, stage: document.querySelector('.hs-stage').getBoundingClientRect().height, h: innerHeight };
      });
      check(strip.display && strip.hidden && Math.abs(strip.stage - strip.h) < 2, 'with a remote attached the TV hides its strip and the scene takes the whole screen', strip);
      await waitPhase(B.page, 'results', 30000);
      stop();
      await untilReveal(B.page, 5200);
      await shot(B.page, '53-ceremony-remote');
      remote.close();
      await B.page.waitForFunction(() => window.__host.state().remotes === 0, null, { timeout: 8000 }).catch(() => undefined);
    } else {
      console.log('  skip the remote shots: PARTY_REMOTE_PASSWORD is not set');
      await waitPhase(B.page, 'results', 30000);
      stop();
    }
    closePhones(phones);
    phones = [];
    await B.page.context().close();

    // ───────── room C: a full lobby: 24 guests on cards, 45 on pills ─────────
    console.log(`[${sizeName}] room C`);
    const C = await openHost(browser, vp, errors);
    phones = await joinPhones(C.code, NAMES.slice(0, 24));
    await waitChips(C.page, 24);
    await shot(C.page, '60-lobby-24');
    const l24 = await C.page.evaluate(() => {
      const box = document.querySelector('[data-testid=chips]');
      const av = document.querySelector('.hs-chip-av').getBoundingClientRect();
      return { fit: box.scrollHeight <= box.clientHeight + 1, doll: (av.width * 1080) / innerHeight, name: (parseFloat(getComputedStyle(document.querySelector('.hs-chip-name:not(.is-long):not(.is-xlong)')).fontSize) * 1080) / innerHeight, cards: box.classList.contains('is-cards') };
    });
    check(l24.fit && l24.cards && l24.doll >= 90 && l24.name >= 26, `24 guests fit as cards: dolls ${Math.round(l24.doll)} px, names ${Math.round(l24.name)} px`, l24);
    if (REMOTE_PW !== '') {
      const remote = io(SERVER, { transports: ['websocket'], forceNew: true });
      await new Promise((res) => remote.once('connect', res));
      await new Promise((res) => remote.emit('remote:attach', { code: C.code, password: REMOTE_PW }, res));
      await C.page.waitForFunction(() => window.__host.state().remotes > 0, null, { timeout: 8000 }).catch(() => undefined);
      await sleep(1200);
      await shot(C.page, '61-lobby-24-remote');
      remote.close();
      await C.page.waitForFunction(() => window.__host.state().remotes === 0, null, { timeout: 8000 }).catch(() => undefined);
    }
    phones = phones.concat(await joinPhones(C.code, NAMES.slice(24, 45)));
    await waitChips(C.page, 45);
    await shot(C.page, '62-lobby-45');
    const l45 = await C.page.evaluate(() => {
      const box = document.querySelector('[data-testid=chips]');
      return { fit: box.scrollHeight <= box.clientHeight + 1, pills: box.classList.contains('is-pills') };
    });
    check(l45.fit && l45.pills, '45 guests fit as pills', l45);
    check(await noScroll(C.page), 'full lobby: the page does not scroll');
    closePhones(phones);
    phones = [];
    await C.page.context().close();
  } catch (e) {
    console.error(e);
    failures.push(`[${sizeName}] rooms: ` + String(e && e.message).split('\n')[0]);
  } finally {
    stop();
    closePhones(phones);
  }
  check(errors.length === 0, `[${sizeName}] rooms: no console errors, no failed requests`, [...new Set(errors)].slice(0, 5));
}

async function demo(browser, sizeName, vp, shot) {
  const errors = [];
  const open = async (q) => {
    const page = await openPage(browser, vp, `${BASE}/show.html?bare=1&${q}`, errors);
    await page.waitForSelector('.sh-scene');
    return page;
  };
  const tasks = [
    async () => {
      const p = await open('players=12');
      await sleep(9000);
      await shot(p, '70-demo-race-12');
      await p.evaluate(() => window.__show.freeze(true));
      await sleep(700);
      await shot(p, '71-demo-race-frozen');
      await p.evaluate(() => {
        window.__show.freeze(false);
        window.__show.seek(52500);
      });
      await sleep(3000);
      await shot(p, '72-demo-race-last-seconds');
      await p.context().close();
    },
    async () => {
      const p = await open('players=3');
      await sleep(8000);
      await shot(p, '73-demo-race-3');
      await p.context().close();
    },
    async () => {
      const p = await open('players=45');
      await sleep(8000);
      await shot(p, '74-demo-race-45');
      await p.context().close();
    },
    async () => {
      const p = await open('players=12&game=flappy&dur=40000');
      await sleep(11000);
      await shot(p, '75-demo-flappy-12');
      await p.waitForFunction(() => {
        const f = document.querySelector('.sh-finale');
        return f && f.classList.contains('is-on') && f.classList.contains('is-counting');
      }, null, { timeout: 40000 });
      await sleep(600);
      await shot(p, '76-demo-flappy-finale');
      await p.context().close();
    },
    async () => {
      const p = await open('players=12&sim=0');
      const reveal = await p.evaluate(() => {
        window.__show.results('one', 8000);
        return Date.now() + 8000;
      });
      const at = (T) => p.waitForFunction((w) => Date.now() >= w, reveal + T, { polling: 30 });
      await at(-1200);
      await shot(p, '80-demo-suspense');
      await at(5400);
      await shot(p, '81-demo-ceremony');
      await at(10600 + 4600);
      await shot(p, '82-demo-standings');
      const r2 = await p.evaluate(() => {
        window.__show.results('none', 1200);
        return Date.now() + 1200;
      });
      await p.waitForFunction((w) => Date.now() >= w, r2 + 2600, { polling: 30 });
      await shot(p, '83-demo-nobody');
      await p.context().close();
    },
    async () => {
      const p = await open('players=12&sim=0&scene=final');
      await sleep(9600);
      await shot(p, '84-demo-podium-champion');
      await sleep(6400);
      await shot(p, '85-demo-podium-table');
      await p.context().close();
    },
    async () => {
      const p = await open('players=14&sim=0');
      await p.evaluate(() => window.__show.results('one', -60000));
      await sleep(300);
      await p.evaluate(() => window.__show.scene('standings'));
      await sleep(900);
      await shot(p, '86-demo-panel');
      await p.context().close();
    },
  ];
  // two at a time: the machine is shared
  for (let i = 0; i < tasks.length; i += 2) {
    await Promise.all(tasks.slice(i, i + 2).map((t) => t().catch((e) => failures.push(`[${sizeName}] demo: ` + String(e && e.message).split('\n')[0]))));
  }
  check(errors.length === 0, `[${sizeName}] demo page: no console errors, no failed requests`, [...new Set(errors)].slice(0, 5));
}

(async () => {
  const browser = await chromium.launch(MAP_HOST !== '' ? { args: [`--host-resolver-rules=MAP ${MAP_HOST} 127.0.0.1`] } : {});
  for (const [sizeName, vp] of SIZES) {
    const dir = path.join(__dirname, 'out', 'qa-tv-look', ...(TAG !== '' ? [TAG] : []), sizeName);
    fs.mkdirSync(dir, { recursive: true });
    const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.png`) });
    if (PARTS.includes('rooms')) await rooms(browser, sizeName, vp, shot);
    if (PARTS.includes('demo')) await demo(browser, sizeName, vp, shot);
  }
  await browser.close();
  console.log(failures.length === 0 ? '\nqa-tv-look: ALL OK' : `\nqa-tv-look: ${failures.length} FAILED\n  ` + failures.join('\n  '));
  process.exit(failures.length === 0 ? 0 : 1);
})();
