// QA of the phone's live place HUD (top of the game) and the "me bar" (bottom of every other screen).
//
//   PARTY_SERVER_PORT=8891 PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8891 PARTY_CLIENT_PORT=5301 npx vite
//   node tests/e2e/qa-hud.cjs [flow|games|perf] (default: flow)
//
//   flow   TV host page + 3 real phones (320x568, 390x844, 412x915) + ~10 bots, two rounds:
//          live place / count / chase text against the latest `scores` message every 300 ms,
//          ▲ on an overtake, the late joiner, a cutscene freeze, a reload mid-round, the me bar
//          against the TV standings between rounds, nothing new during the suspense (60 ms poll),
//          no page scroll, no me bar over a button, nothing under the home indicator. Screenshots.
//   games  all five games inside the real stage at 320x568, 360x640, 390x844 (full flow, bots
//          playing): mid-play screenshots, HUD bottom == ctx.hudHeight, Plotzel board + keyboard fit.
//   perf   ninja frame times under 4x CPU throttle on one phone with 29 playing bots (30 players).
//
// SERVER_URL / CLIENT_URL override http://localhost:8891 / http://localhost:5301.
process.env.SERVER_URL = process.env.SERVER_URL || 'http://localhost:8891';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5301';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
process.env.BASE_URL = process.env.BASE_URL || process.env.CLIENT_URL;
const L = require('./qa-phone-lib.cjs');
const TV = require('./qa-tv-lib.cjs');

const OUT = path.join(__dirname, 'out', 'qa-hud');
const ROOT = path.join(__dirname, '../..');
const MODE = process.argv[2] || 'flow';
const { check, done } = L.makeChecker(`hud-${MODE}`);
fs.mkdirSync(OUT, { recursive: true });

/** Bots that join `code` and play every round (tests/load/bots.ts --play). */
function spawnBots(code, n, prefix) {
  const child = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', L.SERVER, '--code', code, '--players', String(n), '--play', '--prefix', prefix, '--quiet'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  return {
    kill() {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    },
  };
}

async function waitPlayers(host, n, ms = 30000) {
  await L.waitFor(() => (host.state() && host.state().players.length >= n ? true : false), ms, `${n} players in the room`);
}


// ───────────────────────────── shared ─────────────────────────────

const IDLE_LINE = 'יאללה, לצבור נקודות!'; // client/src/play/hud-place.ts
const HUD_ROW_PX = 66; // client/src/play/stage.ts
const TV_NAME_BEAT_MS = 650; // client/src/player/app.tsx
const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const fmt = (n) => Math.round(n).toLocaleString('en-US');
function shortName(raw) {
  const n = raw.replace(/\s+/g, ' ').trim();
  if (n === '') return 'מישהו';
  const g = [...SEG.segment(n)].map((x) => x.segment);
  return g.length <= 12 ? n : `${g.slice(0, 11).join('').trimEnd()}…`;
}
/** Independent re-statement of the HUD rule: place = index + 1, chase = the one just ahead (or the next when first). */
function expectFrom(list, me, names) {
  const i = list.findIndex(([id]) => id === me);
  if (i < 0) return { place: null, ranked: null, chase: '' };
  const mine = list[i][1];
  const count = list.length;
  let chase = '';
  if (count > 1) {
    const r = list[i === 0 ? 1 : i - 1];
    if (mine > 0 || r[1] > 0) {
      const name = shortName(names[r[0]] || '');
      const gap = Math.max(0, i === 0 ? mine - r[1] : r[1] - mine);
      if (i === 0) chase = gap === 0 ? `מוביל/ה! ${name} צמוד/ה` : `מוביל/ה! +${fmt(gap)} על ${name}`;
      else chase = gap === 0 ? `צמוד ל־${name}!` : `עוד ${fmt(gap)} ל־${name}`;
    } else chase = IDLE_LINE;
  }
  return { place: i + 1, ranked: count, chase };
}
const LAG_MS = 700;
const sameHud = (e, d) => e.place === d.place && e.ranked === d.ranked && e.chase === d.chase;

