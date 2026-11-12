// qa-flappy-lane: flappy's announcements never cover the action. Streak words, 'מחורחר!',
// 'עוד יותר קשה!', the finale words and the 3-2-1 digit live in one slim lane at the top of the
// play area, under the HUD, beside the "N באוויר" chip; one message at a time, the newest
// replaces the older, at most 1.4 s each. Only 'ניצחת!' (the play is over) stays big. The obstacles-
// passed counter is a small score at the left end of that row, never mid-field.
// The "out" view's list of who is still flying is never covered.
//
// Frames of the dev harness (the game's pilot flies) at 390x844 and 320x568 for every kind of
// announcement; when the game has the lane hook (window.__flappy.lane) the frames are checked too.
//
//   PARTY_CLIENT_PORT=5381 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   QA_BASE=http://localhost:5381 node tests/e2e/qa-flappy-lane.cjs [label]
// Frames: tests/e2e/out/qa-flappy-lane/<label>-<width>-<moment>.png (look at them).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.QA_BASE || 'http://localhost:5381';
const LABEL = process.argv[2] || 'after';
const OUT = path.join(__dirname, 'out', 'qa-flappy-lane');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
let passed = 0;
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (ok) passed++;
  else fails.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STATE = () => {
  const f = window.__flappy;
  if (!f) return null;
  const rect = (sel) => {
    const e = document.querySelector(sel);
    if (!e || e.offsetParent === null) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 ? [r.left, r.top, r.width, r.height] : null;
  };
  return {
    mode: f.mode,
    banner: f.banner,
    cd: f.countdown,
    won: f.won,
    stage: f.finaleStage,
    out: f.out,
    lane: f.lane === undefined ? undefined : f.lane,
    layout: f.layout,
    list: rect('.fl-list'),
    chips: [...document.querySelectorAll('.fl-list .fl-chip')].map((c) => {
      const r = c.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height];
    }),
    burst: rect('.fl-burst'),
    viewH: window.innerHeight,
  };
};

const STREAKS = new Set(['וואו!', 'צדיק!', 'נודר!', 'בן פורת יוסף!', 'מחורחר!']);

