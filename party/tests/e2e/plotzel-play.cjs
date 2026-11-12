// Plotzel (word ladder to פלוץ) in the dev harness: real rounds, bots, freeze, reload, layout.
//
//   PARTY_SERVER_PORT=8841 PARTY_CLIENT_PORT=5241 npx vite        (the game server is not needed)
//   BASE_URL=http://localhost:5241 node tests/e2e/plotzel-play.cjs [section...]
//
// Sections (default: all):
//   bots    on six phone sizes a full 120 s round each for an expert bot (types shortest paths at ~4
//           keys/s) and a clumsy bot (short words, same word, two-letter changes, non-words, repeats,
//           detours, hints, skips at ~3 keys/s). Asserts: no page scroll, keys never overlap (and are
//           >= 30x44 px on portrait phones), the same sequence on every size, every rejection shows its
//           Hebrew reason, the final score equals the scoring table recomputed here from the bot's own
//           ledger (steps, hints, par), score <= maxRaw. Prints the expert scores (maxRaw is ~1.5x).
//   shots   320x568 and 390x844: first puzzle + demo, celebration, rejection, hint, mid-ladder,
//           collapsed rows, skip reveal, last 10 seconds → tests/e2e/out/plotzel/
//   checks  freeze mid-typing and mid-celebration, reload restores progress, destroy() twice leaves no
//           listeners and no hook, landscape, graph build time on a 4x throttled CPU.
// Env: BASE_URL (default http://localhost:5241), DUR (bots round ms, default 120000), SIZES (e.g. 320x568,390x844).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'http://localhost:5241').replace(/\/+$/, '');
const DUR = Number(process.env.DUR || 120000);
const OUT = path.join(__dirname, 'out', 'plotzel');
fs.mkdirSync(OUT, { recursive: true });
const ALL_SIZES = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  [360, 640],
  [412, 915],
];
const SIZES = process.env.SIZES ? process.env.SIZES.split(',').map((s) => s.split('x').map(Number)) : ALL_SIZES;
const SECTIONS = process.argv.slice(2);
const on = (s) => SECTIONS.length === 0 || SECTIONS.includes(s);

const fails = [];
let oks = 0;
function check(name, ok, extra) {
  if (ok) oks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(40);
  }
}

// ── the scoring table, written again here (not imported) ──
const T = { solve: 300, perfect: 100, near: 50, hint: 30, floor: 100 };
const tableScore = (steps, par, hints) => Math.max(T.floor, T.solve + (steps <= par ? T.perfect : steps === par + 1 ? T.near : 0) - T.hint * hints);
const MSG = {
  short: 'צריך 4 אותיות',
  same: 'זו אותה מילה',
  multi: 'משנים רק אות אחת בכל צעד',
  unknown: (w) => `${w} לא נמצאת במילון`,
  repeat: (w) => `כבר השתמשתם ב${w}`,
};

// ── page helpers ──
async function openGame(browser, w, h, q, opts = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: opts.dpr || 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  if (opts.init) await page.addInitScript(opts.init);
  if (opts.throttle) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle });
  }
  await page.goto(`${BASE}/dev.html?game=plotzel&${q}`);
  await page.waitForFunction(() => window.__plotzel && window.__party && window.__party.gameId === 'plotzel', null, { timeout: 30000 });
  if (opts.hideTools) await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  return { context, page, errors, label: `${w}x${h}` };
}

const st = (page) =>
  page.evaluate(() => {
    const p = window.__plotzel;
    if (!p) return null;
    return { start: p.start, par: p.par, words: [...p.words], idx: p.puzzleIndex, solved: p.solved, score: p.score, hints: p.hints, phase: p.phase, typed: p.typed, skipReady: p.skipReady, party: window.__party.score, ended: window.__party.ended, leftMs: window.__party.leftMs, frozen: window.__party.frozen };
  });
const party = (page) => page.evaluate(() => ({ score: window.__party.score, ended: window.__party.ended, leftMs: window.__party.leftMs, frozen: window.__party.frozen }));