const phoneDevice = (width, height) => ({ viewport: { width, height }, screen: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

/** One HUD sample of a phone (null fields when not in a round's stage). */
function sampleHud(page) {
  return page.evaluate(() => {
    const p = window.__player;
    const d = window.__playerPlay;
    const st = p && p.snap.state;
    const names = {};
    if (st) for (const pl of st.players) names[pl.id] = pl.name;
    const move = document.querySelector('.pa-place-move');
    return {
      now: performance.now(),
      screen: p ? p.screen : null,
      me: p ? p.snap.playerId : null,
      names,
      d: d
        ? {
            round: d.round,
            frozen: d.frozen,
            place: d.place,
            ranked: d.ranked,
            chase: d.chase,
            first: d.first,
            ups: d.ups,
            downs: d.downs,
            lastMove: d.lastMove,
            recent: d.recentScores,
            lastScores: d.lastScores,
            prevScores: d.prevScores,
            lastScoresAt: d.lastScoresAt,
            placeAt: d.placeAt,
            hudHeight: d.hudHeight,
          }
        : null,
      domPlace: document.querySelector('.pa-place-num') ? document.querySelector('.pa-place-num').textContent : null,
      domOf: document.querySelector('.pa-place-of') ? document.querySelector('.pa-place-of').textContent : null,
      domChase: document.querySelector('.pa-chase') ? document.querySelector('.pa-chase').textContent : null,
      domFirst: !!document.querySelector('.pa-place.is-first'),
      moveText: move ? move.textContent : null,
      hudBottom: document.querySelector('.pa-hud') ? document.querySelector('.pa-hud').getBoundingClientRect().bottom : null,
    };
  });
}

/** Tap Shimi's face (tap game, window.__tap) through CDP touch while `on()` holds. */
async function tapLoop(page, on, everyMs = 120) {
  const c = await L.cdp(page);
  let id = 5000;
  while (on()) {
    try {
      const t = await page.evaluate(() => (window.__tap ? window.__tap() : null));
      const fr = await page.evaluate(() => (window.__playerPlay ? window.__playerPlay.frozen : true));
      if (t && !fr && typeof t.x === 'number') {
        const pt = [{ x: t.x, y: t.y, id: id++, radiusX: 8, radiusY: 8, force: 1 }];
        await Promise.all([c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt }), c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })]);
      }
    } catch {}
    await L.sleep(everyMs);
  }
}

/**
 * Layout of the current screen against the me bar: page scroll, the tray over any button,
 * screen content hidden behind the tray (after clipping by its own scroll boxes), tray content
 * under the home indicator.
 */
function layoutCheck(page) {
  return page.evaluate(() => {
    const W = innerWidth;
    const H = innerHeight;
    const se = document.scrollingElement || document.documentElement;
    const out = { scroll: se.scrollHeight > H + 1 || se.scrollWidth > W + 1 || scrollX !== 0 || scrollY !== 0, bar: null, buttons: [], hidden: [], underHome: [], sab: 0 };
    const bar = document.querySelector('.pp-mebar.is-on');
    if (!bar) return out;
    const br = bar.getBoundingClientRect();
    const sab = parseFloat(getComputedStyle(bar).paddingBottom) || 0;
    out.sab = sab;
    out.bar = { top: Math.round(br.top), bottom: Math.round(br.bottom), h: Math.round(br.height) };
    const visible = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) < 0.05) return false;
      }
      return true;
    };
    const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    for (const b of document.querySelectorAll('button, input, a[href], [role=button]')) {
      if (bar.contains(b) || !visible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.width > 0 && hit(r, br)) out.buttons.push(`${b.className} ${Math.round(r.top)}..${Math.round(r.bottom)}`);
    }
    const decor = '.pp-confetti, .pp-rays, .pp-spot, .pp-me-glow, .pp-prize-shine, .pp-tv-legs, .pa-stage, .pp-play';
    const scopes = document.querySelectorAll('.pp-screen, .pp-cutscene, .pp-countdown, .pp-resume');
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll('*')) {
        if (el.closest(decor) || !visible(el)) continue;
        const leaf = el.children.length === 0 || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '') || /^(BUTTON|INPUT|IMG)$/.test(el.tagName);
        if (!leaf) continue;
        let r = el.getBoundingClientRect();
        let v = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        for (let n = el.parentElement; n && n !== scope.parentElement; n = n.parentElement) {
          const c = getComputedStyle(n);
          if (c.overflow !== 'visible' || c.overflowY !== 'visible') {
            const q = n.getBoundingClientRect();
            v = { left: Math.max(v.left, q.left), right: Math.min(v.right, q.right), top: Math.max(v.top, q.top), bottom: Math.min(v.bottom, q.bottom) };
          }
        }
        if (v.bottom - v.top <= 1 || v.right - v.left <= 1) continue;
        if (hit(v, br)) out.hidden.push(`${el.className || el.tagName}"${(el.textContent || '').trim().slice(0, 14)}" ${Math.round(v.top)}..${Math.round(v.bottom)}`);
      }
    }
    for (const ch of bar.querySelectorAll('*')) {
      if (!visible(ch) || ch.closest('.pp-mb-move')) continue;
      const r = ch.getBoundingClientRect();
      if (r.height > 0 && r.bottom > H - sab + 0.5) out.underHome.push(`${ch.className} ${Math.round(r.bottom)} > ${H - sab}`);
    }
    if (Math.abs(br.bottom - H) > 1) out.underHome.push(`tray bottom ${br.bottom} != ${H}`);
    return out;
  });
}

