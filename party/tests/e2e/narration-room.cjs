// narration-room: a real room (the TV + 3 phone pages) through one game to the podium, checking the hosts'
// narration on the TV: every moment fires once, never two bubbles at once (hosts or commentator), nothing
// during a cutscene, nothing important covered (rows, timer, QR, room code, names, 3-2-1, instructions),
// no console errors. Screenshots of the hosts narrating go to tests/e2e/out/host-poses/room-<w>x<h>/.
//
// Needs a server with the REAL intro and countdown (no PARTY_TEST_FAST) and short rounds:
//   PORT=8879 PARTY_TEST_DURATION_MS=40000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8879 PARTY_CLIENT_PORT=5279 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   BASE_URL=http://localhost:5279 node tests/e2e/narration-room.cjs [1920x1080|1280x720]
// The game is tap (it has the automatic mid-round cutscene). Phones 1 and 2 tap; phone 3 waits, so the
// round runs its whole length (a tap round ends early once everybody has finished).
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'http://localhost:5279').replace(/\/+$/, '');
const [W, H] = (process.argv[2] || '1920x1080').split('x').map(Number);
const OUT = path.join(__dirname, 'out', 'host-poses', `room-${W}x${H}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg, extra) => {
  console.log(ok ? '  ok  ' : '  FAIL', msg, !ok && extra !== undefined ? JSON.stringify(extra).slice(0, 700) : '');
  if (!ok) failures.push(msg);
  return ok;
};

/** In the TV page: every 100 ms, what is on screen (the hosts, the commentator, the cutscene) and what the hosts cover. */
function installSampler() {
  const PROTECTED = [
    ['.sh-row .sh-row-in', 'race row'],
    ['.sh-ring', 'timer'],
    ['.sh-left', 'left in the air'],
    ['.sh-finale.is-on', 'finale 3-2-1'],
    ['[data-testid=countdown-num]', '3-2-1'],
    ['.hs-resume-card', 'resume 3-2-1'],
    ['[data-testid=qr]', 'QR'],
    ['[data-testid=qr-designed]', 'QR'],
    ['[data-testid=room-code]', 'room code'],
    ['[data-testid=join-url]', 'join link'],
    ['[data-testid=chip]', 'guest'],
    ['.hs-intro-title', 'game title'],
    ['.hs-intro-text', 'instructions'],
    ['.sh-rrow.is-on', 'results row'],
    ['.sh-mystery', 'who wins sign'],
    ['.sh-trow:not(.is-hidden) .sh-trow-in', 'standings row'],
    ['.sh-banner', 'winner banner'],
    ['.sh-cer-name', "winner's name"],
    ['.sh-cer-won', "winner's doll and line"],
    ['.sh-champ-name', "champion's name"],
    ['.sh-pod-who', 'podium name'],
    ['.sh-ftable', 'final table'],
  ];
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
    return r;
  };
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 4 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4;
  /** The picture as drawn (object-fit: contain, bottom-centred), not its whole box. */
  const drawn = (img) => {
    const r = img.getBoundingClientRect();
    if (!img.naturalWidth || !img.naturalHeight) return r;
    const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    const left = r.left + (r.width - w) / 2;
    return { left, right: left + w, top: r.bottom - h, bottom: r.bottom };
  };
  const firstSeen = new WeakMap();
  window.__nrSamples = [];
  setInterval(() => {
    const st = window.__host && window.__host.state();
    const all = [...document.querySelectorAll('[data-testid=narrator]')];
    const nr = all[0] || null;
    const s = { t: Date.now(), phase: st ? st.phase : null, cut: !!(st && st.cutscene), nr: null, nrCount: all.length, comm: document.querySelectorAll('.sh-comm.is-on').length, covered: [] };
    if (nr) {
      if (!firstSeen.has(nr)) firstSeen.set(nr, Date.now());
      const age = Date.now() - firstSeen.get(nr);
      const leaving = nr.classList.contains('is-leaving');
      s.nr = { moment: nr.dataset.moment, slot: nr.dataset.slot, host: nr.dataset.host, age, leaving };
      const pic = nr.querySelector('.nr-pic');
      const bub = nr.querySelector('.nr-bubble');
      const mine = [pic && drawn(pic), bub && bub.getBoundingClientRect()].filter(Boolean);
      // judged once the entrance has settled (the slide-in passes by on its way)
      if (age > 800 && !leaving) {
        for (const [sel, label] of PROTECTED) {
          for (const el of document.querySelectorAll(sel)) {
            if (nr.contains(el)) continue;
            const r = vis(el);
            if (r && mine.some((m) => hit(m, r))) s.covered.push(label);
          }
        }
      }
    }
    window.__nrSamples.push(s);
  }, 100);
}

async function openPhone(browser, name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(`${name} pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') page.__errors.push(`${name} console ${m.text()}`);
  });
  return page;
}