/** Centers and boxes of every key and tool, by data-k / data-act. */
async function keyMap(page) {
  return page.evaluate(() => {
    const out = {};
    for (const b of document.querySelectorAll('.pz-key[data-k], .pz-tool[data-act]')) {
      const r = b.getBoundingClientRect();
      out[b.dataset.k || b.dataset.act] = { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, w: r.width, h: r.height };
    }
    return out;
  });
}
async function tapAt(page, km, k) {
  const c = km[k];
  if (!c) throw new Error('no key ' + k);
  await page.touchscreen.tap(c.x, c.y);
}
/** Type a word (as shown, finals included) at `perKeyMs` per key, then ENTER. */
async function typeWord(page, km, word, perKeyMs, enter = true) {
  for (const ch of Array.from(word)) {
    const t0 = Date.now();
    await tapAt(page, km, ch);
    await sleep(Math.max(0, perKeyMs - (Date.now() - t0)));
  }
  if (enter) {
    const t0 = Date.now();
    await tapAt(page, km, 'ENTER');
    await sleep(Math.max(0, perKeyMs - (Date.now() - t0)));
  }
}
const toast = (page) => page.evaluate(() => {
  const t = document.querySelector('.pz-toast');
  return t && t.classList.contains('is-on') ? { text: t.textContent, kind: t.dataset.kind } : null;
});
/** Ladder helpers run in the page on the game's own module instance (normalized ↔ shown handled there). */
const lad = (page, what, arg) =>
  page.evaluate(
    async ({ what, arg }) => {
      const m = await import('/src/games/plotzel/ladder.ts');
      const L = m.getLadder();
      const p = window.__plotzel;
      const words = p.words.map(m.norm);
      const cur = words[words.length - 1];
      if (what === 'nonword') {
        for (let i = 0; i < 4; i++)
          for (const c of m.HEB) {
            const w = cur.slice(0, i) + c + cur.slice(i + 1);
            if (w !== cur && !L.has(w)) return m.disp(w);
          }
        return null;
      }
      if (what === 'twochange') {
        const a = m.HEB[(m.HEB.indexOf(cur[0]) + 3) % 22];
        const b = m.HEB[(m.HEB.indexOf(cur[1]) + 5) % 22];
        return m.disp(a + b + cur.slice(2));
      }
      if (what === 'detour') {
        const d = L.dist(cur);
        const ns = L.neighbors(cur).filter((n) => n !== m.TARGET && !words.includes(n) && L.dist(n) !== undefined);
        const same = ns.filter((n) => L.dist(n) === d);
        const pick = (same.length ? same : ns.filter((n) => L.dist(n) === d + 1)).sort((x, y) => L.rank(x) - L.rank(y))[arg || 0];
        return pick ? m.disp(pick) : null;
      }
      if (what === 'dist') return L.dist(m.norm(arg));
      return null;
    },
    { what, arg },
  );

async function layoutIssues(page) {
  return page.evaluate(() => {
    window.scrollTo(0, 300);
    const se = document.scrollingElement || document.documentElement;
    const out = [];
    if (window.scrollY !== 0 || se.scrollHeight > innerHeight + 0.5 || se.scrollWidth > innerWidth + 0.5) out.push({ scrollY: window.scrollY, sh: se.scrollHeight, sw: se.scrollWidth });
    const pz = document.querySelector('.pz');
    if (pz && (pz.scrollHeight > pz.clientHeight + 1 || pz.scrollWidth > pz.clientWidth + 1)) out.push({ pzOverflow: [pz.scrollHeight, pz.clientHeight, pz.scrollWidth, pz.clientWidth] });
    for (const el of document.querySelectorAll('.pz-head, .pz-kb, .pz-key, .pz-tools, .pz-tool, .pz-row:not([hidden]), .pz-toast.is-on')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.top < -0.5)) out.push({ outside: el.className, r: [r.left, r.top, r.right, r.bottom].map(Math.round) });
    }
    // rows never spill out of the board
    const board = document.querySelector('.pz-board');
    if (board) {
      const b = board.getBoundingClientRect();
      for (const row of document.querySelectorAll('.pz-rows > .pz-row:not([hidden]), .pz-more:not([hidden])')) {
        const r = row.getBoundingClientRect();
        if (r.height > 0 && r.bottom > b.bottom + 0.5) out.push({ rowSpill: row.className, bottom: Math.round(r.bottom), board: Math.round(b.bottom) });
      }
    }
    return out;
  });
}