async function shotAndLayout(page, label, opts = {}) {
  const file = path.join(OUT, `${page.__name}-${label}.png`);
  await page.screenshot({ path: file });
  const a = await layoutCheck(page);
  const n = `${page.__name}/${label}`;
  check(!a.scroll, `${n}: no page scroll`);
  const sc = await L.screen(page);
  if (opts.bar !== false && sc !== 'playing') check(a.bar !== null, `${n}: the me bar is on (${sc})`);
  check(a.buttons.length === 0, `${n}: the me bar covers no button ${a.buttons.join(' | ')}`);
  check(a.hidden.length === 0, `${n}: nothing of the screen is hidden behind the me bar ${a.hidden.slice(0, 4).join(' | ')}`);
  check(a.underHome.length === 0, `${n}: nothing of the me bar under the home indicator (inset ${a.sab}px) ${a.underHome.join(' | ')}`);
  return file;
}

function meBarRead(page) {
  return page.evaluate(() => {
    const p = window.__player;
    const el = document.querySelector('.pp-mebar');
    return {
      screen: p ? p.screen : null,
      now: p ? p.now() : 0,
      me: p ? p.snap.playerId : null,
      bar: p ? p.meBar : null,
      dom: el
        ? { on: el.classList.contains('is-on'), rank: el.dataset.rank, count: el.dataset.count, total: el.dataset.total, ready: !!el.querySelector('.pp-mb-ready'), text: el.textContent }
        : null,
      players: p && p.snap.state ? p.snap.state.players.map((x) => ({ id: x.id, rank: x.rank, total: x.total })) : [],
    };
  });
}

// ───────────────────────────── flow ─────────────────────────────

const BOT_NAMES = ['דנה', 'Mike 🎸', 'רון', '🦄 יוני', 'Tal', 'אביגיל', 'Omer K', 'מאיה', 'בן', 'אלכסנדר מגדול'];

function clearShots(keep) {
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png') && !keep(f)) fs.unlinkSync(path.join(OUT, f));
}