/** One flight; `moments` maps a frame name to a predicate on STATE. Each frame is taken once, the first time. */
async function flight(browser, vp, query, moments, ms) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}/dev.html?game=flappy${query}`);
  await page.waitForFunction(() => window.__flappy, null, { timeout: 30000 });
  const seen = {};
  const lanes = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await page.evaluate(STATE).catch(() => null);
    if (!s) break;
    if (s.lane) lanes.push({ ...s.lane, t: Date.now() - t0 });
    for (const [name, pred] of Object.entries(moments)) {
      if (seen[name] || !pred(s)) continue;
      seen[name] = s;
      await page.screenshot({ path: path.join(OUT, `${LABEL}-${vp.width}-${name}.png`) });
    }
    if (Object.keys(seen).length === Object.keys(moments).length) break;
    await sleep(25);
  }
  await ctx.close();
  return { seen, lanes, errors };
}

const apartOf = (a, b) => a[0] + a[2] <= b[0] + 0.5 || a[0] >= b[0] + b[2] - 0.5 || a[1] + a[3] <= b[1] + 0.5 || a[1] >= b[1] + b[3] - 0.5;

/** The lane's checks on one reading (after the change: the game has the hook). */
function laneOk(tag, s) {
  const L = s.lane;
  if (!L || !L.text) return;
  const top = s.layout.top;
  check(`${tag}: one slim line (${Math.round(L.h)} px high, at most 44)`, L.h <= 44.5, L);
  check(`${tag}: under the HUD, at the very top of the play area`, L.y >= L.hudTop - 0.5 && L.y + L.h <= Math.max(top, L.hudTop) + 48, { lane: L, fieldTop: top });
  check(`${tag}: inside the screen width`, L.x >= 0 && L.x + L.w <= s.layout.W + 0.5, L);
  if (L.chip) {
    const [cx, cy, cw, ch] = L.chip;
    const apart = L.x + L.w <= cx + 0.5 || L.x >= cx + cw - 0.5 || L.y + L.h <= cy + 0.5 || L.y >= cy + ch - 0.5;
    check(`${tag}: does not collide with the "N באוויר" chip`, apart, { lane: [L.x, L.y, L.w, L.h], chip: L.chip });
  }
  if (L.counter) check(`${tag}: does not collide with the counter`, apartOf([L.x, L.y, L.w, L.h], L.counter), { lane: [L.x, L.y, L.w, L.h], counter: L.counter });
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const tag = `${vp.width}x${vp.height}`;
      // 1. flying with a field of 8: the streak words, the finale's 3-2-1, 'מחורחר!', 'עוד יותר קשה!'
      const a = await flight(
        browser,
        vp,
        '&seed=21&field=8&finaleAt=16000&pilot=1&look=1.5.10-8-17.201.13.229.325',
        {
          streak: (s) => s.mode === 'fly' && STREAKS.has(s.banner) && s.stage < 0,
          countdown3: (s) => s.mode === 'fly' && / 3$/.test(s.cd),
          countdown1: (s) => s.mode === 'fly' && / 1$/.test(s.cd),
          finale: (s) => s.mode === 'fly' && s.banner === 'מחורחר!' && s.stage >= 0,
          harder: (s) => s.mode === 'fly' && s.banner === 'עוד יותר קשה!',
        },
        60000,
      );
      check(`${tag}: no page errors (flight)`, a.errors.length === 0, a.errors);
      check(`${tag}: frames of a streak word, the 3-2-1 and the finale`, ['streak', 'countdown3', 'countdown1', 'finale'].every((k) => a.seen[k]), Object.keys(a.seen));
      if (a.lanes.length > 0) {
        for (const [k, s] of Object.entries(a.seen)) laneOk(`${tag} ${k}`, s);
        const digits = ['countdown3', 'countdown1'].map((k) => a.seen[k]).filter(Boolean);
        check(`${tag}: the big 3-2-1 digit is gone: the digit is inside the lane message`, digits.every((s) => s.lane && s.lane.digit !== null && s.lane.big === ''), digits.map((s) => s.lane));
        // one message at a time, at most 1.4 s each: no text is on for longer (a new message restarts the clock)
        const runs = [];
        let open = null;
        for (const l of a.lanes) {
          if (!l.text) {
            open = null;
            continue;
          }
          if (open && open.key === l.key) open.until = l.t;
          else runs.push((open = { key: l.key, text: l.text, from: l.t, until: l.t }));
        }
        // the readings come every ~40-80 ms: allow one reading of slack
        const long = runs.filter((r) => r.until - r.from > 1400 + 150);
        check(`${tag}: every lane message is gone within 1.4 s (or replaced sooner)`, long.length === 0, long);
        check(`${tag}: nothing big over the action while flying (only 'ניצחת!' may be)`, a.lanes.every((l) => l.big === '' || l.big === 'ניצחת!'), [...new Set(a.lanes.map((l) => l.big))]);
        // the obstacles-passed counter: small, in the top row, beside the chip, never mid-field
        const counters = a.lanes.filter((l) => l.counter);
        const badCounter = counters.filter((l) => {
          const [x, y, w, h] = l.counter;
          return y < l.hudTop - 0.5 || y + h > l.hudTop + 44.5 || x < 0 || (l.chip && !apartOf(l.counter, l.chip)) || (l.text && !apartOf(l.counter, [l.x, l.y, l.w, l.h]));
        });
        check(`${tag}: the counter is small and in the top row in every reading (${counters.length} readings), beside the chip and the lane message`, counters.length > 10 && badCounter.length === 0, badCounter.slice(0, 3));
      }

      // 2. the win: a field of 1, the pilot outlasts it ('ניצחת!' may stay big)
      const w = await flight(browser, vp, '&seed=9&field=1&finaleAt=4000&pilot=1', { won: (s) => s.mode === 'fly' && s.won && s.banner === 'ניצחת!' }, 40000);
      check(`${tag}: frame of the win`, !!w.seen.won, Object.keys(w.seen));

      // 3. out early with a field of 8: the crash, then the out view (who still flies) with the finale banner
      const o = await flight(
        browser,
        vp,
        '&seed=7&field=8&finaleAt=9000&pilot=1&pilotUntil=120',
        {
          crash: (s) => s.mode === 'dead',
          out: (s) => s.mode === 'out' && s.out && s.out.names.length >= 4 && s.out.heads >= Math.min(4, s.out.names.length),
          outFinale: (s) => s.mode === 'out' && s.out && s.out.finale !== '' && s.out.names.length > 0,
        },
        40000,
      );
      check(`${tag}: frames of the crash and the out view`, ['crash', 'out', 'outFinale'].every((k) => o.seen[k]), Object.keys(o.seen));
      for (const k of ['out', 'outFinale']) {
        const s = o.seen[k];
        if (!s || !s.list) continue;
        const [, ly, , lh] = s.list;
        const lastChip = s.chips.reduce((m, c) => Math.max(m, c[1] + c[3]), 0);
        check(`${tag} ${k}: every chip of who is still flying is whole on screen (not cut by the list or the screen)`, s.chips.length > 0 && lastChip <= ly + lh + 0.5 && lastChip <= s.viewH, { list: s.list, lastChipBottom: lastChip, chips: s.chips.length });
        if (s.burst) check(`${tag} ${k}: the "!נפלת" burst sits above the list, never on it`, s.burst[1] + s.burst[3] <= ly + 0.5, { burst: s.burst, list: s.list });
      }
      check(`${tag}: no page errors (out)`, o.errors.length === 0 && w.errors.length === 0, [...o.errors, ...w.errors]);
    }
  } finally {
    await browser.close();
  }
  console.log(fails.length === 0 ? `\n[qa-flappy-lane] ALL OK (${passed} checks)` : `\n[qa-flappy-lane] ${fails.length} FAILED:\n - ${fails.join('\n - ')}`);
  process.exit(fails.length === 0 ? 0 : 1);
})();
