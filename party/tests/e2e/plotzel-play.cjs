// Plotzel slot check (builtin + embed). Needs vite on :5214 (PARTY_CLIENT_PORT=5214 npx vite).
//   node tests/e2e/plotzel-play.cjs [section...]   sections: builtin small embed noBridge unreachable hang
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.PZ_BASE || 'http://localhost:5214';
// a different origin than BASE, so the iframe is really cross-origin
const MOCK = process.env.PZ_MOCK || 'http://127.0.0.1:5214/plotzel-bridge/mock.html';
const OUT = path.join(__dirname, 'out', 'plotzel');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const party = (page) =>
  page.evaluate(() => ({ score: window.__party.score, ended: window.__party.ended, frozen: window.__party.frozen, leftMs: window.__party.leftMs }));
const finishedOverlay = (page) => page.evaluate(() => !!document.querySelector('.pa-overlay.is-on'));
const layout = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, 200);
    const de = document.documentElement;
    let wide = 0;
    for (const el of document.querySelectorAll('.pz *, .pze *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5)) wide++;
    }
    return { scrollY: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight, wide };
  });
const noScroll = (l) => l.scrollY === 0 && l.sw <= l.iw && l.sh <= l.ih && l.wide === 0;
const norm = (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c] || c;

async function logic(page, fn, ...args) {
  return page.evaluate(
    async ({ fn, args }) => {
      const m = await import('/src/games/plotzel/logic.ts');
      return m[fn](...args);
    },
    { fn, args },
  );
}

async function typeWord(page, word, enter = true) {
  for (const ch of Array.from(word)) await page.locator(`.pz-key[data-k="${norm(ch)}"]`).click();
  if (enter) await page.locator('.pz-key[data-k="ENTER"]').click();
}

/** Submit a full guess and wait for the flip; returns the score window [before, after] of leftMs. */
async function guess(page, word) {
  const before = (await party(page)).leftMs;
  await typeWord(page, word);
  const after = (await party(page)).leftMs;
  await sleep(1700);
  return { before, after };
}

async function rowCodes(page, r) {
  return page.evaluate((r) => {
    const row = document.querySelectorAll('.pz-row')[r];
    return Array.from(row.querySelectorAll('.pz-tile'))
      .map((t) => (t.classList.contains('is-correct') ? 'G' : t.classList.contains('is-present') ? 'Y' : t.classList.contains('is-absent') ? '.' : '_'))
      .join('');
  }, r);
}

async function open(browser, device, url, name) {
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  // the harness' own ❄️ / 🔊 / ✕ buttons sit over the bottom-left keys; tests freeze through __party
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.dv-tools{display:none!important}';
      document.head.appendChild(st);
    });
  });
  await page.goto(`${BASE}${url}`);
  const shot = (f) => page.screenshot({ path: path.join(OUT, `${name}-${f}.png`) });
  return { context, page, errors, shot };
}