async function flow() {
  clearShots((f) => f.startsWith('game-'));
  const browser = await L.launch();
  let bots = null;
  let host = null;
  let tv = null;
  const phones = [];
  const stats = { samples: 0, ok: 0, viaPrev: 0, frozenSamples: 0, mismatches: [], stale: 0 };
  let sampling = false;
  try {
    // ── the TV and a second host socket on the same room (the test drives it) ──
    tv = await TV.openHost(browser, { viewport: { width: 1280, height: 720 } });
    const code = tv.code;
    const hostKey = await tv.page.evaluate(() => localStorage.getItem('party.host.key'));
    host = L.createHost();
    await host.call('host:create', { code, hostKey });
    check(host.state() === null || host.state().code === code, `test host attached to the TV's room ${code}`);
    await host.call('host:setAutoCutscenes', { enabled: false });
    const tvState = () => tv.page.evaluate(() => window.__host.state());

    // ── phones: A 320 (plays round 1), C 412 (reloads in round 2), B 390 joins late (plays round 2) ──
    const A = await L.openPhone(browser, 'a320', phoneDevice(320, 568), {}, check);
    const B = await L.openPhone(browser, 'b390', phoneDevice(390, 844), {}, check);
    const C = await L.openPhone(browser, 'c412', phoneDevice(412, 915), {}, check);
    const safe = await L.setSafeArea(B, 47, 34);
    console.log(`  (b390 safe-area emulation: ${safe ? 'top 47 / bottom 34' : 'not supported by this Chromium'})`);
    phones.push(A, B, C);
    await L.join(A, code, 'שירה 🎉');
    await L.join(C, code, 'Noam');
    bots = await TV.scriptedPhones(code, BOT_NAMES, (i, elapsed) => Math.floor((elapsed / 1000) * (0.5 + 0.3 * i)));
    await L.waitFor(async () => (await meBarRead(A)).players.length >= 12, 10000, '12 players');
    await L.sleep(600);
    for (const p of [A, C]) {
      const m = await meBarRead(p);
      check(m.bar && m.bar.visible && m.bar.place === null && m.dom.ready, `${p.__name}/lobby: before the first round the me bar says "מוכנים?" (no place)`, m.bar);
      await shotAndLayout(p, 'mebar-lobby');
    }

    // ── sampler: every 300 ms on every phone while a stage is up ──
    const phoneState = new Map(phones.map((p) => [p, { freezePlace: undefined, ups: 0, downs: 0, shots: new Set(), placeSeen: false }]));
    async function sampleOnce(p) {
      const ps = phoneState.get(p);
      let s;
      try {
        s = await sampleHud(p);
      } catch {
        return;
      }
      if (!s.d || s.screen !== 'playing' && s.screen !== 'countdown') return;
      const d = s.d;
      stats.samples++;
      if (d.frozen) {
        stats.frozenSamples++;
        if (ps.freezePlace === undefined) ps.freezePlace = { place: d.place, ranked: d.ranked, chase: d.chase };
        else if (ps.freezePlace.place !== d.place || ps.freezePlace.chase !== d.chase) stats.mismatches.push(`${p.__name} frozen: place ${ps.freezePlace.place} -> ${d.place}`);
        return;
      }
      ps.freezePlace = undefined;
      const exp = d.lastScores ? expectFrom(d.lastScores, s.me, s.names) : { place: null, ranked: null, chase: '' };
      let ok = sameHud(exp, d);
      // The HUD paints at most every 250 ms, so a message younger than that may still be pending
      // (and a busy main thread can delay that timer). Accept an older message only while the
      // one that replaced it is younger than LAG_MS.
      if (!ok && d.recent && d.recent.length > 1) {
        for (let k = d.recent.length - 2; k >= 0; k--) {
          if (s.now - d.recent[k + 1].at >= LAG_MS) break;
          if (sameHud(expectFrom(d.recent[k].scores, s.me, s.names), d)) {
            ok = true;
            stats.viaPrev++;
            break;
          }
        }
      }
      if (!d.lastScores && d.place !== null) stats.stale++;
      // what the DOM says must be what the hook says
      const domOk = (d.place === null ? s.domPlace === '–' : s.domPlace === String(d.place)) && (d.ranked === null ? s.domOf === '' : s.domOf === `/${d.ranked}`) && s.domChase === d.chase && s.domFirst === d.first;
      if (ok && domOk) stats.ok++;
      else stats.mismatches.push(`${p.__name} r${d.round}: hud ${d.place}/${d.ranked} "${d.chase}" expected ${exp.place}/${exp.ranked} "${exp.chase}" dom ${s.domPlace}${s.domOf} "${s.domChase}" age ${Math.round(s.now - d.lastScoresAt)}ms`);
      if (d.place !== null) ps.placeSeen = true;
      if (d.hudHeight > 0 && !ps.hudChecked) {
        ps.hudChecked = true;
        check(Math.abs(s.hudBottom - d.hudHeight) <= 0.5, `${p.__name}: HUD bottom ${s.hudBottom} == ctx.hudHeight ${d.hudHeight}`);
      }
      // screenshots of the states
      const w = p.__name.slice(1);
      const snap = async (label) => {
        if (ps.shots.has(label)) return;
        ps.shots.add(label);
        await p.screenshot({ path: path.join(OUT, `hud-${label}-${w}.png`) });
      };
      if (d.ups > ps.ups) {
        ps.ups = d.ups;
        if (d.lastMove === 'up') {
          check(s.moveText === '▲', `${p.__name}: moving up shows ▲ (${s.moveText})`);
          await snap('up');
        }
      }
      if (d.downs > ps.downs) {
        ps.downs = d.downs;
        if (d.lastMove === 'down') {
          check(s.moveText === '▼', `${p.__name}: being overtaken shows ▼ (${s.moveText})`);
          await snap('overtaken');
        }
      }
      if (d.first && d.ranked > 1 && /^מוביל/.test(d.chase)) await snap('first');
      if (d.place > 1 && d.place < d.ranked && /^עוד /.test(d.chase)) await snap('midpack');
    }
    async function sampler() {
      while (sampling) {
        const t0 = Date.now();
        await Promise.all(phones.filter((p) => !p.__reloading).map(sampleOnce));
        await L.sleep(Math.max(0, 300 - (Date.now() - t0)));
      }
    }

    /** Me bar during the results phase: the pre-round standing until revealAt (+ the TV's name beat), polled every 60 ms. */
    async function watchSuspense(pre, label) {
      const st = await L.waitFor(() => (host.state() && host.state().phase === 'results' ? host.state() : null), 60000, 'results phase');
      const revealAt = st.results.revealAt + TV_NAME_BEAT_MS;
      let polls = 0;
      const bad = [];
      const early = [];
      let suspenseShot = new Set();
      let sendingShot = new Set();
      for (;;) {
        const t0 = Date.now();
        const reads = await Promise.all(phones.map((p) => meBarRead(p).then((m) => [p, m]).catch(() => [p, null])));
        let allPast = true;
        for (const [p, m] of reads) {
          if (!m) continue;
          polls++;
          const hold = m.screen === 'sending' || m.screen === 'suspense';
          const want = pre.get(m.me) || { rank: null, total: null };
          if (hold) {
            allPast = false;
            const shownRank = m.bar.place;
            const shownTotal = m.bar.total;
            const domRank = m.dom && m.dom.rank !== '' ? Number(m.dom.rank) : null;
            const domTotal = m.dom && m.dom.total !== '' ? Number(m.dom.total) : null;
            if (shownRank !== want.rank || shownTotal !== want.total || domRank !== want.rank || domTotal !== want.total) bad.push(`${p.__name} ${m.screen}: shows ${shownRank}/${shownTotal} (dom ${domRank}/${domTotal}), before the round ${want.rank}/${want.total}`);
            if (m.screen === 'suspense' && !suspenseShot.has(p)) {
              suspenseShot.add(p);
              await shotAndLayout(p, `mebar-suspense-${label}`);
            }
            if (m.screen === 'sending' && !sendingShot.has(p)) {
              sendingShot.add(p);
              await shotAndLayout(p, `mebar-sending-${label}`);
            }
          } else if (['win', 'reveal', 'results'].includes(m.screen) && m.now < revealAt - 60) early.push(`${p.__name} ${m.screen} ${Math.round(revealAt - m.now)}ms early`);
          if (m.now < revealAt + 300) allPast = false;
        }
        if (allPast) break;
        await L.sleep(Math.max(0, 60 - (Date.now() - t0)));
      }
      check(bad.length === 0, `${label}: during sending / suspense every me bar keeps the standing from before the round (${polls} polls at 60 ms) ${bad.slice(0, 3).join(' | ')}`);
      check(early.length === 0, `${label}: no phone shows the round's outcome before revealAt ${early.slice(0, 3).join(' | ')}`);
    }

    async function standingsMatchTv(label) {
      const tst = await tvState();
      const byId = new Map(tst.players.map((x) => [x.id, x]));
      for (const p of phones) {
        await L.waitFor(async () => {
          const m = await meBarRead(p);
          return m.bar && m.bar.visible && m.bar.hidingRound === false;
        }, 10000, `${p.__name} me bar`).catch(() => {});
        await L.sleep(1600); // the count-up / roll animations finish
        const m = await meBarRead(p);
        const tvp = byId.get(m.me);
        const domOk = m.dom && Number(m.dom.rank) === tvp.rank && Number(m.dom.total) === tvp.total && Number(m.dom.count) === tst.players.length;
        check(tvp && m.bar.place === tvp.rank && m.bar.total === tvp.total && m.bar.count === tst.players.length && domOk, `${p.__name}/${label}: me bar = TV standings (place ${m.bar.place}/${m.bar.count}, total ${m.bar.total}; TV ${tvp && tvp.rank}/${tst.players.length}, ${tvp && tvp.total})`);
        const txt = m.dom ? m.dom.text : '';
        check(txt.includes(`מתוך ${tst.players.length}`) && txt.includes(fmt(tvp.total)), `${p.__name}/${label}: me bar reads "מקום ${tvp.rank} מתוך ${tst.players.length}" and ${fmt(tvp.total)} (${txt})`);
      }
    }

    // ═════════ round 1: tap. A plays, C idles, B joins late; a cutscene mid-round ═════════
    let r1 = true;
    await host.call('host:start', { gameId: 'tap' });
    await L.waitScreen(A, 'intro', 15000);
    await L.sleep(300);
    await Promise.all([A, C].map((p) => shotAndLayout(p, 'mebar-intro-r1')));
    await L.waitScreen(A, 'countdown', 15000);
    await L.sleep(250);
    await Promise.all([A, C].map((p) => shotAndLayout(p, 'mebar-countdown-r1')));
    await L.waitScreen(A, 'playing', 15000);
    sampling = true;
    const samplerDone = sampler();
    // the late joiner
    await L.join(B, code, 'Late לייט');
    await L.sleep(500);
    {
      const s = await sampleHud(B);
      check(s.screen === 'late' && s.d === null, `b390 joined mid-round: late screen, no live place (${s.screen}, ${JSON.stringify(s.d && s.d.place)})`);
      const m = await meBarRead(B);
      check(m.bar.visible && m.bar.place === null, `b390/late: the me bar has no place in a round it does not play`);
      await shotAndLayout(B, 'hud-latejoiner');
      fs.copyFileSync(path.join(OUT, 'b390-hud-latejoiner.png'), path.join(OUT, 'hud-latejoiner-390.png'));
    }
    const tapA = tapLoop(A, () => r1, 130);
    // freeze by a cutscene in the middle
    await L.sleep(7000);
    const before = await sampleHud(A);
    await host.call('host:cutscene', { id: 'joker_1' });
    await L.waitFor(async () => (await sampleHud(A)).d.frozen, 5000, 'frozen');
    const frozen0 = await Promise.all([A, C].map(sampleHud));
    await L.sleep(400);
    for (const p of [A, C, B]) await shotAndLayout(p, 'mebar-cutscene');
    await L.sleep(1800);
    const frozen1 = await Promise.all([A, C].map(sampleHud));
    for (let i = 0; i < 2; i++) {
      check(frozen0[i].d.place === frozen1[i].d.place && frozen0[i].d.chase === frozen1[i].d.chase && frozen1[i].domPlace === frozen0[i].domPlace, `${[A, C][i].__name}: the cutscene keeps the place (${frozen0[i].d.place} → ${frozen1[i].d.place}, "${frozen1[i].d.chase}")`);
    }
    console.log(`  (A before the cutscene: place ${before.d.place}/${before.d.ranked})`);
    await L.waitFor(() => host.state().cutscene === null, 15000, 'cutscene over');
    await L.waitFor(async () => !(await sampleHud(A)).d.frozen, 8000, 'resumed');
    // play on to the end
    await L.waitFor(async () => ['sending', 'suspense'].includes(await L.screen(A)), 40000, 'A round over');
    r1 = false;
    await tapA;
    sampling = false;
    await samplerDone;
    const aEnd = phoneState.get(A);
    check(aEnd.ups > 0, `a320: overtaking shows ▲ (${aEnd.ups} times)`);
    check(phoneState.get(C).downs > 0, `c412: being overtaken shows ▼ (${phoneState.get(C).downs} times)`);
    check(phoneState.get(A).placeSeen && phoneState.get(C).placeSeen, 'a320 / c412 showed a live place');
    // round 1 suspense: nobody had a standing before it
    await watchSuspense(new Map(), 'r1');
    // the moment (win / reveal) and then the results
    for (const p of phones) {
      const sc = await L.screen(p);
      if (sc === 'win' || sc === 'reveal') await shotAndLayout(p, `mebar-${sc}-r1`);
    }
    await Promise.all(phones.map((p) => L.waitScreen(p, 'results', 20000).catch(() => {})));
    // the winner taps through the WIN moment like a person would
    await L.sleep(1800);
    for (const p of phones) await shotAndLayout(p, 'mebar-results-r1');
    await standingsMatchTv('results-r1');

    // ═════════ between rounds ═════════
    await host.call('host:lobby', {});
    await Promise.all(phones.map((p) => L.waitScreen(p, 'lobby', 10000)));
    await L.sleep(500);
    await standingsMatchTv('between');
    for (const p of phones) await shotAndLayout(p, 'mebar-between');
    const tvBefore = await tvState();
    const pre = new Map(tvBefore.players.map((x) => [x.id, { rank: x.rank, total: x.total }]));

    // ═════════ round 2: tap. B plays (and overtakes A), C reloads mid-round ═════════
    let r2 = true;
    for (const p of phones) phoneState.get(p).shots = new Set([...phoneState.get(p).shots].filter((x) => x !== 'midpack' && x !== 'overtaken' && x !== 'first' && x !== 'up'));
    for (const p of phones) Object.assign(phoneState.get(p), { ups: 0, downs: 0, placeSeen: false, hudChecked: false });
    await host.call('host:start', { gameId: 'tap' });
    await L.waitScreen(B, 'intro', 15000);
    await L.sleep(300);
    await Promise.all(phones.map((p) => shotAndLayout(p, 'mebar-intro-r2')));
    await L.waitScreen(B, 'playing', 15000);
    sampling = true;
    const sampler2 = sampler();
    const tapB = tapLoop(B, () => r2, 120);
    // A plays a little at first (so B has someone to overtake), then stops
    let aPlays = true;
    const tapA2 = tapLoop(A, () => aPlays && r2, 200);
    setTimeout(() => (aPlays = false), 4000);
    await L.sleep(5500);
    // reload mid-round
    C.__reloading = true;
    await C.reload();
    await L.waitScreen(C, 'playing', 15000);
    const tReload = Date.now();
    let restored = null;
    let staleSeen = false;
    while (Date.now() - tReload < 4000) {
      const s = await sampleHud(C);
      if (s.d && s.d.place !== null) {
        if (!s.d.lastScores) staleSeen = true;
        restored = s;
        break;
      }
      await L.sleep(50);
    }
    C.__reloading = false;
    check(!staleSeen, 'c412: after the reload no place is shown before a scores message arrived');
    check(restored !== null, `c412: the place is back ${restored ? Date.now() - tReload : '>4000'} ms after the reload`);
    if (restored) {
      const e = expectFrom(restored.d.lastScores, restored.me, restored.names);
      check(sameHud(e, restored.d), `c412: the restored place matches the latest scores (${restored.d.place}/${restored.d.ranked} vs ${e.place}/${e.ranked})`);
      await C.screenshot({ path: path.join(OUT, 'hud-reloaded-412.png') });
    }
    await L.waitFor(async () => ['sending', 'suspense'].includes(await L.screen(B)), 40000, 'B round over');
    r2 = false;
    await Promise.all([tapB, tapA2]);
    sampling = false;
    await sampler2;
    check(phoneState.get(B).placeSeen, 'b390 (late in round 1) shows a place in round 2');
    check(phoneState.get(B).ups > 0, `b390: overtaking shows ▲ (${phoneState.get(B).ups})`);
    check(phoneState.get(A).downs > 0, `a320: overtaken in round 2 shows ▼ (${phoneState.get(A).downs})`);
    await watchSuspense(pre, 'r2');
    await Promise.all(phones.map((p) => L.waitScreen(p, 'results', 25000).catch(() => {})));
    await L.sleep(1500);
    for (const p of phones) await shotAndLayout(p, 'mebar-results-r2');
    await standingsMatchTv('results-r2');

    // ═════════ final ═════════
    await host.call('host:final', {});
    await Promise.all(phones.map((p) => L.waitScreen(p, 'final', 15000)));
    await L.waitFor(async () => (await tvState()).cutscene === null, 15000, 'no cutscene').catch(() => {});
    await L.sleep(2200);
    await standingsMatchTv('final');
    for (const p of phones) await shotAndLayout(p, 'mebar-final');

    console.log(`  sampler: ${stats.samples} samples, ${stats.ok} exact (${stats.viaPrev} via the message just before), ${stats.frozenSamples} frozen, ${stats.mismatches.length} mismatches, ${stats.stale} stale`);
    for (const m of stats.mismatches.slice(0, 12)) console.log('   ', m);
    const live = stats.samples - stats.frozenSamples;
    check(live > 50, `sampled the HUD ${live} times while live`);
    check(stats.mismatches.length === 0, `every sample: HUD place / count / chase == the phone's latest scores message (${stats.mismatches.length} of ${stats.samples} off)`);
    check(stats.stale === 0, 'never a place without a scores message of this round');
    for (const p of phones) check(p.__errors.length === 0, `${p.__name}: no page errors ${p.__errors.join(' | ')}`);
    const shots = ['up', 'overtaken', 'first', 'midpack'];
    for (const p of phones) console.log(`  ${p.__name} HUD shots: ${[...phoneState.get(p).shots].join(', ')}`);
    void shots;
  } catch (err) {
    check(false, 'flow: ' + err.message);
    console.error(err);
  } finally {
    sampling = false;
    if (bots) bots.stop();
    if (host) host.close();
    await browser.close();
  }
}