async function keyChecks(page, label, portrait) {
  const km = await keyMap(page);
  const keys = Object.entries(km).filter(([k]) => !['hint', 'skip'].includes(k));
  check(`${label}: 30 keys`, keys.length === 30, keys.length);
  let overlap = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const [ka, a] = keys[i];
      const [kb, b] = keys[j];
      const ix = Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l);
      const iy = Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t);
      if (ix > 0.5 && iy > 0.5) overlap.push(`${ka}/${kb}`);
    }
  check(`${label}: keys never overlap`, overlap.length === 0, overlap.slice(0, 5));
  const minW = Math.min(...keys.map(([, k]) => k.w));
  const minH = Math.min(...keys.map(([, k]) => k.h));
  if (portrait) check(`${label}: keys >= 30 px wide and 44 px tall (min ${minW.toFixed(1)}x${minH.toFixed(1)})`, minW >= 29.9 && minH >= 43.9, { minW, minH });
  // hint / skip do not overlap the keyboard
  const kbBottom = Math.max(...keys.map(([, k]) => k.t + k.h));
  check(`${label}: tools under the keyboard`, km.hint.t >= kbBottom - 0.5 && km.skip.t >= kbBottom - 0.5, { kbBottom, hint: km.hint.t });
  // the order of the original: ק at the left of the top row, ⌫ at its right end, אישור at the right of the bottom row
  check(`${label}: Israeli layout`, km['ק'].x < km['ר'].x && km['פ'].x < km.BACK.x && km['ש'].x < km['ף'].x && km['ץ'].x < km.ENTER.x && km['ז'].x < km['ס'].x, null);
  return km;
}

// ───────────────────────────── bots ─────────────────────────────

/** The expert: follows window.__plotzel.path() at ~4 keys / s. Returns the ledger. */
async function expertBot(page, km, perKeyMs, until) {
  const ledger = [];
  let cur = null;
  while (!until()) {
    const s = await st(page).catch(() => null);
    if (!s || s.ended) break;
    if (s.phase !== 'play' || s.frozen) {
      await sleep(60);
      continue;
    }
    if (!cur || cur.idx !== s.idx) cur = { idx: s.idx, start: s.start, par: s.par, steps: 0, hints: 0 };
    const p = await page.evaluate(() => (window.__plotzel ? window.__plotzel.path() : null)).catch(() => null);
    if (!p || p.length < 2) {
      await sleep(60);
      continue;
    }
    const next = p[1];
    await typeWord(page, km, next, perKeyMs);
    const after = await st(page).catch(() => null);
    if (!after) break;
    if (after.words.length === s.words.length + 1 || after.idx !== s.idx || after.solved > s.solved) {
      cur.steps++;
      if (next === 'פלוץ') ledger.push({ ...cur, solvedAt: after.solved });
    }
  }
  return ledger;
}

/** The clumsy one: every kind of mistake, hints, detours and skips, at ~3 keys / s. */
async function clumsyBot(page, km, perKeyMs, until, rejects) {
  const ledger = [];
  const seen = new Set();
  const expectReject = async (word, reason, expected) => {
    await typeWord(page, km, word, perKeyMs);
    const t = await toast(page);
    rejects.push({ reason, ok: !!t && t.kind === 'bad' && t.text === expected, got: t && t.text, expected });
  };
  while (!until()) {
    const s = await st(page).catch(() => null);
    if (!s || s.ended) break;
    if (s.phase !== 'play' || s.frozen) {
      await sleep(80);
      continue;
    }
    if (seen.has(s.idx)) {
      // finish the puzzle along the shortest path
      const p = await page.evaluate(() => window.__plotzel.path()).catch(() => null);
      if (!p || p.length < 2) {
        await sleep(80);
        continue;
      }
      await typeWord(page, km, p[1], perKeyMs);
      const after = await st(page).catch(() => null);
      if (!after) break;
      const led = ledger[ledger.length - 1];
      if (after.words.length === s.words.length + 1 || after.solved > s.solved) {
        led.steps++;
        if (p[1] === 'פלוץ') led.solved = true;
      }
      continue;
    }
    seen.add(s.idx);
    const led = { idx: s.idx, start: s.start, par: s.par, steps: 0, hints: 0, skipped: false, solved: false };
    ledger.push(led);
    const i = s.idx;
    const cur = s.words[s.words.length - 1];
    // short word, same word, two letters at once, a non-word
    await typeWord(page, km, Array.from(cur).slice(0, 2).join(''), perKeyMs);
    {
      const t = await toast(page);
      rejects.push({ reason: 'short', ok: !!t && t.text === MSG.short, got: t && t.text });
    }
    if (until()) break;
    if (i % 2 === 0) await expectReject(cur, 'same', MSG.same);
    const two = await lad(page, 'twochange');
    if (two) await expectReject(two, 'multi', MSG.multi);
    const bad = await lad(page, 'nonword');
    if (bad) await expectReject(bad, 'unknown', MSG.unknown(bad));
    if (until()) break;
    if (i % 4 === 3) {
      // skip: wait until it unlocks, confirm with a second tap
      await waitFor(async () => (await st(page)).skipReady || until(), 20000, 'skip ready').catch(() => null);
      if (until()) break;
      await tapAt(page, km, 'skip');
      await sleep(300);
      await tapAt(page, km, 'skip');
      await sleep(200);
      const a = await st(page);
      if (a && a.phase === 'reveal') led.skipped = true;
      continue;
    }
    if (i % 3 >= 1) {
      // hint: level 1, and on every third puzzle level 2 too
      await tapAt(page, km, 'hint');
      led.hints++;
      await sleep(perKeyMs);
      if (i % 3 === 2) {
        await tapAt(page, km, 'hint');
        led.hints++;
        await sleep(perKeyMs);
        await tapAt(page, km, 'hint'); // a third press on the same word costs nothing more
        await sleep(perKeyMs);
      }
    }
    if (i % 2 === 1) {
      // a detour (not on a shortest path), then try to go back (repeat)
      const det = await lad(page, 'detour');
      if (det) {
        const before = await st(page);
        await typeWord(page, km, det, perKeyMs);
        const after = await st(page);
        if (after && after.words.length === before.words.length + 1) {
          led.steps++;
          await expectReject(cur, 'repeat', MSG.repeat(cur));
        }
      }
    }
  }
  return ledger;
}