async function join(page, code, name) {
  await page.goto(`${BASE}/?room=${code}&dress=0`);
  await page.waitForFunction(() => window.__player && window.__player.screen === 'join', null, { timeout: 20000 });
  await page.fill('.pp-name-input', name);
  await page.click('.pp-btn-go');
  await page.waitForFunction(() => window.__player && window.__player.screen !== 'join', null, { timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const tv = await ctx.newPage();
  const errors = [];
  tv.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  tv.on('console', (m) => {
    if (m.type() === 'error') errors.push('console ' + m.text());
  });
  const phones = [];
  let tapping = false;
  try {
    await tv.goto(`${BASE}/host.html`);
    await tv.evaluate(() => localStorage.clear());
    await tv.goto(`${BASE}/host.html`);
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 30000 });
    await tv.evaluate(installSampler);
    const code = await tv.evaluate(() => window.__host.state().code);
    console.log('room', code, `${W}x${H}`);
    const shot = (name) => tv.screenshot({ path: path.join(OUT, `${name}.png`) });
    const st = () => tv.evaluate(() => window.__host.state());
    const waitPhase = (p, ms = 60000) => tv.waitForFunction((x) => window.__host.state() && window.__host.state().phase === x, p, { timeout: ms });
    const waitMoment = (m, ms = 20000) =>
      tv.waitForFunction((x) => {
        const el = document.querySelector('[data-testid=narrator]');
        return el && el.dataset.moment === x && !el.classList.contains('is-leaving');
      }, m, { timeout: ms, polling: 50 });
    const shotMoment = async (m, name, settle = 900) => {
      try {
        await waitMoment(m);
        await sleep(settle);
        await shot(name);
      } catch {
        console.log(`  (no ${m} on screen to shoot)`);
      }
    };

    // ── the opening: the empty lobby ──
    await shotMoment('opening', '01-opening');
    await sleep(6500);

    // ── the first guest, then two more ──
    for (const [i, name] of ['נועה', 'איתי', 'מאיה'].entries()) {
      const p = await openPhone(browser, `phone${i + 1}`);
      phones.push(p);
      await join(p, code, name);
      if (i === 0) await shotMoment('arrive', '02-arrive', 1000);
    }
    await sleep(4500);
    await shot('03-lobby-3');

    // ── tap: the intro, the 3-2-1, GO ──
    await tv.mouse.move(W / 2, 8);
    await tv.keyboard.press('Space');
    await waitPhase('intro');
    await shotMoment('intro_tap', '10-intro-a', 900);
    await sleep(2600);
    await shot('11-intro-b');
    await waitPhase('countdown');
    await sleep(1200);
    await shot('12-countdown');
    await waitPhase('playing');
    tapping = true;
    const tapLoop = (async () => {
      while (tapping) {
        for (const p of phones.slice(0, 2)) {
          const vp = p.viewportSize();
          await p.mouse.click(vp.width / 2 + Math.random() * 60 - 30, vp.height * 0.55).catch(() => undefined);
        }
        await sleep(90);
      }
    })();
    await shotMoment('go', '13-go', 700);

    // ── the automatic cutscene, then the 3-2-1 back ──
    await tv.waitForFunction(() => !!window.__host.state().cutscene, null, { timeout: 30000 });
    await sleep(1500);
    await shot('14-cutscene');
    await tv.waitForFunction(() => !window.__host.state().cutscene, null, { timeout: 60000 });
    await shotMoment('resume', '15-resume', 600);
    await shotMoment('final10', '16-final10', 900);
    await waitPhase('results', 60000);
    tapping = false;
    await tapLoop;

    // ── results ──
    await shotMoment('timeup', '20-timeup', 800);
    await shotMoment('suspense', '21-suspense', 900);
    await shotMoment('reveal', '22-reveal', 1000);
    await shotMoment('standings', '23-standings', 900);
    const res = (await st()).results;
    // the ceremony is over: back to the lobby, then the podium (it asks for a second press)
    await tv.waitForFunction((at) => window.__host.now() > at, res.revealAt + 10600 + 6000, { timeout: 40000 });
    await tv.keyboard.press('Space');
    await waitPhase('lobby');
    await sleep(1800);
    await shot('30-lobby-between');
    await tv.click('[data-testid=btn-final]');
    await sleep(700);
    await tv.click('[data-testid=btn-final]');
    await waitPhase('final');
    await tv.waitForFunction(() => !window.__host.state().cutscene, null, { timeout: 60000 });
    await shotMoment('podium', '40-podium', 900);
    await shotMoment('champion', '41-champion', 1000);
    await sleep(2600);
    await shot('42-champion-b');
    await shotMoment('goodbye', '43-goodbye', 1200);
    await sleep(4500);

    // ── the verdict ──
    const out = await tv.evaluate(() => ({ log: window.__narrator.log(), dropped: window.__narrator.dropped(), samples: window.__nrSamples }));
    fs.writeFileSync(path.join(OUT, 'narration.json'), JSON.stringify({ log: out.log, dropped: out.dropped }, null, 1));
    const takes = [];
    for (const b of out.log) {
      const last = takes[takes.length - 1];
      // the second line of a banter pair follows the first within a few seconds
      if (last && last.moment === b.moment && b.at - last.at < 6000 && last.beats < 2) last.beats++;
      else takes.push({ moment: b.moment, at: b.at, beats: 1 });
    }
    console.log('said:', takes.map((t) => `${t.moment}${t.beats > 1 ? '×2' : ''}`).join(', '));
    console.log('dropped:', JSON.stringify(out.dropped));
    const count = {};
    for (const t of takes) count[t.moment] = (count[t.moment] || 0) + 1;
    check(Object.values(count).every((n) => n === 1), 'each moment fires once', count);
    const expected = ['opening', 'arrive', 'intro_tap', 'go', 'resume', 'final10', 'timeup', 'suspense', 'reveal', 'standings', 'podium', 'champion', 'goodbye'];
    const missing = expected.filter((m) => !count[m]);
    check(missing.length === 0, `every moment of this run was narrated (${expected.length})`, missing);
    const s = out.samples;
    const both = s.filter((x) => x.nr && x.comm > 0);
    check(both.length === 0, 'the hosts and the commentator never talk at once', both.slice(0, 3));
    check(s.every((x) => x.nrCount <= 1), 'never two host bubbles at once');
    const inCut = s.filter((x) => x.cut && x.nr);
    check(inCut.length === 0, 'nothing during a cutscene', inCut.slice(0, 3));
    const cov = s.filter((x) => x.covered.length > 0);
    const byLabel = {};
    for (const x of cov) for (const l of x.covered) byLabel[`${x.nr.moment}/${x.nr.slot}: ${l}`] = (byLabel[`${x.nr.moment}/${x.nr.slot}: ${l}`] || 0) + 1;
    check(cov.length === 0, 'the hosts cover nothing the room is watching', byLabel);
    const play = s.filter((x) => x.phase === 'playing' && x.nr);
    check(play.every((x) => x.nr.slot === 'side'), 'during a round the hosts stand only in the side margin', [...new Set(play.map((x) => x.nr.slot))]);
    const phoneErrors = phones.flatMap((p) => p.__errors);
    check(errors.length === 0, 'TV: no console errors', errors.slice(0, 5));
    check(phoneErrors.length === 0, 'phones: no console errors', phoneErrors.slice(0, 5));
  } catch (e) {
    failures.push('crashed: ' + e.message);
    console.log('CRASH', e);
    await tv.screenshot({ path: path.join(OUT, 'crash.png') }).catch(() => undefined);
  } finally {
    tapping = false;
    await browser.close();
  }
  console.log(failures.length === 0 ? `\nPASS (${OUT})` : `\nFAIL ${failures.length}: ${failures.join(' | ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