// ───────────────────────────── builtin ─────────────────────────────
async function builtin(browser, device, name) {
  const DUR = 60000;
  const { context, page, errors, shot } = await open(browser, device, `/dev.html?game=plotzel&seed=7&duration=${DUR}&plotzel=builtin`, name);
  await page.waitForSelector('.pz-key');
  await sleep(400);
  await shot('1-start');
  const answer = await logic(page, 'pickAnswer', 7);
  check(`${name} answer for seed 7 is a word`, Array.from(answer).length === 5, answer);
  const l = await layout(page);
  check(`${name} builtin: no scroll / overflow`, noScroll(l), l);
  const keyMin = await page.evaluate(() => {
    let w = 1e9;
    let h = 1e9;
    for (const k of document.querySelectorAll('.pz-key')) {
      const r = k.getBoundingClientRect();
      w = Math.min(w, r.width);
      h = Math.min(h, r.height);
    }
    return { w, h, n: document.querySelectorAll('.pz-key').length };
  });
  check(`${name} keyboard: 22 letters + 2, keys >= 30x44`, keyMin.n === 24 && keyMin.w >= 30 && keyMin.h >= 44, keyMin);
  check(`${name} nothing focusable took focus`, await page.evaluate(() => !document.querySelector('input, textarea') && document.activeElement === document.body));

  // incomplete row: shakes, no score
  await typeWord(page, 'לי');
  await sleep(150);
  await shot('2-incomplete');
  check(`${name} incomplete row not submitted`, (await rowCodes(page, 0)) === '_____' && (await party(page)).score === 0);
  await page.locator('.pz-key[data-k="DEL"]').click();
  await page.locator('.pz-key[data-k="DEL"]').click();

  // row 1: שולחן (ן typed as נ, displayed final)
  await guess(page, 'שולחנ');
  const lastTile = await page.evaluate(() => document.querySelectorAll('.pz-row')[0].querySelectorAll('.pz-tile')[4].textContent);
  check(`${name} last letter displayed in final form`, lastTile === 'ן', lastTile);
  const want1 = (await logic(page, 'evaluateGuess', 'שולחן', answer)).map((s) => (s === 'correct' ? 'G' : s === 'present' ? 'Y' : '.')).join('');
  const got1 = await rowCodes(page, 0);
  check(`${name} row 1 colors`, got1 === want1, { got1, want1 });
  const c1 = await logic(page, 'countStates', await logic(page, 'evaluateGuess', 'שולחן', answer));
  let best = await logic(page, 'partialScore', c1.greens, c1.yellows);
  check(`${name} row 1 partial score`, (await party(page)).score === best, { score: (await party(page)).score, best });
  await shot('3-row1');

  // row 2: duplicate letters (מילים vs לימון: one י green, second י grey, first מ yellow, second מ grey)
  await guess(page, 'מילים');
  const want2 = (await logic(page, 'evaluateGuess', 'מילים', answer)).map((s) => (s === 'correct' ? 'G' : s === 'present' ? 'Y' : '.')).join('');
  const got2 = await rowCodes(page, 1);
  check(`${name} row 2 duplicate-letter colors`, got2 === want2, { got2, want2 });
  if (answer === 'לימון') check(`${name} duplicate case is Y G Y . .`, got2 === 'YGY..', got2);
  const c2 = await logic(page, 'countStates', await logic(page, 'evaluateGuess', 'מילים', answer));
  best = Math.max(best, await logic(page, 'partialScore', c2.greens, c2.yellows));
  check(`${name} row 2 best partial`, (await party(page)).score === best, { score: (await party(page)).score, best });
  const keyCls = await page.evaluate(() => ({
    y: document.querySelector('.pz-key[data-k="י"]').className,
    sh: document.querySelector('.pz-key[data-k="ש"]').className,
  }));
  check(`${name} keys colored by best state`, keyCls.y.includes('is-correct') && keyCls.sh.includes('is-absent'), keyCls);
  await shot('4-row2-dupes');

  // freeze in the middle of a flip: nothing moves, keys are dead
  await typeWord(page, 'גבינה');
  await sleep(250);
  await page.evaluate(() => window.__party.freeze(2500));
  await sleep(300);
  const midA = await rowCodes(page, 2);
  await sleep(1200);
  const midB = await rowCodes(page, 2);
  await shot('5-frozen-midflip');
  check(`${name} freeze stops the flip`, midA === midB && (await party(page)).frozen, { midA, midB });
  await sleep(1400 + 1700);
  const after = await rowCodes(page, 2);
  check(`${name} flip resumes after the freeze`, !after.includes('_'), after);

  // solve on try 4
  const t = await guess(page, answer);
  const s = (await party(page)).score;
  const lo = await logic(page, 'solvedScore', 4, t.after, DUR);
  const hi = await logic(page, 'solvedScore', 4, t.before, DUR);
  check(`${name} solved score = 1000-(4-1)*100+round(500*left/dur)`, s >= lo && s <= hi, { s, lo, hi });
  await sleep(200);
  await shot('6-solved');
  await sleep(2600);
  check(`${name} finish() after solving`, await finishedOverlay(page));
  await shot('7-finished');
  check(`${name} no console errors`, errors.length === 0, errors);
  await context.close();
}