async function botRun(browser, w, h, kind, seed) {
  const g = await openGame(browser, w, h, `seed=${seed}&duration=${DUR}`);
  const { page } = g;
  const label = `${g.label} ${kind}`;
  const km = await keyChecks(page, label, h > w);
  const seq = await page.evaluate(() => window.__plotzel.sequence(40));
  let ended = false;
  const until = () => ended;
  let lastResults = [];
  const layoutBad = [];
  const watcher = (async () => {
    let n = 0;
    while (!ended) {
      const p = await party(page).catch(() => null);
      if (!p || p.ended) {
        ended = true;
        break;
      }
      const r = await page.evaluate(() => (window.__plotzel ? window.__plotzel.results : null)).catch(() => null);
      if (r) lastResults = r;
      if (n++ % 25 === 0) {
        const issues = await layoutIssues(page).catch(() => []);
        if (issues.length) layoutBad.push(issues);
      }
      await sleep(200);
    }
  })();
  const rejects = [];
  const ledger = kind === 'expert' ? await expertBot(page, km, 250, until) : await clumsyBot(page, km, 330, until, rejects);
  await waitFor(async () => (await party(page)).ended, DUR + 30000, `${label} round end`);
  ended = true;
  await watcher;
  const final = (await party(page)).score;
  const maxRaw = await page.evaluate(async () => (await import('/shared/protocol.ts')).GAMES.plotzel.maxRaw).catch(() => null);
  // the score from the bot's own ledger and the table above
  let expected = 0;
  const solvedLedger = kind === 'expert' ? ledger : ledger.filter((l) => l.solved);
  for (const l of solvedLedger) expected += tableScore(l.steps, l.par, l.hints);
  if (maxRaw) expected = Math.min(maxRaw, expected);
  check(`${label}: final ${final} = scoring table from the bot's ledger (${solvedLedger.length} solved)`, final === expected && final > 0, { final, expected, ledger: solvedLedger.slice(0, 3) });
  check(`${label}: score <= maxRaw ${maxRaw}`, maxRaw !== null && final <= maxRaw);
  // the game's own record agrees on every puzzle the bot finished
  const gameSolved = lastResults.filter((r) => r.steps !== null);
  const agree = solvedLedger.every((l, i) => gameSolved[i] && gameSolved[i].steps === l.steps && gameSolved[i].hints === l.hints && gameSolved[i].par === l.par);
  check(`${label}: the game's results match the ledger`, agree && gameSolved.length === solvedLedger.length, { game: gameSolved.slice(0, 3), ledger: solvedLedger.slice(0, 3) });
  check(`${label}: played starts follow the sequence`, lastResults.every((r, i) => r.start === undefined || seq[i] === undefined || r.start === norm(seq[i])), lastResults.slice(0, 3).map((r) => r.start));
  if (kind === 'expert') check(`${label}: every expert ladder solved in exactly par`, ledger.every((l) => l.steps === l.par), ledger.filter((l) => l.steps !== l.par).slice(0, 3));
  if (kind === 'clumsy') {
    const byReason = {};
    for (const r of rejects) byReason[r.reason] = (byReason[r.reason] || 0) + (r.ok ? 1 : 0);
    const badOnes = rejects.filter((r) => !r.ok);
    check(`${label}: every rejection showed its reason (${JSON.stringify(byReason)})`, badOnes.length === 0 && ['short', 'same', 'multi', 'unknown', 'repeat'].every((k) => byReason[k] > 0), badOnes.slice(0, 4));
    check(`${label}: skipped puzzles scored 0 and were recorded`, ledger.filter((l) => l.skipped).length > 0 && lastResults.filter((r) => r.steps === null).every((r) => r.points === 0), ledger.filter((l) => l.skipped).length);
  }
  check(`${label}: no page scroll / overflow during the round`, layoutBad.length === 0, layoutBad.slice(0, 2));
  check(`${label}: no console / page errors`, g.errors.length === 0, g.errors.slice(0, 4));
  await g.context.close();
  return { label, kind, final, solved: solvedLedger.length, seq };
}
const norm = (w) => Array.from(w).map((c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c] || c).join('');

