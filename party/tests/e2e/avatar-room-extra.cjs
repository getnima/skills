// The dressing room, mounted on its own (client/src/avatar/dressing-mount.ts) in a fixed-height box:
// opening time and tap latency on a 4x-throttled CPU, reduced motion, a hidden tab, a look pushed
// from outside, compact / short containers, a missing picture and a long name.
//   node tests/e2e/avatar-room-extra.cjs
const { chromium } = require('playwright');
const { BASE, shot } = require('./avatar-room-lib.cjs');

const results = [];
let fails = 0;
function check(name, ok, info = '') {
  results.push({ name, ok, info });
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ` - ${info}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, { width, height, reducedMotion = 'no-preference', block = null }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion,
    locale: 'he-IL',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  if (block) await page.route(`**/${block}`, (r) => r.fulfill({ status: 404, body: 'nope' }));
  await page.goto(`${BASE}/avatar-lab.html?view=wall&n=1`, {
    waitUntil: 'load',
  });
  await page.addStyleTag({ url: `${BASE}/src/kit/base.css` });
  return { ctx, page, errors };
}

/** Mounts the room in a fixed box under an optional fake header; returns ms from mount to the doll painted. */
async function mount(page, { top = 0, compact = false, look = '1.0.0.0.0.0.0', name = 'דנה' } = {}) {
  return page.evaluate(
    async ({ top, compact, look, name }) => {
      document.body.innerHTML = '';
      if (top > 0) {
        const hd = document.createElement('div');
        hd.textContent = 'לובי · מחכים לעוד 3 אורחים';
        hd.style.cssText = `position:fixed;inset:0 0 auto 0;height:${top}px;display:grid;place-items:center;background:#10238C;color:#FFD21F;font:700 20px/1 Motaleh,system-ui;border-bottom:3px solid #16120E`;
        document.body.append(hd);
      }
      const box = document.createElement('div');
      box.id = 'host';
      box.style.cssText = `position:fixed;left:0;right:0;bottom:0;top:${top}px`;
      document.body.append(box);
      const m = await import('/src/avatar/dressing-mount.ts');
      const av = await import('/src/avatar/index.ts');
      window.__av = av;
      window.__t = { changes: [], dones: [] };
      const t0 = performance.now();
      window.__room = m.mountDressingRoom(box, {
        look: av.decodeLook(look),
        name,
        compact,
        onChange: (l) => window.__t.changes.push(av.encodeLook(l)),
        onDone: (l) => window.__t.dones.push(av.encodeLook(l)),
      });
      await new Promise((resolve) => {
        const poll = () => {
          const img = document.querySelector('.dr-d-body');
          if (img && img.complete && img.naturalWidth > 0) requestAnimationFrame(() => resolve());
          else setTimeout(poll, 5);
        };
        poll();
      });
      return performance.now() - t0;
    },
    { top, compact, look, name },
  );
}

async function tapSel(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`nothing at ${sel}`);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

const room = (page) => page.evaluate(() => ({ ...window.__dressingRoom, thumbs: undefined }));