async function builtinFail(browser, device, name) {
  const { context, page, errors, shot } = await open(browser, device, `/dev.html?game=plotzel&seed=7&duration=90000&plotzel=builtin`, name);
  await page.waitForSelector('.pz-key');
  const answer = await logic(page, 'pickAnswer', 7);
  const words = ['שולחן', 'מכונה', 'ספרים', 'גבינה', 'דבורה', 'תמונה'].filter((w) => w !== answer);
  let best = 0;
  for (const w of words.slice(0, 6)) {
    await guess(page, w);
    const c = await logic(page, 'countStates', await logic(page, 'evaluateGuess', w, answer));
    best = Math.max(best, await logic(page, 'partialScore', c.greens, c.yellows));
  }
  await sleep(900);
  await shot('8-failed-reveal');
  const rev = await page.evaluate(() => ({ on: !!document.querySelector('.pz-reveal.is-on'), word: document.querySelector('.pz-reveal-word').textContent }));
  check(`${name} failed: answer revealed`, rev.on && rev.word === answer, { rev, answer });
  check(`${name} failed: score = best partial`, (await party(page)).score === best, { score: (await party(page)).score, best });
  await sleep(3000);
  check(`${name} finish() after 6 rows`, await finishedOverlay(page));
  check(`${name} no console errors`, errors.length === 0, errors);
  await context.close();
}

async function small(browser) {
  const device = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent };
  const { context, page, shot } = await open(browser, device, `/dev.html?game=plotzel&seed=11&duration=60000&plotzel=builtin`, 'small');
  await page.waitForSelector('.pz-key');
  await typeWord(page, 'שולחן');
  await sleep(1700);
  await typeWord(page, 'פרחים', false);
  await sleep(200);
  await shot('360x640');
  const l = await layout(page);
  check('360x640: no scroll / overflow', noScroll(l), l);
  const keyMin = await page.evaluate(() => {
    let w = 1e9;
    let h = 1e9;
    for (const k of document.querySelectorAll('.pz-key')) {
      const r = k.getBoundingClientRect();
      w = Math.min(w, r.width);
      h = Math.min(h, r.height);
    }
    return { w, h };
  });
  check('360x640: keys >= 30x44', keyMin.w >= 30 && keyMin.h >= 44, keyMin);
  await context.close();
}

// ───────────────────────────── embed ─────────────────────────────
async function embedBridge(browser, device, name) {
  const DUR = 60000;
  const url = `/dev.html?game=plotzel&seed=7&duration=${DUR}&plotzel=embed&plotzelUrl=${encodeURIComponent(MOCK + '?bad=1')}`;
  const { context, page, errors, shot } = await open(browser, device, url, name);
  await page.waitForSelector('.pze-frame');
  await page.waitForFunction(() => document.querySelector('.pze')?.dataset.state === 'bridge', null, { timeout: 8000 });
  const src = await page.evaluate(() => document.querySelector('.pze-frame').src);
  const q = new URL(src).searchParams;
  check(`${name} iframe params seed/embed/lang`, q.get('seed') === '7' && q.get('embed') === '1' && q.get('lang') === 'he', src);
  check(`${name} bridge hello hides the self-report bar`, await page.evaluate(() => document.querySelector('.pze-bar').classList.contains('is-hidden')));
  check(`${name} malformed messages ignored`, (await party(page)).score === 0 && !(await finishedOverlay(page)));
  // a message from our own page (not the iframe) is ignored
  await page.evaluate(() => window.postMessage({ source: 'plotzel', type: 'solved', tries: 1 }, '*'));
  await sleep(200);
  check(`${name} message from another window ignored`, (await party(page)).score === 0);
  await shot('1-bridge-start');
  const frame = page.frameLocator('.pze-frame');
  await frame.locator('#g1').click(); // שולחן vs לימון: 1 green 2 yellow
  await sleep(200);
  check(`${name} progress -> partial 100`, (await party(page)).score === 100, await party(page));
  await frame.locator('#g2').click(); // מילון: 3 green 2 yellow
  await sleep(200);
  check(`${name} progress -> partial 220`, (await party(page)).score === 220, await party(page));
  await shot('2-bridge-progress');
  const before = (await party(page)).leftMs;
  await frame.locator('#g3').click(); // solved on try 3
  await sleep(150);
  const after = (await party(page)).leftMs;
  const s = (await party(page)).score;
  const lo = await logic(page, 'solvedScore', 3, after, DUR);
  const hi = await logic(page, 'solvedScore', 3, before, DUR);
  check(`${name} solved -> 1000-200+time bonus`, s >= lo && s <= hi, { s, lo, hi });
  await shot('3-bridge-solved');
  await sleep(1600);
  check(`${name} finish() after bridge solved`, await finishedOverlay(page));
  await shot('4-bridge-finished');
  check(`${name} no console errors`, errors.length === 0, errors);
  await context.close();
}