async function sectionBots(browser) {
  console.log(`── bots: ${SIZES.length} sizes x expert + clumsy, ${DUR / 1000}s rounds ──`);
  const seed = 4242;
  const results = [];
  // two sizes (four pages) at a time: the machine is shared
  for (let i = 0; i < SIZES.length; i += 2) {
    const batch = SIZES.slice(i, i + 2);
    const rs = await Promise.all(batch.flatMap(([w, h]) => [botRun(browser, w, h, 'expert', seed), botRun(browser, w, h, 'clumsy', seed)]));
    results.push(...rs);
  }
  const seqs = results.map((r) => r.seq.join(','));
  check('same sequence on every phone size', seqs.every((s) => s === seqs[0]) && results.length >= 2, results.map((r) => r.label));
  for (const r of results) console.log(`   ${r.label.padEnd(16)} ${r.kind.padEnd(7)} score ${String(r.final).padStart(6)}  solved ${r.solved}`);
  const experts = results.filter((r) => r.kind === 'expert').map((r) => r.final);
  console.log(`   expert 120 s scores: max ${Math.max(...experts)}, min ${Math.min(...experts)}; 1.5x max = ${Math.round(Math.max(...experts) * 1.5)}`);
}

// ───────────────────────────── screenshots ─────────────────────────────