async function layoutProblems(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#host').getBoundingClientRect();
    const bad = [];
    for (const sel of ['.dr-bar', '.dr-tab', '.dr-shelf', '.dr-btn', '.dr-name', '.dr-chip']) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < host.left - 0.5 || r.right > host.right + 0.5 || r.top < host.top - 0.5 || r.bottom > host.bottom + 0.5) bad.push(sel);
      }
    }
    for (const e of document.querySelectorAll('.dr-tab, .dr-btn, .dr-tile')) {
      const r = e.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) bad.push(`small ${e.className}`);
    }
    const stage = document.querySelector('.dr-stage').getBoundingClientRect();
    return {
      bad,
      stageH: Math.round(stage.height),
      mode: window.__dressingRoom.mode,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ── 1. opening time and tap latency on a 4x-throttled CPU (assets cached by a first visit) ──
    {
      const { ctx, page, errors } = await newPage(browser, {
        width: 390,
        height: 844,
      });
      await mount(page, {});
      await page.evaluate(() => import('/src/avatar/index.ts').then((m) => m.preloadAvatarAssets()));
      await sleep(1500);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const open = [];
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.__room.unmount());
        await sleep(300);
        open.push(Math.round(await mount(page, { look: '1.8.8-17.9.0.11.7' })));
      }
      check('4x CPU: open to doll painted (ms, 3 runs, module already loaded)', Math.max(...open) < 1000, open.join(' / '));
      // full cold-ish page open: navigation to the lab's room view, until the doll image is painted
      await page.goto(`${BASE}/avatar-lab.html?view=room&look=1.8.8-17.9.0.11.7`, { waitUntil: 'commit' });
      const nav = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const poll = () => {
              const img = document.querySelector('.dr-d-body');
              if (img && img.complete && img.naturalWidth > 0) requestAnimationFrame(() => resolve(performance.now()));
              else setTimeout(poll, 10);
            };
            poll();
          }),
      );
      check(
        '4x CPU: page navigation to doll painted (dev server, ms)',
        nav < 2500,
        `${Math.round(nav)} ms (vite dev serves ~40 unbundled modules; info)`,
      );
      await page.addStyleTag({ url: `${BASE}/src/kit/base.css` });
      await mount(page, {});
      await sleep(1500);
      // latency: pointerdown -> the tile turns worn (DOM) -> next frame
      await page.evaluate(() => {
        window.__lat = [];
        let down = 0;
        let press = 0;
        // a tap is complete when the finger lifts: latency is measured from pointerup (pointerdown is reported too)
        document.addEventListener('pointerdown', (e) => (press = e.timeStamp), true);
        document.addEventListener('pointerup', (e) => (down = e.timeStamp), true);
        let click = 0;
        document.addEventListener('click', () => (click = performance.now()), true);
        const mo = new MutationObserver((list) => {
          for (const m of list) {
            if (m.attributeName === 'aria-pressed' && down > 0) {
              const dom = performance.now() - down;
              const fromPress = performance.now() - press;
              const own = performance.now() - click;
              const d0 = down;
              down = 0;
              requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push({ dom, fromPress, own, frame: performance.now() - d0 })));
            }
          }
        });
        mo.observe(document.querySelector('.dr-shelf'), {
          attributes: true,
          subtree: true,
          attributeFilter: ['aria-pressed'],
        });
      });
      for (let i = 0; i < 8; i++) {
        const tiles = await page.$$eval('.dr-shelf .dr-tile', (els) =>
          els.slice(0, 4).map((e) => {
            const r = e.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }),
        );
        const t = tiles[i % tiles.length];
        await page.touchscreen.tap(t.x, t.y);
        await sleep(450);
      }
      await sleep(800);
      const lat = await page.evaluate(() => window.__lat);
      const domMax = Math.max(...lat.map((l) => l.dom));
      const med = (k) => lat.map((l) => l[k]).sort((a, b) => a - b)[Math.floor(lat.length / 2)];
      const ownMax = Math.max(...lat.map((l) => l.own));
      check(
        "4x CPU: finger up -> new look in the DOM, median under 100 ms; the room's own share (click -> DOM) under 50 ms",
        lat.length >= 6 && med('dom') < 100 && ownMax < 50,
        `${lat.length} taps: finger up -> DOM median ${med('dom').toFixed(0)} / max ${domMax.toFixed(0)} ms, click -> DOM max ${ownMax.toFixed(0)} ms, to the 2nd frame median ${med('frame').toFixed(0)} ms (all finger-up: ${lat.map((l) => l.dom.toFixed(0)).join(',')})`,
      );
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      check('perf page: no errors', errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    // ── 2. reduced motion: instant changes, nothing flies ──
    {
      const { ctx, page, errors } = await newPage(browser, {
        width: 375,
        height: 667,
        reducedMotion: 'reduce',
      });
      await mount(page, {});
      await sleep(800);
      await tapSel(page, '.dr-tile[data-id="8"]');
      await sleep(60);
      const r = await room(page);
      const vis = await page.evaluate(() => {
        const img = document.querySelector('.dr-rig [data-item="8"]');
        return img ? getComputedStyle(img).visibility : 'missing';
      });
      const fx = await page.$eval('.dr-fx', (e) => e.childElementCount);
      check(
        'reduced motion: the hat is on at once, nothing in flight',
        r.flying === 0 && vis === 'visible' && fx === 0,
        `flying ${r.flying}, img ${vis}, fx ${fx}`,
      );
      await tapSel(page, '.dr-rand');
      await sleep(60);
      const r2 = await room(page);
      const dm = await page.evaluate(() => {
        const av = window.__av;
        const want = av
          .wornIds(av.decodeLook(window.__dressingRoom.look))
          .sort((a, b) => a - b)
          .join(',');
        const have = [...document.querySelectorAll('.dr-rig .dr-it')]
          .map((i) => Number(i.dataset.item))
          .sort((a, b) => a - b)
          .join(',');
        return { want, have };
      });
      check('reduced motion: randomize shows the final look at once', dm.want === dm.have && r2.flying === 0, JSON.stringify(dm));
      await shot(page, 'extra-reduced-motion');
      check('reduced motion: no errors', errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    // ── 3. hidden tab: flights land, effects stop, the look is reported ──
    {
      const { ctx, page, errors } = await newPage(browser, {
        width: 390,
        height: 844,
      });
      await mount(page, {});
      await sleep(1000);
      await tapSel(page, '.dr-tile[data-id="2"]');
      await sleep(80);
      const mid = await room(page);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await sleep(80);
      const st = await page.evaluate(() => ({
        paused: document.querySelector('.dr').classList.contains('dr-paused'),
        fx: document.querySelector('.dr-fx').childElementCount,
        flying: window.__dressingRoom.flying,
        changes: window.__t.changes.slice(),
        look: window.__dressingRoom.look,
        running: document
          .querySelector('.dr-rays')
          .getAnimations()
          .map((a) => a.playState),
      }));
      check(
        'hidden tab: in-flight item landed, fx cleared, animations paused, look reported',
        mid.flying === 1 &&
          st.paused &&
          st.fx === 0 &&
          st.flying === 0 &&
          st.changes[st.changes.length - 1] === st.look &&
          st.running.every((s) => s === 'paused'),
        JSON.stringify({ midFlying: mid.flying, ...st }),
      );
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => false,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await sleep(100);
      const back = await page.evaluate(() => document.querySelector('.dr').classList.contains('dr-paused'));
      check('visible again: running', back === false);

      // ── 4. a look pushed from outside replaces the room's look; the room's own echo does not ──
      await page.evaluate(() =>
        window.__room.update({
          look: window.__av.decodeLook('1.2.10.0.0.11.0'),
        }),
      );
      await sleep(100);
      const ext = await room(page);
      const dmx = await page.evaluate(() =>
        [...document.querySelectorAll('.dr-rig .dr-it')]
          .map((i) => Number(i.dataset.item))
          .sort((a, b) => a - b)
          .join(','),
      );
      check('external look replaces the room look', ext.look === '1.2.10.0.0.11.0' && dmx === '10,11', `${ext.look} doll ${dmx}`);
      await tapSel(page, '.dr-tile[data-id="8"]'); // crown on top of the top hat
      await sleep(50);
      await page.evaluate(() =>
        window.__room.update({
          look: window.__av.decodeLook('1.2.10.0.0.11.0'),
        }),
      ); // late echo of the old look
      await sleep(700);
      const echo = await page.evaluate(() => ({
        look: window.__dressingRoom.look,
        last: window.__t.changes[window.__t.changes.length - 1],
      }));
      check('a late echo of an older look does not undo a tap', echo.look === '1.2.10-8.0.0.11.0' && echo.last === echo.look, JSON.stringify(echo));
      await tapSel(page, '.dr-done');
      await sleep(100);
      const dn = await page.evaluate(() => window.__t.dones.slice());
      check('onDone fires with the look', dn.length === 1 && dn[0] === '1.2.10-8.0.0.11.0', dn.join(','));
      check('hidden/external page: no errors', errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    // ── 5. short and compact containers ──
    const boxes = [
      { w: 375, h: 667, top: 140, compact: false, name: 'header140-375' },
      {
        w: 360,
        h: 640,
        top: 160,
        compact: true,
        name: 'compact-360-header160',
      },
      {
        w: 320,
        h: 568,
        top: 120,
        compact: true,
        name: 'compact-320-header120',
      },
      { w: 390, h: 844, top: 0, compact: true, name: 'compact-390-full' },
      { w: 320, h: 568, top: 168, compact: true, name: 'compact-320-400' },
      { w: 320, h: 568, top: 68, compact: false, name: 'normal-320-500' },
    ];
    for (const b of boxes) {
      const { ctx, page, errors } = await newPage(browser, {
        width: b.w,
        height: b.h,
      });
      await mount(page, {
        top: b.top,
        compact: b.compact,
        look: '1.9.8-17.5.0.11.15',
      });
      await sleep(1800);
      const lp = await layoutProblems(page);
      check(
        `container ${b.name} (${b.h - b.top} px): fits, controls >= 44 px`,
        lp.bad.length === 0,
        `stage ${lp.stageH} px, ${lp.mode}${lp.bad.length ? `, bad: ${lp.bad.join(', ')}` : ''}`,
      );
      await shot(page, `extra-${b.name}`);
      if (errors.length) check(`${b.name}: no errors`, false, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    // ── 5b. thumbnails are composed for the tiles on screen only, and cached ──
    {
      const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
      await mount(page, {});
      await sleep(3000);
      const t1 = await page.evaluate(() => ({
        made: window.__dressingRoom.thumbs().made,
        tiles: document.querySelectorAll('.dr-shelf .dr-tile').length,
        shown: document.querySelectorAll('.dr-shelf .dr-tile img').length,
      }));
      await page.$eval('.dr-shelf', (e) => (e.scrollLeft = -e.scrollWidth));
      await sleep(2500);
      const t2 = await page.evaluate(() => ({
        made: window.__dressingRoom.thumbs().made,
        shown: document.querySelectorAll('.dr-shelf .dr-tile img').length,
      }));
      await tapSel(page, '.dr-tab[data-tab="EYES"]');
      await sleep(1500);
      await tapSel(page, '.dr-tab[data-tab="HEAD"]');
      await sleep(150);
      const t3 = await page.evaluate(() => ({
        made: window.__dressingRoom.thumbs().made,
        shown: document.querySelectorAll('.dr-shelf .dr-tile img').length,
      }));
      check(
        'thumbnails: lazy (only tiles seen), more after scrolling, cached on return',
        t1.made < t1.tiles && t1.shown === t1.made && t2.made > t1.made && t3.shown >= t1.shown,
        `${t1.tiles} hat tiles; on open ${t1.made} made; after scrolling ${t2.made}; back to hats: ${t3.shown} shown at once`,
      );
      await shot(page, 'extra-thumbs-scrolled');
      if (errors.length) check('thumbs: no errors', false, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    // ── 6. a missing picture: placeholder tile, no throw, the rest works ──
    {
      const { ctx, page, errors } = await newPage(browser, {
        width: 375,
        height: 667,
        block: 'prop_09_heart_glasses.png',
      });
      await mount(page, { name: 'אלכסנדרה־מריה בן־דוד הגדולה' });
      await tapSel(page, '.dr-tab[data-tab="EYES"]');
      await sleep(2500);
      const tile = await page.$eval('.dr-tile[data-id="9"]', (e) => ({
        cls: e.className,
        img: !!e.querySelector('img'),
      }));
      const other = await page.$eval('.dr-tile[data-id="5"]', (e) => !!e.querySelector('img'));
      check(
        'missing picture: its tile keeps a placeholder, the others get thumbnails',
        tile.img === false && /missing/.test(tile.cls) && other,
        JSON.stringify({ tile, other }),
      );
      await tapSel(page, '.dr-tile[data-id="9"]');
      await sleep(1200);
      const r = await room(page);
      check(
        'missing picture: tapping it still changes the look, nothing stuck in flight',
        r.look === '1.0.0.9.0.0.0' && r.flying === 0,
        `${r.look} flying ${r.flying}`,
      );
      const nm = await page.evaluate(() => {
        const n = document.querySelector('.dr-name');
        return {
          over: n.scrollWidth > n.clientWidth,
          w: Math.round(n.getBoundingClientRect().width),
        };
      });
      check('long name: the sticker is cut with an ellipsis inside its box', nm.w <= 375 * 0.45 + 10, JSON.stringify(nm));
      await shot(page, 'extra-missing-picture-long-name');
      check('missing picture: no errors besides the 404', errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed${fails ? ` - ${fails} FAILED` : ' - ALL OK'}`);
  process.exit(fails ? 1 : 0);
})();