async function embedNoBridge(browser, device, name, failPath) {
  const DUR = 60000;
  const url = `/dev.html?game=plotzel&seed=7&duration=${DUR}&plotzelUrl=${encodeURIComponent(MOCK + '?bridge=0')}`;
  const { context, page, errors, shot } = await open(browser, device, url, name);
  await page.waitForFunction(() => document.querySelector('.pze')?.dataset.state === 'ready', null, { timeout: 8000 });
  await sleep(300);
  check(`${name} default mode is embed`, await page.evaluate(() => !!document.querySelector('.pze') && !document.querySelector('.pz')));
  check(`${name} self-report bar visible`, await page.evaluate(() => !document.querySelector('.pze-bar').classList.contains('is-hidden')));
  const l = await layout(page);
  check(`${name} embed: no scroll / overflow`, noScroll(l), l);
  await shot('1-nobridge');

  // freeze: opaque cover over the iframe, bar taps ignored
  await page.evaluate(() => window.__party.freeze(2000));
  await sleep(300);
  const fz = await page.evaluate(() => {
    const c = document.querySelector('.pze-freeze');
    return { on: c.classList.contains('is-on'), bg: getComputedStyle(c).backgroundImage !== 'none' };
  });
  check(`${name} freeze covers the iframe`, fz.on && fz.bg, fz);
  await shot('2-frozen');
  await sleep(2200);
  check(`${name} cover gone after the freeze`, await page.evaluate(() => !document.querySelector('.pze-freeze').classList.contains('is-on')));

  if (failPath) {
    await page.locator('.pze-n.is-fail').click();
    await shot('3-armed-fail');
    check(`${name} first tap only arms`, (await party(page)).score === 0 && !(await finishedOverlay(page)));
    await page.locator('.pze-n.is-fail').click({ force: true });
    await sleep(1600);
    check(`${name} "לא הצלחתי" confirmed -> 0 and finish`, (await party(page)).score === 0 && (await finishedOverlay(page)));
    await shot('4-fail-finished');
  } else {
    await page.locator('.pze-n[data-act="tries-2"]').click();
    await page.locator('.pze-n[data-act="tries-3"]').click(); // re-arm on another number
    await shot('3-armed');
    check(`${name} taps only arm`, (await party(page)).score === 0 && !(await finishedOverlay(page)));
    const before = (await party(page)).leftMs;
    await page.locator('.pze-n[data-act="tries-3"]').click({ force: true }); // armed = pulsing, never "stable"
    const after = (await party(page)).leftMs;
    const s = (await party(page)).score;
    const lo = await logic(page, 'solvedScore', 3, after, DUR);
    const hi = await logic(page, 'solvedScore', 3, before, DUR);
    check(`${name} self-report 3 tries -> formula`, s >= lo && s <= hi, { s, lo, hi });
    await sleep(1600);
    check(`${name} finish() after self-report`, await finishedOverlay(page));
    await shot('4-selfreport-finished');
  }
  check(`${name} no console errors`, errors.length === 0, errors);
  await context.close();
}