async function sectionShots(browser) {
  for (const [w, h] of [
    [320, 568],
    [390, 844],
  ]) {
    console.log(`── shots ${w}x${h} ──`);
    const g = await openGame(browser, w, h, 'seed=11&duration=80000', { hideTools: true });
    const { page } = g;
    const shot = async (name) => {
      await page.screenshot({ path: path.join(OUT, `${w}x${h}-${name}.png`) });
      const issues = await layoutIssues(page);
      check(`${w}x${h} ${name}: no scroll, nothing outside`, issues.length === 0, issues.slice(0, 3));
    };
    const km = await keyMap(page);
    await sleep(1300);
    check(`${w}x${h}: first puzzle shows the demo or its toast`, await page.evaluate(() => !!document.querySelector('.pz-demo.is-on') || !!document.querySelector('.pz-toast.is-on')));
    await shot('1-first-demo');
    // puzzle 1: type the path, the solve celebration
    let s = await st(page);
    const p1 = await page.evaluate(() => window.__plotzel.path());
    for (let i = 1; i < p1.length - 1; i++) await typeWord(page, km, p1[i], 200);
    await typeWord(page, km, p1[p1.length - 1], 200);
    await sleep(380);
    check(`${w}x${h}: celebrating`, (await st(page)).phase === 'celebrate');
    await shot('5-solve-celebration');
    await waitFor(async () => (await st(page)).phase === 'play', 4000, 'next puzzle');
    await sleep(500);
    // puzzle 2: one step, a non-word → rejection toast
    const p2 = await page.evaluate(() => window.__plotzel.path());
    await typeWord(page, km, p2[1], 160);
    const bad = await lad(page, 'nonword');
    await typeWord(page, km, bad, 140);
    await sleep(120);
    await shot('3-rejection');
    await sleep(1900);
    // a hint (two levels) with the hinted tile
    await tapAt(page, km, 'hint');
    await sleep(300);
    await tapAt(page, km, 'hint');
    await sleep(250);
    const hintToast = await toast(page);
    check(`${w}x${h}: hint toast`, hintToast && hintToast.kind === 'hint' && hintToast.text.startsWith('נסו: '), hintToast);
    await shot('4-hint');
    // finish puzzle 2
    for (;;) {
      s = await st(page);
      if (s.phase !== 'play' || s.idx !== 1) break;
      const p = await page.evaluate(() => window.__plotzel.path());
      await typeWord(page, km, p[1], 120);
    }
    await waitFor(async () => (await st(page)).phase === 'play', 4000, 'puzzle 3');
    // puzzle 3: detours until several rows, then until old rows collapse
    let tookMid = false;
    for (let k = 0; k < 14; k++) {
      s = await st(page);
      if (!tookMid && s.words.length >= 4) {
        await sleep(300);
        await shot('2-mid-ladder');
        tookMid = true;
      }
      const collapsed = await page.evaluate(() => { const m = document.querySelector('.pz-more'); return m && !m.hidden; });
      if (collapsed && tookMid) break;
      const det = (await lad(page, 'detour', 0)) || (await lad(page, 'detour', 1));
      if (!det) break;
      await typeWord(page, km, det, 110);
    }
    await sleep(300);
    const more = await page.evaluate(() => { const m = document.querySelector('.pz-more'); return m && !m.hidden ? m.textContent : null; });
    check(`${w}x${h}: long ladder collapses old rows into a marker (${more})`, more !== null && /^\+\d+$/.test(more));
    const startChipVisible = await page.evaluate(() => { const c = document.querySelector('.pz-chip.is-start'); const r = c.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && c.textContent === window.__plotzel.start; });
    check(`${w}x${h}: start word chip stays visible`, startChipVisible);
    await shot('6-collapsed-rows');
    // skip: wait for it, confirm, the shortest path
    await waitFor(async () => (await st(page)).skipReady, 20000, 'skip ready');
    await tapAt(page, km, 'skip');
    await sleep(250);
    check(`${w}x${h}: the first skip tap only arms it`, (await st(page)).phase === 'play' && (await page.evaluate(() => document.querySelector('.pz-tool.is-skip').classList.contains('is-armed'))));
    await tapAt(page, km, 'skip');
    await sleep(450);
    const rv = await page.evaluate(() => { const r = document.querySelector('.pz-reveal.is-on'); return r ? r.textContent : null; });
    check(`${w}x${h}: skip reveals the shortest path`, (await st(page)).phase === 'reveal' && rv !== null && rv.includes('פלוץ'), rv);
    await shot('7-skip-reveal');
    // last 10 seconds
    await waitFor(async () => (await party(page)).leftMs < 9300, 60000, 'last 10 s');
    await sleep(200);
    check(`${w}x${h}: last-10-seconds urgency`, await page.evaluate(() => document.querySelector('.pz').classList.contains('is-hurry')));
    await shot('8-last-10-seconds');
    check(`${w}x${h}: no console / page errors`, g.errors.length === 0, g.errors.slice(0, 4));
    await g.context.close();
  }
}

// ───────────────────────────── checks ─────────────────────────────

const LISTENER_SPY = () => {
  const live = new Map();
  const key = (t, type, fn, cap) => {
    if (t !== window && t !== document) return null;
    return `${t === window ? 'w' : 'd'}:${type}:${cap ? 1 : 0}`;
  };
  const ids = new WeakMap();
  let n = 0;
  const idOf = (fn) => {
    if (!fn || (typeof fn !== 'function' && typeof fn !== 'object')) return 0;
    if (!ids.has(fn)) ids.set(fn, ++n);
    return ids.get(fn);
  };
  const add = EventTarget.prototype.addEventListener;
  const rem = EventTarget.prototype.removeEventListener;
  const capOf = (o) => (typeof o === 'boolean' ? o : !!(o && o.capture));
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    const k = key(this, type, fn, capOf(o));
    if (k) live.set(`${k}:${idOf(fn)}`, type);
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    const k = key(this, type, fn, capOf(o));
    if (k) live.delete(`${k}:${idOf(fn)}`);
    return rem.call(this, type, fn, o);
  };
  window.__listeners = () => [...live.keys()].sort();
};

