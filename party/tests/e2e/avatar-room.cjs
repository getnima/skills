// The dressing room, end to end, with real touch input on six phone sizes.
//   vite on 5295:  PARTY_CLIENT_PORT=5295 PARTY_SERVER_PORT=8295 npx vite
//   node tests/e2e/avatar-room.cjs [size-name]
// Per size: no page movement while dragging the tray / the stage, every tab reachable and >= 44 px,
// one item per slot + a plate, a three-hat tower (+ a fourth that replaces the top), shake off,
// ten randomizes, done (onDone / onChange through the lab), a 40-tap flood in 3 s (final look ==
// the taps, no ghost), and the lab's ?look= restore. Screenshots go to tests/e2e/out/avatar-room/.
const { chromium } = require('playwright');
const { SIZES, openRoom, labLook, labDone, probe, shot } = require('./avatar-room-lib.cjs');

const results = [];
let fails = 0;
function check(size, name, ok, info = '') {
  results.push({ size, name, ok, info });
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${size}] ${name}${info ? ` - ${info}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, arg, timeout = 6000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
    return true;
  } catch {
    return false;
  }
}

/** Waits until nothing flies, the shuffle is over and the effects layer is empty. */
async function settle(page, timeout = 6000) {
  return waitFor(
    page,
    () => {
      const p = window.__dressingRoom;
      const fx = document.querySelector('.dr-fx');
      return p && p.flying === 0 && fx && fx.childElementCount === 0;
    },
    null,
    timeout,
  );
}

async function pageState(page) {
  return page.evaluate(() => {
    const r = document.querySelector('.dr').getBoundingClientRect();
    const vv = window.visualViewport;
    return {
      sx: window.scrollX,
      sy: window.scrollY,
      top: Math.round(r.top),
      left: Math.round(r.left),
      w: Math.round(r.width),
      h: Math.round(r.height),
      vvx: vv ? Math.round(vv.pageLeft) : 0,
      vvy: vv ? Math.round(vv.pageTop) : 0,
      scale: vv ? vv.scale : 1,
    };
  });
}

async function touchDrag(cdp, x0, y0, x1, y1, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x0, y: y0 }],
  });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }],
    });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

async function boxOf(page, sel) {
  return page.locator(sel).first().boundingBox();
}

async function tapAt(page, x, y) {
  await page.touchscreen.tap(x, y);
}

async function tapSel(page, sel) {
  const b = await boxOf(page, sel);
  if (!b) throw new Error(`nothing at ${sel}`);
  await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
  return b;
}

/** The expected look after these taps, by the catalog's own rules (run in the page). */
async function expectedAfter(page, start, taps) {
  return page.evaluate(
    async ({ start, taps }) => {
      const m = await import('/src/avatar/index.ts');
      let l = m.normalizeLook(m.decodeLook(start));
      for (const t of taps) {
        if (t.bg !== undefined) l = { ...l, bg: t.bg };
        else l = m.tapItem(l, t.id);
      }
      return m.encodeLook(l);
    },
    { start, taps },
  );
}

/** Ids of the visible tiles of the open shelf (fully inside it), with their centres. */
async function visibleTiles(page) {
  return page.evaluate(() => {
    const shelf = document.querySelector('.dr-shelf').getBoundingClientRect();
    return [...document.querySelectorAll('.dr-shelf .dr-tile')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.dataset.id ? Number(el.dataset.id) : undefined,
          bg: el.dataset.bg ? Number(el.dataset.bg) : undefined,
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          l: r.left,
          r: r.right,
          w: r.width,
          h: r.height,
        };
      })
      .filter((t) => t.l >= shelf.left - 1 && t.r <= shelf.right + 1);
  });
}

async function domMatches(page) {
  return page.evaluate(async () => {
    const m = await import('/src/avatar/index.ts');
    const p = window.__dressingRoom;
    const look = m.decodeLook(p.look);
    const want = m.wornIds(m.normalizeLook(look)).sort((a, b) => a - b);
    const imgs = [...document.querySelectorAll('.dr-rig .dr-it')];
    const have = imgs.map((i) => Number(i.dataset.item)).sort((a, b) => a - b);
    const hidden = imgs.filter((i) => getComputedStyle(i).visibility === 'hidden').length;
    return {
      ok: JSON.stringify(want) === JSON.stringify(have) && hidden === 0,
      want,
      have,
      hidden,
    };
  });
}

async function runSize(browser, size) {
  const S = size.name;
  const { ctx, page, errors } = await openRoom(browser, size, {
    look: '1.0.0.0.0.0.0',
    settle: 1500,
  });
  const cdp = await ctx.newCDPSession(page);
  const vw = size.width;
  const vh = size.height;
  try {
    await shot(page, `${S}-01-open`);

    // ── layout: fills the screen, nothing outside it ──
    const st0 = await pageState(page);
    check(S, 'room fills the container', st0.w === vw && st0.h === vh && st0.top === 0 && st0.left === 0, JSON.stringify(st0));
    const outside = await page.evaluate(
      ({ vw, vh }) => {
        const bad = [];
        for (const sel of ['.dr-bar', '.dr-tabs', '.dr-tab', '.dr-shelf', '.dr-acts', '.dr-btn', '.dr-name', '.dr-chip']) {
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5)
              bad.push(`${sel} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
          }
        }
        return bad;
      },
      { vw, vh },
    );
    check(S, 'nothing outside the screen', outside.length === 0, outside.join(' | '));
    const small = await page.evaluate(
      () =>
        [...document.querySelectorAll('.dr-tab, .dr-btn, .dr-tile')]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.height < 44 || r.width < 44).length,
    );
    check(S, 'every tab / button / tile at least 44 px', small === 0, `${small} smaller`);
    const textFits = await page.evaluate(() =>
      [...document.querySelectorAll('.dr-tab, .dr-btn')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()),
    );
    check(S, 'tab and button labels fit', textFits.length === 0, textFits.join(', '));

    // ── no page movement while dragging the tray (both directions) or the stage ──
    const shelf = await boxOf(page, '.dr-shelf');
    const sl0 = await page.$eval('.dr-shelf', (e) => e.scrollLeft);
    const cy = shelf.y + shelf.height / 2;
    await touchDrag(cdp, shelf.x + 40, cy, shelf.x + shelf.width - 30, cy + 6);
    await sleep(500);
    const sl1 = await page.$eval('.dr-shelf', (e) => e.scrollLeft);
    const st1 = await pageState(page);
    await touchDrag(cdp, shelf.x + shelf.width - 40, cy, shelf.x + 30, cy - 5);
    await sleep(500);
    await touchDrag(cdp, shelf.x + shelf.width / 2, cy - 10, shelf.x + shelf.width / 2 + 8, cy - 160);
    await sleep(400);
    await touchDrag(cdp, shelf.x + shelf.width / 2, cy - 20, shelf.x + shelf.width / 2 - 8, cy + 120);
    await sleep(400);
    const stage = await boxOf(page, '.dr-stage');
    await touchDrag(cdp, stage.x + stage.width / 2, stage.y + 60, stage.x + stage.width / 2, stage.y + stage.height - 10);
    await sleep(300);
    await touchDrag(cdp, stage.x + stage.width / 2, stage.y + stage.height - 20, stage.x + stage.width / 2 + 60, stage.y + 20);
    await sleep(300);
    await touchDrag(cdp, 20, stage.y + 100, vw - 20, stage.y + 110);
    await sleep(300);
    // a two-finger pinch on the stage and on the tray, and a double tap: no zoom
    for (const [cx, cy2] of [
      [stage.x + stage.width / 2, stage.y + stage.height / 2],
      [shelf.x + shelf.width / 2, cy],
    ]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 20, y: cy2, id: 1 }, { x: cx + 20, y: cy2, id: 2 }] });
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 20 - i * 9, y: cy2 - i * 3, id: 1 }, { x: cx + 20 + i * 9, y: cy2 + i * 3, id: 2 }] });
        await sleep(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(300);
    }
    await tapAt(page, stage.x + stage.width / 2, stage.y + stage.height * 0.6);
    await sleep(60);
    await tapAt(page, stage.x + stage.width / 2, stage.y + stage.height * 0.6);
    await sleep(500);
    const st2 = await pageState(page);
    const same = (a, b) =>
      a.sx === b.sx && a.sy === b.sy && a.top === b.top && a.left === b.left && a.vvx === b.vvx && a.vvy === b.vvy && a.scale === b.scale;
    check(S, 'tray drag scrolls the tray (horizontal)', sl1 !== sl0, `scrollLeft ${sl0} -> ${sl1}`);
    check(S, 'page never moves or zooms (tray drags x/y, stage drags, pinches, double tap)', same(st0, st1) && same(st0, st2), `${JSON.stringify(st1)} ${JSON.stringify(st2)}`);
    await shot(page, `${S}-02-after-drags`);

    // ── every tab reachable ──
    let tabsOk = true;
    for (const t of ['EYES', 'FACE', 'EARS', 'NECK', 'BG', 'HEAD']) {
      await tapSel(page, `.dr-tab[data-tab="${t}"]`);
      const on = await waitFor(page, (t) => document.querySelector(`.dr-tab[data-tab="${t}"]`)?.getAttribute('aria-selected') === 'true', t, 2000);
      const tiles = await visibleTiles(page);
      if (!on || tiles.length === 0) tabsOk = false;
    }
    check(S, 'every tab reachable and shows tiles', tabsOk);

    // ── one item per slot + a plate ──
    const start1 = await probe(page).then((p) => p.look);
    const taps1 = [];
    for (const t of ['HEAD', 'EYES', 'FACE', 'EARS', 'NECK', 'BG']) {
      await tapSel(page, `.dr-tab[data-tab="${t}"]`);
      await sleep(150);
      const tiles = await visibleTiles(page);
      const pickT = t === 'BG' ? tiles.find((x) => x.bg === 3) || tiles[1] : tiles[0];
      await tapAt(page, pickT.x, pickT.y);
      taps1.push(t === 'BG' ? { bg: pickT.bg } : { id: pickT.id });
      if (t === 'NECK') {
        await sleep(160);
        await shot(page, `${S}-03-flying`);
      }
      await sleep(250);
    }
    await settle(page);
    const want1 = await expectedAfter(page, start1, taps1);
    const got1 = (await probe(page)).look;
    check(
      S,
      'one item per slot + a plate',
      got1 === want1 &&
        got1
          .split('.')
          .slice(2)
          .every((v) => v !== '0'),
      `${got1} want ${want1}`,
    );
    await page.waitForTimeout(500);
    check(S, 'onChange reached the lab (debounced)', (await labLook(page)) === got1, `${await labLook(page)}`);
    const dm1 = await domMatches(page);
    check(S, 'doll shows exactly what is worn', dm1.ok, JSON.stringify(dm1));
    await shot(page, `${S}-04-dressed`);

    // ── three-hat tower, then a fourth replaces the top ──
    await tapSel(page, '.dr-tab[data-tab="HEAD"]');
    await sleep(200);
    // take the current hat off first so the tower is built from known hats
    const p0 = await probe(page);
    const startT = p0.look;
    const tapsT = [];
    const towerIds = [8, 17, 2];
    const hatSel = (id) => `.dr-tile[data-id="${id}"]`;
    const curHat = Number(startT.split('.')[2].split('-')[0]);
    const order = curHat > 0 ? [curHat, ...towerIds] : towerIds;
    for (const id of order) {
      await page.$eval(hatSel(id), (e) => {
        const s = e.closest('.dr-shelf');
        const r = e.getBoundingClientRect();
        const sr = s.getBoundingClientRect();
        s.scrollLeft += r.left + r.width / 2 - (sr.left + sr.width / 2);
      });
      await sleep(120);
      await tapSel(page, hatSel(id));
      tapsT.push({ id });
      await sleep(380);
    }
    await settle(page);
    const wantT = await expectedAfter(page, startT, tapsT);
    const gotT = (await probe(page)).look;
    check(S, 'three-hat tower', gotT === wantT && gotT.split('.')[2] === '8-17-2', `${gotT} want ${wantT}`);
    await shot(page, `${S}-05-tower3`);
    await page.$eval(hatSel(10), (e) => {
      const s = e.closest('.dr-shelf');
      const r = e.getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      s.scrollLeft += r.left + r.width / 2 - (sr.left + sr.width / 2);
    });
    await sleep(120);
    await tapSel(page, hatSel(10));
    await settle(page);
    const got4 = (await probe(page)).look;
    check(S, 'a fourth hat replaces the top one', got4.split('.')[2] === '8-17-10', got4);
    await sleep(300);
    await shot(page, `${S}-06-tower-replaced`);

    // ── shake off ──
    const before = (await probe(page)).look;
    await tapSel(page, '.dr-shake');
    await sleep(220);
    await shot(page, `${S}-07-shaking`);
    await settle(page);
    const shaken = (await probe(page)).look;
    check(S, 'shake takes everything off, keeps the plate', shaken === `1.${before.split('.')[1]}.0.0.0.0.0`, `${before} -> ${shaken}`);

    // ── randomize ten times ──
    const seen = new Set();
    for (let i = 0; i < 10; i++) {
      await tapSel(page, '.dr-rand');
      if (i === 4) {
        await sleep(200);
        await shot(page, `${S}-08-shuffle`);
      }
      await sleep(i % 3 === 0 ? 700 : 240);
      seen.add((await probe(page)).look);
    }
    await settle(page);
    await sleep(600);
    const rnd = await probe(page);
    const dmR = await domMatches(page);
    check(
      S,
      'ten randomizes: varied looks, doll matches, report sent',
      seen.size >= 8 && dmR.ok && (await labLook(page)) === rnd.look,
      `${seen.size} distinct, ${JSON.stringify(dmR)}, lab ${await labLook(page)} room ${rnd.look}`,
    );
    await shot(page, `${S}-09-random`);

    // ── done ──
    await tapSel(page, '.dr-done');
    await sleep(250);
    await shot(page, `${S}-10-done`);
    const done = await labDone(page);
    const p2 = await probe(page);
    check(
      S,
      'done: onDone got the look, onChange too',
      done === p2.look && (await labLook(page)) === p2.look && p2.lastDone === p2.look,
      `onDone ${done} room ${p2.look}`,
    );
    await settle(page);

    // ── flood: 40 taps in 3 s ──
    await tapSel(page, '.dr-tab[data-tab="HEAD"]');
    await sleep(300);
    const startF = (await probe(page)).look;
    const tilesF = (await visibleTiles(page)).slice(0, 6);
    const tapsF = [];
    const tapsBefore = (await probe(page)).taps;
    const t0 = Date.now();
    let k = 0x9e3779b9 ^ size.width;
    for (let i = 0; i < 40; i++) {
      k ^= k << 13;
      k ^= k >>> 17;
      k ^= k << 5;
      k >>>= 0;
      const t = tilesF[k % tilesF.length];
      await tapAt(page, t.x, t.y);
      tapsF.push({ id: t.id });
      const left = t0 + ((i + 1) * 2900) / 40 - Date.now();
      if (left > 0) await sleep(left);
    }
    const floodMs = Date.now() - t0;
    await sleep(100);
    await shot(page, `${S}-11-flood`);
    const settled = await settle(page, 8000);
    const wantF = await expectedAfter(page, startF, tapsF);
    const gotF = (await probe(page)).look;
    const dmF = await domMatches(page);
    await sleep(600);
    const tapsGot = (await probe(page)).taps - tapsBefore;
    check(
      S,
      `flood 40 taps in ${floodMs} ms: all 40 handled, final look == taps`,
      gotF === wantF && tapsGot === 40,
      `${tapsGot} taps, ${gotF} want ${wantF} (start ${startF})`,
    );
    check(S, 'flood: no ghost (nothing in flight, doll == look, fx layer empty)', settled && dmF.ok, JSON.stringify(dmF));
    check(S, 'flood: report == final look', (await labLook(page)) === gotF, `${await labLook(page)}`);

    // ── reload restores the look from ?look= ──
    const keep = await labLook(page);
    await page.goto(`${page.url().split('?')[0]}?view=room&look=${keep}`, {
      waitUntil: 'load',
    });
    await page
      .addStyleTag({
        url: page.url().split('/avatar-lab')[0] + '/src/kit/base.css',
      })
      .catch(() => undefined);
    await page.addStyleTag({
      content: require('./avatar-room-lib.cjs').phoneCss(0),
    });
    await page.waitForSelector('.dr .dr-rig');
    await sleep(500);
    const back = await probe(page);
    check(S, 'reload with ?look= restores the look', back.look === keep, `${back.look} vs ${keep}`);

    check(S, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await ctx.close();
  }
}

(async () => {
  const only = process.argv[2];
  const browser = await chromium.launch();
  const t0 = Date.now();
  try {
    for (const size of SIZES.filter((s) => !only || s.name === only)) {
      try {
        await runSize(browser, size);
      } catch (err) {
        check(size.name, 'run', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : err));
      }
    }
  } finally {
    await browser.close();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(
    `\n${passed}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s${fails ? ` - ${fails} FAILED` : ' - ALL OK'}`,
  );
  process.exit(fails ? 1 : 0);
})();