async function embedUnreachable(browser, device, name, target, waitMs, how) {
  const url = `/dev.html?game=plotzel&seed=7&duration=60000&plotzel=embed&plotzelUrl=${encodeURIComponent(target)}`;
  const context = await browser.newContext({ ...device });
  if (how === 'hang') await context.route('**/plotzel-hang/**', () => undefined);
  const page = await context.newPage();
  const shot = (f) => page.screenshot({ path: path.join(OUT, `${name}-${f}.png`) });
  await page.goto(`${BASE}${url}`);
  await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  await page.waitForSelector('.pze');
  await sleep(500);
  await shot('1-loading');
  if (how === 'help') {
    // the site "loads" an error page (here: the egress proxy refuses it): the player uses the link
    await sleep(1500);
    check(`${name} error page counts as loaded (no auto notice)`, (await page.evaluate(() => document.querySelector('.pze').dataset.state)) === 'ready');
    await page.locator('.pze-link').click();
  }
  await page.waitForFunction(() => document.querySelector('.pze')?.dataset.state === 'failed', null, { timeout: waitMs });
  await sleep(200);
  await shot('2-notice');
  check(`${name} notice shown`, await page.evaluate(() => document.querySelector('.pze-failed').classList.contains('is-on')));
  await page.locator('.pze-btn[data-act="builtin"]').click();
  await page.waitForSelector('.pz-key');
  check(`${name} switched to builtin`, await page.evaluate(() => !document.querySelector('.pze') && !!document.querySelector('.pz')));
  const answer = await logic(page, 'pickAnswer', 7);
  await guess(page, 'שולחן');
  const c = await logic(page, 'countStates', await logic(page, 'evaluateGuess', 'שולחן', answer));
  const want = await logic(page, 'partialScore', c.greens, c.yellows);
  check(`${name} builtin partial after switch`, (await party(page)).score === want, { score: (await party(page)).score, want });
  await page.evaluate(() => window.__party.freeze(1500));
  await sleep(300);
  await page.locator('.pz-key[data-k="ק"]').click({ force: true }).catch(() => undefined);
  await shot('3-switched-frozen');
  check(`${name} keys dead while frozen`, (await rowCodes(page, 1)) === '_____' && (await page.evaluate(() => document.querySelectorAll('.pz-row')[1].textContent)) === '');
  await context.close();
}

(async () => {
  const want = new Set(process.argv.slice(2));
  const on = (s) => want.size === 0 || want.has(s);
  const browser = await chromium.launch();
  try {
    if (on('builtin')) {
      await builtin(browser, devices['iPhone 14'], 'iphone-builtin');
      await builtin(browser, devices['Pixel 7'], 'pixel-builtin');
      await builtinFail(browser, devices['iPhone 14'], 'iphone-fail');
    }
    if (on('small')) await small(browser);
    if (on('embed')) {
      await embedBridge(browser, devices['iPhone 14'], 'iphone-embed');
      await embedBridge(browser, devices['Pixel 7'], 'pixel-embed');
    }
    if (on('noBridge')) {
      await embedNoBridge(browser, devices['iPhone 14'], 'iphone-nobridge', false);
      await embedNoBridge(browser, devices['Pixel 7'], 'pixel-nobridge', true);
    }
    if (on('unreachable')) await embedUnreachable(browser, devices['Pixel 7'], 'pixel-unreachable', 'http://127.0.0.1:5999/', 8000, 'refused');
    if (on('hang')) await embedUnreachable(browser, devices['iPhone 14'], 'iphone-hang', 'http://127.0.0.1:5214/plotzel-hang/', 9000, 'hang');
    if (on('blocked')) await embedUnreachable(browser, devices['iPhone 14'], 'iphone-blocked', 'http://10.255.255.1/', 3000, 'help');
  } finally {
    await browser.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