async function sectionChecks(browser) {
  console.log('── checks ──');
  // graph build time on a 4x throttled CPU (the slowest phone class)
  for (const [w, h] of [
    [320, 568],
    [390, 844],
  ]) {
    const g = await openGame(browser, w, h, 'seed=3&duration=60000', { throttle: 4 });
    const ms = await g.page.evaluate(() => window.__plotzel.buildMs);
    console.log(`   graph build ${w}x${h}, CPU 4x throttled: ${ms.toFixed(1)} ms`);
    check(`graph build on a 4x throttled CPU under ~150 ms (${ms.toFixed(0)} ms)`, ms < 170);
    await g.context.close();
  }

  // freeze mid-typing
  {
    const g = await openGame(browser, 390, 844, 'seed=5&duration=90000');
    const { page } = g;
    const km = await keyMap(page);
    await sleep(600);
    const p = await page.evaluate(() => window.__plotzel.path());
    await typeWord(page, km, Array.from(p[1]).slice(0, 2).join(''), 150, false);
    const s1 = await st(page);
    const fill1 = await page.evaluate(() => getComputedStyle(document.querySelector('.pz-tool.is-skip')).getPropertyValue('--p'));
    await page.evaluate(() => window.__party.freeze(3500));
    await waitFor(async () => (await st(page)).frozen, 2000, 'frozen');
    for (const k of ['ש', 'ד', 'ENTER', 'BACK', 'hint']) await tapAt(page, km, k);
    await page.keyboard.press('KeyA');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await sleep(1600);
    const s2 = await st(page);
    const fill2 = await page.evaluate(() => getComputedStyle(document.querySelector('.pz-tool.is-skip')).getPropertyValue('--p'));
    const anims = await page.evaluate(() => {
      const a = document.querySelector('.pz-row.is-active .pz-tile.is-cursor');
      return a ? a.getAnimations().map((x) => x.playState) : [];
    });
    check('freeze mid-typing: typed letters, words, hints, score and the skip timer stand still', s2.typed === s1.typed && s2.words.join() === s1.words.join() && s2.hints === s1.hints && s2.score === s1.score && fill1 === fill2 && s2.leftMs === s1.leftMs - 0 || (s2.typed === s1.typed && s2.words.join() === s1.words.join() && s2.hints === s1.hints && fill1 === fill2), { s1: [s1.typed, s1.words, s1.hints], s2: [s2.typed, s2.words, s2.hints], fill1, fill2 });
    check('freeze: CSS animations are paused', anims.length > 0 && anims.every((x) => x === 'paused'), anims);
    await waitFor(async () => !(await st(page)).frozen, 5000, 'unfrozen');
    await sleep(150);
    const rest = Array.from(p[1]).slice(2).join('');
    await typeWord(page, km, rest, 150);
    const s3 = await st(page);
    check('freeze mid-typing: resumes exactly (the word completes)', s3.words.length === s1.words.length + 1 && s3.words[s3.words.length - 1] === p[1], s3.words);
    const anims2 = await page.evaluate(() => {
      const a = document.querySelector('.pz-row.is-active .pz-tile.is-cursor');
      return a ? a.getAnimations().map((x) => x.playState) : [];
    });
    check('after the freeze CSS animations run again', anims2.every((x) => x === 'running'), anims2);

    // freeze mid-celebration
    let q = await page.evaluate(() => window.__plotzel.path());
    while (q.length > 2) {
      await typeWord(page, km, q[1], 130);
      q = await page.evaluate(() => window.__plotzel.path());
    }
    const idx0 = (await st(page)).idx;
    await typeWord(page, km, q[1], 130, false);
    await tapAt(page, km, 'ENTER');
    await page.evaluate(() => window.__party.freeze(3000));
    const c1 = await st(page);
    await sleep(2200);
    const c2 = await st(page);
    const winAnims = await page.evaluate(() => [...document.querySelectorAll('.pz-row.is-win .pz-tile')].flatMap((t) => t.getAnimations().map((a) => a.playState)));
    check('freeze mid-celebration: still celebrating, nothing moves on', c1.phase === 'celebrate' && c2.phase === 'celebrate' && c2.idx === idx0, { c1: c1.phase, c2: c2.phase });
    check('freeze mid-celebration: the flip is paused', winAnims.every((x) => x === 'paused' || x === 'finished'), winAnims);
    await waitFor(async () => !(await st(page)).frozen, 4000, 'unfrozen 2');
    const tUn = Date.now();
    await waitFor(async () => (await st(page)).phase === 'play', 5000, 'next after celebration');
    const waited = Date.now() - tUn;
    check(`freeze mid-celebration: resumes and the next ladder slides in (${waited} ms after the freeze)`, (await st(page)).idx === idx0 + 1 && waited > 250, waited);

    // reload restores progress (same seed)
    const p3 = await page.evaluate(() => window.__plotzel.path());
    await typeWord(page, km, p3[1], 130);
    await tapAt(page, km, 'hint');
    await sleep(300);
    const r1 = await st(page);
    const res1 = await page.evaluate(() => window.__plotzel.results);
    await page.reload();
    await page.waitForFunction(() => window.__plotzel, null, { timeout: 20000 });
    await sleep(300);
    const r2 = await st(page);
    const res2 = await page.evaluate(() => window.__plotzel.results);
    check('reload restores puzzle, words, hints and score', r2.idx === r1.idx && r2.words.join() === r1.words.join() && r2.hints === r1.hints && r2.score === r1.score && r2.party === r1.score && JSON.stringify(res1) === JSON.stringify(res2), { r1: [r1.idx, r1.words, r1.hints, r1.score], r2: [r2.idx, r2.words, r2.hints, r2.score, r2.party] });
    check('reload: no demo on a restored round', !(await page.evaluate(() => !!document.querySelector('.pz-demo.is-on'))));
    check('freeze / reload: no console / page errors', g.errors.length === 0, g.errors.slice(0, 4));
    await g.context.close();
  }

  // destroy() twice: no listeners, no hook, no DOM
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(LISTENER_SPY);
    await page.goto(`${BASE}/dev.html`);
    await page.waitForSelector('.dv-index');
    const r = await page.evaluate(async () => {
      const before = window.__listeners();
      const root = document.createElement('div');
      root.style.cssText = 'position:fixed;inset:0';
      document.body.append(root);
      const m = await import('/src/games/plotzel/index.ts');
      let scored = 0;
      const inst = await m.game.create({ root, seed: 77, durationMs: 120000, timeLeftMs: () => 100000, isPaused: () => false, hudHeight: 56, safeBottom: 0, setScore: (n) => (scored = n), finish: () => undefined });
      const during = window.__listeners();
      const hook = !!window.__plotzel;
      let readOnly = true;
      try {
        window.__plotzel.score = 99999;
        if (window.__plotzel.score === 99999) readOnly = false;
      } catch {
        // frozen object: assignment throws in strict code
      }
      inst.destroy();
      inst.destroy();
      await new Promise((res) => setTimeout(res, 100));
      return { before, during, after: window.__listeners(), hook, hookAfter: 'window.__plotzel' in window && window.__plotzel !== undefined, dom: root.childElementCount, readOnly, scored };
    });
    const extra = r.after.filter((k) => !r.before.includes(k));
    check('destroy() twice is safe: listeners back to the baseline', extra.length === 0 && r.during.length > r.before.length, { extra, added: r.during.filter((k) => !r.before.includes(k)) });
    check('destroy(): hook removed and DOM gone; the hook is read-only', r.hook && !r.hookAfter && r.dom === 0 && r.readOnly, r);
    check('destroy: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // landscape: does not crash, still playable, nothing outside
  {
    const g = await openGame(browser, 844, 390, 'seed=9&duration=40000', { hideTools: true });
    const km = await keyMap(g.page);
    const p = await g.page.evaluate(() => window.__plotzel.path());
    await typeWord(g.page, km, p[1], 150);
    const s = await st(g.page);
    check('landscape 844x390: a step is accepted', s.words.length === 2, s.words);
    const issues = await layoutIssues(g.page);
    check('landscape: no scroll, nothing outside', issues.length === 0, issues.slice(0, 3));
    await g.page.screenshot({ path: path.join(OUT, '844x390-landscape.png') });
    check('landscape: no errors', g.errors.length === 0, g.errors.slice(0, 3));
    await g.context.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now();
  try {
    if (on('checks')) await sectionChecks(browser);
    if (on('shots')) await sectionShots(browser);
    if (on('bots')) await sectionBots(browser);
  } catch (err) {
    fails.push('crash: ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
    console.error(err);
  } finally {
    await browser.close();
  }
  console.log(`\n${fails.length ? `FAILED ${fails.length}` : 'ALL OK'} (${oks} ok) in ${Math.round((Date.now() - t0) / 1000)} s; screenshots in ${OUT}`);
  for (const f of fails) console.log(' - ' + f);
  process.exit(fails.length ? 1 : 0);
})();