// ───────────────────────────── games ─────────────────────────────

async function games() {
  clearShots((f) => !f.startsWith('game-'));
  const browser = await L.launch();
  const host = L.createHost();
  let bots = null;
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    const sizes = [
      [320, 568],
      [360, 640],
      [390, 844],
    ];
    const phones = [];
    for (const [w, h] of sizes) {
      const p = await L.openPhone(browser, `g${w}`, phoneDevice(w, h), {}, check);
      await L.join(p, code, `Gamer ${w}`);
      phones.push(p);
    }
    bots = await TV.scriptedPhones(code, BOT_NAMES.slice(0, 5), (i, elapsed) => Math.floor((elapsed / 1000) * (2 + 3 * i)));
    for (const gameId of ['tap', 'icy', 'flappy', 'plotzel', 'ninja']) {
      await host.call('host:start', { gameId });
      await Promise.all(phones.map((p) => L.waitScreen(p, 'playing', 20000)));
      await L.sleep(4500);
      for (const p of phones) {
        const file = path.join(OUT, `game-${gameId}-${p.__name.slice(1)}.png`);
        await p.screenshot({ path: file });
        const g = await p.evaluate((id) => {
          const H = innerHeight;
          const W = innerWidth;
          const d = window.__playerPlay;
          const hud = document.querySelector('.pa-hud').getBoundingClientRect();
          const se = document.scrollingElement || document.documentElement;
          const out = { hudBottom: hud.bottom, hudHeight: d ? d.hudHeight : null, place: d ? d.place : null, chase: d ? d.chase : '', scroll: se.scrollHeight > H + 1 || se.scrollWidth > W + 1, bad: [], kb: null, board: null };
          const chase = document.querySelector('.pa-chase');
          out.chaseFits = chase ? chase.scrollWidth <= chase.clientWidth + 1 : true;
          out.chaseLines = chase ? Math.round(chase.getBoundingClientRect().height) : 0;
          if (id === 'plotzel') {
            const r = (sel) => {
              const e = document.querySelector(sel);
              if (!e) return null;
              const q = e.getBoundingClientRect();
              return { top: Math.round(q.top), bottom: Math.round(q.bottom), left: Math.round(q.left), right: Math.round(q.right) };
            };
            out.board = r('.pz-board');
            out.kb = r('.pz-kb');
            out.head = r('.pz-head');
            out.tools = r('.pz-tools');
            for (const el of document.querySelectorAll('.pz-head *, .pz-board *, .pz-kb *, .pz-tools *')) {
              const q = el.getBoundingClientRect();
              if (q.width === 0 || q.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
              if (q.top < hud.bottom - 0.5 || q.bottom > H + 0.5 || q.left < -0.5 || q.right > W + 0.5) out.bad.push(`${el.className} ${Math.round(q.top)}..${Math.round(q.bottom)}`);
            }
          }
          return out;
        }, gameId);
        const n = `${gameId}@${p.__name.slice(1)}`;
        check(Math.abs(g.hudBottom - g.hudHeight) <= 0.5, `${n}: HUD bottom ${g.hudBottom} == ctx.hudHeight ${g.hudHeight} (${HUD_ROW_PX} + safe top)`);
        check(!g.scroll, `${n}: no page scroll`);
        check(g.place !== null, `${n}: live place shown (${g.place}, "${g.chase}")`);
        check(g.chaseFits && g.chaseLines <= 17, `${n}: the chase line is one line and not cut ("${g.chase}")`);
        if (gameId === 'plotzel') {
          check(g.bad.length === 0, `${n}: Plotzel head / board / keyboard / tools all between the HUD and the bottom (${g.bad.slice(0, 3).join(' | ')}) board ${JSON.stringify(g.board)} kb ${JSON.stringify(g.kb)}`);
        }
      }
      await host.call('host:endRound', {});
      await L.waitFor(() => host.state().phase === 'results', 15000, 'results');
      await L.sleep(500);
    }
    for (const p of phones) check(p.__errors.length === 0, `${p.__name}: no page errors ${p.__errors.join(' | ')}`);
  } catch (err) {
    check(false, 'games: ' + err.message);
    console.error(err);
  } finally {
    if (bots) bots.stop();
    host.close();
    await browser.close();
  }
}

