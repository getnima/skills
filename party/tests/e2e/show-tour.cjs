// The TV show tour: screenshots of every scene + layout / perf checks.
// Needs vite on :5204 (PARTY_CLIENT_PORT=5204 npx vite). Usage: node show-tour.cjs [section ...]
const { chromium, devices } = require('playwright');
const path = require('path');
const BASE = process.env.SHOW_BASE || 'http://localhost:5204';
const OUT = path.join(__dirname, 'out', 'show');
const only = process.argv.slice(2);
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const TV = { width: 1920, height: 1080 };
const HD = { width: 1280, height: 720 };

async function open(browser, query, viewport = TV, device) {
  const context = await browser.newContext(device ? { ...device } : { viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/show.html?bare=1&${query}`);
  await page.waitForSelector('.sh-scene');
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const done = async (label) => {
    check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3));
    await context.close();
  };
  return { page, shot, done };
}

const layout = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, 200);
    const de = document.documentElement;
    return { scrollY: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight };
  });
const noScroll = (l) => l.scrollY === 0 && l.sw <= l.iw && l.sh <= l.ih;
const order = (page) => page.evaluate(() => [...document.querySelectorAll('.sh-row:not(.is-hidden)')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((r) => r.querySelector('.sh-name').textContent + ':' + r.querySelector('.sh-score').textContent).join(' | '));

const sections = {
  async race(browser) {
    for (const n of [3, 12, 45]) {
      const { page, shot, done } = await open(browser, `players=${n}`);
      await page.waitForTimeout(9000);
      await shot(`race-${n}-a`);
      const a = await order(page);
      await page.waitForTimeout(6000);
      await shot(`race-${n}-b`);
      const b = await order(page);
      check(`race ${n}: scores / order moved between shots`, a !== b, { a: a.slice(0, 80), b: b.slice(0, 80) });
      const l = await layout(page);
      check(`race ${n}: no scroll`, noScroll(l), l);
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.sh-row:not(.is-hidden)')];
        const name = rows[0].querySelector('.sh-name');
        const long = [...document.querySelectorAll('.sh-row .sh-name')].find((el) => el.textContent.includes('מקסימיליאן'));
        return {
          rows: rows.length,
          namePx: parseFloat(getComputedStyle(name).fontSize),
          dir: getComputedStyle(document.querySelector('.sh-scene')).direction,
          rankRightOfBar: rows[0].querySelector('.sh-rank').getBoundingClientRect().left > rows[0].querySelector('.sh-track').getBoundingClientRect().right,
          longEllipsis: long ? { overflow: long.scrollWidth > long.clientWidth, css: getComputedStyle(long).textOverflow } : null,
        };
      });
      check(`race ${n}: names >= 40px, RTL`, m.namePx >= 40 && m.dir === 'rtl' && m.rankRightOfBar, m);
      check(`race ${n}: visible rows`, m.rows === Math.min(n, n <= 12 ? 12 : 10), m.rows);
      await done(`race ${n}`);
    }
  },

  async moments(browser) {
    const { page, shot, done } = await open(browser, 'players=12');
    await page.waitForTimeout(7000);
    await page.evaluate(() => window.__show.simulate(false));
    await page.waitForTimeout(6500); // let the queue drain
    const types = ['lead', 'overtake', 'jump', 'drop', 'tie', 'last', 'comeback', 'zero', 'final10', 'photo', 'streak'];
    for (const t of types) {
      await page.evaluate((type) => window.__show.force(type), t);
      if (t === 'lead') { await page.waitForTimeout(480); await shot('moment-lead-crown-hop'); }
      if (t === 'drop') { await page.waitForTimeout(160); await shot('moment-drop-flash'); }
      await page.waitForTimeout(t === 'lead' ? 600 : t === 'drop' ? 900 : 1050);
      await shot(`moment-${t}`);
      const bubble = await page.evaluate(() => {
        const c = document.querySelector('.sh-comm');
        const b = document.querySelector('.sh-comm-bubble');
        return { on: c.classList.contains('is-on'), text: b.textContent, px: parseFloat(getComputedStyle(b).fontSize), stickers: document.querySelectorAll('.sh-sticker').length };
      });
      check(`moment ${t}: commentator speaks`, bubble.on && bubble.text.length > 5 && bubble.px >= 48, bubble);
      await page.waitForTimeout(6200); // bubble hold + gap
    }
    // calm: no stickers, no flash
    await page.evaluate(() => { window.__show.calm(true); window.__show.force('drop'); });
    await page.waitForTimeout(500);
    const calm = await page.evaluate(() => document.querySelectorAll('.sh-sticker').length);
    await shot('moment-drop-calm');
    check('calm: no stickers', calm === 0, calm);
    await page.evaluate(() => window.__show.calm(false));
    await done('moments');
  },

  async frozen(browser) {
    const { page, shot, done } = await open(browser, 'players=12');
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.__show.freeze(true));
    await page.waitForTimeout(600);
    const a = await page.evaluate(() => ({ t: document.querySelector('.sh-ring-num').textContent, left: window.__show.state().leftMs }));
    await page.waitForTimeout(2500);
    const b = await page.evaluate(() => ({ t: document.querySelector('.sh-ring-num').textContent, left: window.__show.state().leftMs, cls: document.querySelector('.sh-scene').className }));
    await shot('frozen');
    check('frozen: clock stands still', a.t === b.t && a.left === b.left && b.cls.includes('is-frozen'), { a, b });
    await page.evaluate(() => window.__show.freeze(false));
    await page.evaluate(() => window.__show.seek(52000));
    await page.waitForTimeout(3500);
    await shot('final-seconds');
    await done('frozen');
  },

  async results(browser) {
    const { page, shot, done } = await open(browser, 'players=12&sim=0');
    // start a results run and wait until T ms relative to the winner reveal (page clock, so screenshots do not drift)
    let reveal = 0;
    const start = async (kind, lead) => { reveal = await page.evaluate(([k, l]) => { window.__show.results(k, l); return Date.now() + l; }, [kind, lead]); };
    const at = (T) => page.waitForFunction((when) => Date.now() >= when, reveal + T, { polling: 30 });
    await start('one', 8000);
    await at(-4400);
    await shot('results-suspense-1');
    await at(-900);
    await shot('results-suspense-2');
    const s = await page.evaluate(() => ({ rows: document.querySelectorAll('.sh-rrow.is-on').length, tense: document.querySelector('.sh-scene').className.includes('is-tense'), winnerShown: !!document.querySelector('.sh-cer') }));
    check('results: suspense stops before first place', s.rows >= 6 && s.tense && !s.winnerShown, s);
    await at(300);
    await shot('results-blackout');
    await at(1000);
    await shot('ceremony-1-name');
    await at(2300);
    await shot('ceremony-2-descending');
    await at(5400);
    await shot('ceremony-3-settled');
    const c = await page.evaluate(() => {
      const name = document.querySelector('.sh-cer-name');
      const img = document.querySelector('.sh-prize-img');
      return { name: name && name.textContent, px: name && parseFloat(getComputedStyle(name).fontSize), line: document.querySelector('.sh-cer-line').textContent, prize: img && img.naturalWidth, bubble: document.querySelector('.sh-comm-bubble').textContent };
    });
    check('ceremony: huge name + prize + line', c.px >= 130 && c.line.includes('שימי אנג׳ל') && c.prize > 0, c);
    await at(8500);
    await shot('ceremony-4-hold');
    await at(10600 + 1000);
    await shot('standings-0-prev-order');
    await at(10600 + 2300);
    await shot('standings-1-moving');
    await at(10600 + 4600);
    await shot('standings-2-spotlight');
    await at(10600 + 9000);
    await shot('standings-3-rest');
    const st = await page.evaluate(() => ({ banner: document.querySelector('.sh-banner-text').textContent, rows: document.querySelectorAll('.sh-trow:not(.is-hidden)').length, namePx: parseFloat(getComputedStyle(document.querySelector('.sh-trow .sh-name')).fontSize) }));
    check('standings: banner + readable table', st.banner.includes('שימי אנג׳ל') && st.rows >= 9 && st.namePx >= 40, st);
    check('results: no scroll', noScroll(await layout(page)));

    // late mount: jumps straight to the right stage
    await start('one', -30000);
    await page.waitForTimeout(700);
    const late = await page.evaluate(() => document.querySelector('.sh-scene').className);
    check('results: late mount lands on standings', late.includes('sh-results--standings'), late);

    // tie
    await start('tie', 1200);
    await at(1100);
    await shot('ceremony-tie-1-name');
    await at(2400);
    await shot('ceremony-tie-2-descending');
    await at(5600);
    await shot('ceremony-tie-3-settled');
    // no ties since the strict ranking: the same raw score is won by whoever reached it first
    const tie = await page.evaluate(() => ({ names: document.querySelectorAll('.sh-cer-name').length, earlier: !!document.querySelector('.sh-cer-earlier'), text: document.querySelector('.sh-cer-text').textContent }));
    check('ceremony: the same score has ONE winner, who got there first', tie.names === 1 && tie.earlier && !/תיקו/.test(tie.text), tie);

    // nobody
    await start('none', 1200);
    await at(2600);
    await shot('ceremony-nobody');
    const nobody = await page.evaluate(() => document.querySelector('.sh-nobody-text').textContent);
    check('ceremony: nobody beat', nobody.includes('אף אחד לא זכה') && nobody.includes('המלאך נשאר בבית'), nobody);
    await at(6000 + 2500);
    await shot('standings-nobody');

    // cutscene covering the suspense: holds, then continues
    await start('one', 4000);
    await page.evaluate(() => window.__show.active(false));
    await at(1500);
    const held = await page.evaluate(() => document.querySelector('.sh-scene').className);
    check('results: inactive holds the reveal', !held.includes('sh-results--ceremony'), held);
    await done('results');

    // 45 players
    const big = await open(browser, 'players=45&sim=0');
    await big.page.evaluate(() => window.__show.results('one', 8000));
    await big.page.waitForTimeout(7300);
    await big.shot('results-45-suspense');
    await big.page.waitForTimeout(700 + 10600 + 8000 + 7000);
    await big.shot('standings-45-page');
    await big.done('results 45');
  },

  async final(browser) {
    for (const n of [40, 3, 1, 2]) {
      const { page, shot, done } = await open(browser, `players=${n}&sim=0&scene=final`);
      if (n === 40) {
        await page.waitForTimeout(1500);
        await shot('final-40-0-intro');
        await page.waitForTimeout(4200); // 5.7s: third + second
        await shot('final-40-1-mid');
        await page.waitForTimeout(3300); // 9s: champion
        await shot('final-40-2-champion');
        await page.waitForTimeout(6500); // 15.5s: table
        await shot('final-40-3-table');
        await page.waitForTimeout(6000);
        await shot('final-40-4-table-page2');
        const t = await page.evaluate(() => ({ rows: document.querySelectorAll('.sh-frow').length, sub: document.querySelector('.sh-ftable .sh-head-sub').textContent }));
        check('final 40: table paginates', t.rows === 10 && t.sub.includes('מתוך 40') && !t.sub.includes('1–10'), t);
      } else {
        await page.waitForTimeout(n === 3 ? 11500 : 9000);
        await shot(`final-${n}-settled`);
        const up = await page.evaluate(() => document.querySelectorAll('.sh-pod.is-up').length);
        check(`final ${n}: podium columns`, up === n, up);
      }
      check(`final ${n}: no scroll`, noScroll(await layout(page)));
      await done(`final ${n}`);
    }
  },

  async panel(browser) {
    const { page, shot, done } = await open(browser, 'players=14&sim=0');
    await page.evaluate(() => window.__show.results('one', -60000));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__show.scene('standings'));
    await page.waitForTimeout(800);
    await shot('panel');
    const p = await page.evaluate(() => ({ rows: document.querySelectorAll('.sh-prow').length, more: document.querySelector('.sh-panel-more').textContent, hints: document.querySelectorAll('.sh-prow .sh-move').length }));
    check('panel: top 8 + more + hints', p.rows === 8 && p.more.includes('6') && p.hints > 0, p);
    await done('panel');
    const ctl = await browser.newContext({ viewport: TV });
    const cp = await ctl.newPage();
    await cp.goto(`${BASE}/show.html?players=20`);
    await cp.waitForTimeout(8000);
    await cp.screenshot({ path: path.join(OUT, 'control-room.png') });
    await ctl.close();
  },

  async small(browser) {
    // 1280x720
    let s = await open(browser, 'players=12', HD);
    await s.page.waitForTimeout(8000);
    await s.shot('hd-race-12');
    await s.page.evaluate(() => window.__show.results('one', 1000));
    await s.page.waitForTimeout(1000 + 5000);
    await s.shot('hd-ceremony');
    check('hd: no scroll', noScroll(await layout(s.page)));
    await s.done('hd');
    // phone portrait
    for (const [label, device] of [['iphone', devices['iPhone 14']], ['pixel', devices['Pixel 7']]]) {
      s = await open(browser, 'players=45', undefined, device);
      await s.page.waitForTimeout(9000);
      await s.shot(`${label}-race-45`);
      check(`${label}: race no scroll`, noScroll(await layout(s.page)));
      if (label === 'iphone') {
        await s.page.evaluate(() => window.__show.results('one', 5000));
        await s.page.waitForTimeout(4000);
        await s.shot('iphone-suspense');
        await s.page.waitForTimeout(1000 + 5000);
        await s.shot('iphone-ceremony');
        await s.page.waitForTimeout(5600 + 4500);
        await s.shot('iphone-standings');
        await s.page.evaluate(() => window.__show.scene('final'));
        await s.page.waitForTimeout(9500);
        await s.shot('iphone-final-champion');
        await s.page.waitForTimeout(6000);
        await s.shot('iphone-final-table');
        await s.page.evaluate(() => window.__show.scene('standings'));
        await s.page.waitForTimeout(600);
        await s.shot('iphone-panel');
        check('iphone: no scroll', noScroll(await layout(s.page)));
      }
      await s.done(label);
    }
  },

  async perf(browser) {
    const { page, done } = await open(browser, 'players=60');
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    await page.waitForTimeout(6000);
    const run = async (label, ms, soft = false) => {
      const m0 = await metrics();
      const frames = await page.evaluate((dur) => new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const end = last + dur;
        const tick = (t) => { out.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else resolve(out); };
        requestAnimationFrame(tick);
      }), ms);
      const m1 = await metrics();
      frames.sort((a, b) => a - b);
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      const res = {
        frames: frames.length, avgMs: +avg.toFixed(2), p95Ms: +frames[Math.floor(frames.length * 0.95)].toFixed(1), maxMs: +frames[frames.length - 1].toFixed(1),
        over33: frames.filter((f) => f > 33.4).length,
        layoutsPerSec: +((m1.LayoutCount - m0.LayoutCount) / (ms / 1000)).toFixed(1),
        layoutMsPerSec: +(((m1.LayoutDuration - m0.LayoutDuration) * 1000) / (ms / 1000)).toFixed(2),
        styleMsPerSec: +(((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / (ms / 1000)).toFixed(2),
        scriptMsPerSec: +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / (ms / 1000)).toFixed(2),
        taskMsPerSec: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / (ms / 1000)).toFixed(1),
      };
      // headless Chromium rasters in software: full-screen animation there costs frames a GPU does not.
      // What must hold everywhere is a quiet main thread (no layout thrash, little script).
      check(`perf ${label}: main thread quiet`, res.layoutMsPerSec < 60 && res.scriptMsPerSec < 60 && res.taskMsPerSec < 600 && res.avgMs < (soft ? 45 : 24), res);
    };
    await run('60 players racing', 6000);
    await page.evaluate(() => { for (const t of ['lead', 'drop', 'final10']) window.__show.force(t); });
    await run('60 players + moments', 4000);
    await page.evaluate(() => window.__show.results('one', 300));
    await page.waitForTimeout(1500);
    await run('ceremony', 5000, true);
    await done('perf');
  },
};

(async () => {
  const browser = await chromium.launch();
  const names = only.length ? only : Object.keys(sections);
  await Promise.all(names.map((n) => sections[n](browser).catch((e) => { console.log('FAIL section ' + n + ': ' + e.message.split('\n')[0]); fails.push('section ' + n); })));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