// ───────────────────────────── perf ─────────────────────────────

async function perf() {
  const browser = await L.launch();
  const host = L.createHost();
  let bots = null;
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    const initScript = process.env.PERF_NOANIM
      ? () => {
          const orig = Element.prototype.animate;
          Element.prototype.animate = function (...a) {
            if (this.closest && this.closest('.pa-place')) return { cancel() {}, finish() {} };
            return orig.apply(this, a);
          };
        }
      : undefined;
    const p = await L.openPhone(browser, 'perf390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, initScript ? { initScript } : {}, check);
    await L.join(p, code, 'מודד');
    bots = spawnBots(code, 29, 'בוט');
    await waitPlayers(host, 30);
    const c = await L.cdp(p);
    await c.send('Performance.enable');
    await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const runs = [];
    for (let round = 0; round < Number(process.env.PERF_ROUNDS || 2); round++) {
      await host.call('host:start', { gameId: 'ninja' });
      await L.waitScreen(p, 'playing', 30000);
      await L.sleep(2500);
      const m0 = await c.send('Performance.getMetrics');
      const frames = await p.evaluate(
        (ms) =>
          new Promise((resolve) => {
            const out = [];
            const hudFrames = [];
            const otherFrames = [];
            let last = performance.now();
            const t0 = last;
            let updates = 0;
            const hook = window.__playerPlay;
            let seen = hook && hook.scoresMsgs !== undefined ? hook.scoresMsgs : null;
            let painted = hook && hook.placeAt !== undefined ? hook.placeAt : null;
            let afterPaint = 0;
            function f(t) {
              const dt = t - last;
              out.push(dt);
              last = t;
              // frames right after a HUD repaint (this one and the next) vs all the others
              if (afterPaint > 0) {
                hudFrames.push(dt);
                afterPaint--;
              } else otherFrames.push(dt);
              const h = window.__playerPlay;
              if (seen !== null && h && h.scoresMsgs !== seen) {
                updates++;
                seen = h.scoresMsgs;
              }
              if (painted !== null && h && h.placeAt !== painted) {
                painted = h.placeAt;
                afterPaint = 2;
              }
              if (t - t0 < ms) requestAnimationFrame(f);
              else resolve({ out, updates, hudFrames, otherFrames });
            }
            requestAnimationFrame(f);
          }),
        10000,
      );
      const m1 = await c.send('Performance.getMetrics');
      const mv = (m, k) => (m.metrics.find((x) => x.name === k) || { value: 0 }).value;
      const d = (k) => mv(m1, k) - mv(m0, k);
      const sorted = [...frames.out].sort((a, b) => a - b);
      const q = (x) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))];
      const mean = frames.out.reduce((a, b) => a + b, 0) / frames.out.length;
      const r = {
        frames: frames.out.length,
        meanMs: +mean.toFixed(2),
        p50: +q(0.5).toFixed(2),
        p95: +q(0.95).toFixed(2),
        p99: +q(0.99).toFixed(2),
        over33: frames.out.filter((x) => x > 33.4).length,
        layouts: d('LayoutCount'),
        layoutMs: +(d('LayoutDuration') * 1000).toFixed(1),
        styleRecalcs: d('RecalcStyleCount'),
        styleMs: +(d('RecalcStyleDuration') * 1000).toFixed(1),
        scriptMs: +(d('ScriptDuration') * 1000).toFixed(1),
        hudUpdatesSeen: frames.updates,
        afterHudPaintMeanMs: frames.hudFrames.length ? +(frames.hudFrames.reduce((a, b) => a + b, 0) / frames.hudFrames.length).toFixed(2) : null,
        afterHudPaintOver33: frames.hudFrames.filter((x) => x > 33.4).length,
        afterHudPaintFrames: frames.hudFrames.length,
        otherMeanMs: +(frames.otherFrames.reduce((a, b) => a + b, 0) / Math.max(1, frames.otherFrames.length)).toFixed(2),
        otherOver33Pct: +((100 * frames.otherFrames.filter((x) => x > 33.4).length) / Math.max(1, frames.otherFrames.length)).toFixed(1),
      };
      console.log(`[perf] round ${round + 1}:`, JSON.stringify(r));
      runs.push(r);
      await host.call('host:endRound', {});
      await L.waitFor(() => host.state().phase === 'results', 10000, 'results');
      await L.sleep(1000);
    }
    fs.writeFileSync(path.join(OUT, `perf-${process.env.PERF_TAG || 'run'}.json`), JSON.stringify(runs, null, 2));
  } catch (err) {
    check(false, 'perf: ' + err.message);
    console.error(err);
  } finally {
    if (bots) bots.kill();
    host.close();
    await browser.close();
  }
}

(async () => {
  if (MODE === 'perf') await perf();
  else if (MODE === 'games') await games();
  else if (MODE === 'flow') await flow();
  else throw new Error('unknown mode ' + MODE);
  process.exit(done() ? 1 : 0);
})();
