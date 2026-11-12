// sweep-phone-entry: the way in on six phones, each in its own real room driven by a raw socket host.
// Name entry (with the on-screen keyboard: the viewport shrinks), the dressing room (every tab, a
// three-hat tower, a fourth hat, shake, randomize, done), the waiting room alone and with 20 guests,
// back to the dressing room and out again.
//
//   PORT=8951 PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=30000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/sweep-phone-entry.cjs            (ONLY=se,promax to run some profiles)
//
// Outputs: tests/e2e/out/sweep-phone-/entry/ (screenshots, findings.jsonl, summary.json)
const path = require('path');
const S = require('./sweep-phone-lib.cjs');
const D = require('./dress-lib.cjs');

const { L } = S;
const OUT = path.join(S.OUT_ROOT, 'entry');
const log = S.makeLog('entry', OUT);

/** One name per phone: long ones (14 graphemes, the server's limit), mixed scripts, digits, emoji. */
const NAMES = {
  se: 'שושנה דמארי 99',
  ip14: 'דנה Dana 2',
  promax: 'אלכסנדרה הגדול',
  pixel7: 'יוסי 🎉 המלך',
  s8: 'מיכל בת 30',
  a412: 'Avi אבי 7 🍺',
};

function parseLook(s) {
  const p = String(s || '').split('.');
  if (p.length !== 7) return null;
  return { bg: +p[1], head: p[2] === '0' ? [] : p[2].split('-').map(Number), eyes: +p[3], ears: +p[4], face: +p[5], neck: +p[6] };
}
const bare = (l) => l && l.head.length === 0 && !l.eyes && !l.ears && !l.face && !l.neck;

async function covered(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const vh = visualViewport ? visualViewport.height : innerHeight;
    if (r.top < 0 || r.bottom > vh + 1) return `outside (${Math.round(r.top)}..${Math.round(r.bottom)} of ${Math.round(vh)})`;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && (hit === el || el.contains(hit)) ? null : `covered by ${hit ? hit.className : 'nothing'}`;
  }, sel);
}

async function flow(browser, key) {
  const page = await S.openProfile(browser, key, log);
  const host = S.createHost();
  let bots = null;
  const W = `${key}`;
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });

    // ── name entry ──
    page.__label = 'join';
    await page.goto(D.withDressing(`${L.CLIENT}/?room=${code}`));
    await L.waitScreen(page, 'join', 30000);
    await page.evaluate(() => document.fonts.ready);
    await L.sleep(600);
    await S.sweepShot(page, OUT, '01-join', log, { fonts: true });
    await page.tap('.pp-name-input');
    // the keyboard opens on an empty field: what does the guest see?
    {
      const vp0 = page.viewportSize();
      await page.setViewportSize({ width: vp0.width, height: Math.round(vp0.height * 0.55) });
      await L.sleep(500);
      await S.sweepShot(page, OUT, '02a-join-keyboard-empty', log);
      const hint = await page.evaluate(() => {
        const vh = visualViewport.height;
        const lab = document.querySelector('.pp-label');
        const r = lab ? lab.getBoundingClientRect() : null;
        const inp = document.querySelector('.pp-name-input');
        return { label: r ? r.bottom > 0 && r.top < vh && getComputedStyle(lab).visibility !== 'hidden' && getComputedStyle(lab).display !== 'none' : false, placeholder: inp.placeholder };
      });
      log.check(hint.label || hint.placeholder, 'keyboard-no-label', `${key}/02a`, `keyboard open on an empty name field: no label and no placeholder (${JSON.stringify(hint)})`);
      console.log(`  [entry] ${key} keyboard-empty ${JSON.stringify(hint)}`);
      await page.setViewportSize(vp0);
      await L.sleep(300);
    }
    await page.keyboard.type(NAMES[key], { delay: 25 });
    const val = await page.$eval('.pp-name-input', (e) => e.value);
    log.check(val === NAMES[key], 'name-typed', W, `typed "${NAMES[key]}", field holds "${val}"`);
    await S.sweepShot(page, OUT, '02-join-typed', log, { fonts: true });

    // the on-screen keyboard: Android resizes the layout viewport (interactive-widget=resizes-content)
    const vp = page.viewportSize();
    for (const share of [0.55, 0.45]) {
      await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * share) });
      await L.sleep(500);
      const tag = `03-join-keyboard-${Math.round(share * 100)}`;
      await S.sweepShot(page, OUT, tag, log, { allowNotch: false });
      const f = await covered(page, '.pp-name-input');
      const b = await covered(page, '.pp-btn-go');
      const focus = await page.evaluate(() => document.activeElement && document.activeElement.className);
      log.check(f === null, 'keyboard-field-hidden', `${W}/${tag}`, `name field with ${Math.round(vp.height * share)}px left: ${f}`);
      log.check(b === null, 'keyboard-button-hidden', `${W}/${tag}`, `join button with ${Math.round(vp.height * share)}px left: ${b}`);
      log.check(/pp-name-input/.test(focus || ''), 'keyboard-focus-lost', `${W}/${tag}`, `focus on "${focus}" after the resize`);
    }
    await page.setViewportSize(vp);
    await L.sleep(300);

    // ── join → dressing room ──
    await page.tap('.pp-btn-go');
    await D.waitDressing(page, 30000);
    await L.exitFs(page);
    await L.sleep(1500); // hello line, thumbnails
    await S.sweepShot(page, OUT, '04-dress-open', log, { fonts: true });
    const startLook = await D.roomLook(page);

    // every tab
    const tabs = ['HEAD', 'EYES', 'FACE', 'EARS', 'NECK', 'BG'];
    for (const t of tabs) {
      await page.locator(`.dr-tab[data-tab=${t}]`).tap();
      await L.sleep(500);
      const info = await page.evaluate(() => {
        const shelf = document.querySelector('.dr-shelf');
        const tiles = [...document.querySelectorAll('.dr-shelf .dr-tile')];
        const r = shelf.getBoundingClientRect();
        const sizes = tiles.map((x) => x.getBoundingClientRect()).map((b) => Math.round(Math.min(b.width, b.height)));
        const inView = tiles.filter((x) => {
          const b = x.getBoundingClientRect();
          return b.right > r.left && b.left < r.right;
        }).length;
        // thumbnails are drawn lazily: only the tiles in view are expected to have their picture
        const waiting = tiles.filter((x) => {
          const b = x.getBoundingClientRect();
          return x.classList.contains('wait') && b.right > r.left && b.left < r.right;
        }).length;
        const missing = tiles.filter((x) => x.classList.contains('missing')).length;
        const imgs = [...document.querySelectorAll('.dr-shelf img')].filter((i) => i.complete && i.naturalWidth === 0).length;
        return { n: tiles.length, min: Math.min(...sizes), inView, waiting, missing, imgs, on: document.querySelector('.dr-tab.on')?.dataset.tab, scrollW: shelf.scrollWidth, w: shelf.clientWidth, scrollH: shelf.scrollHeight, h: shelf.clientHeight };
      });
      log.check(info.on === t, 'dress-tab', `${W}/${t}`, `tab ${t} tapped, ${info.on} is on`);
      log.check(info.n > 0, 'dress-tab-empty', `${W}/${t}`, `no tiles on ${t}`);
      log.check(info.min >= 44, 'dress-tile<44', `${W}/${t}`, `smallest tile ${info.min}px`);
      log.check(info.missing === 0 && info.imgs === 0, 'dress-tile-missing', `${W}/${t}`, `${info.missing} missing tiles, ${info.imgs} broken thumbnails`);
      if (info.waiting > 0) {
        await L.sleep(1500);
        const still = await page.evaluate(() => {
          const r = document.querySelector('.dr-shelf').getBoundingClientRect();
          return [...document.querySelectorAll('.dr-shelf .dr-tile.wait')].filter((x) => {
            const b = x.getBoundingClientRect();
            return b.right > r.left && b.left < r.right;
          }).length;
        });
        log.check(still === 0, 'dress-tile-slow', `${W}/${t}`, `${still} thumbnails in view still waiting 2 s after opening ${t}`);
      }
      console.log(`  [entry] ${key} tab ${t}: ${JSON.stringify(info)}`);
      await S.sweepShot(page, OUT, `05-tab-${t}`, log);
    }

    // shake first so the tower starts from a bare head
    await page.locator('.dr-shake').tap();
    await L.sleep(1800);
    let look = parseLook(await D.roomLook(page));
    log.check(look && look.head.length === 0, 'dress-shake', W, `after a shake the head still wears ${JSON.stringify(look && look.head)}`);
    await S.sweepShot(page, OUT, '06-shake', log);
    log.check(bare(look), 'dress-shake-bare', W, `after a shake the doll still wears something ${JSON.stringify(look)}`);

    // a three-hat tower
    await page.locator('.dr-tab[data-tab=HEAD]').tap();
    await L.sleep(300);
    const hatCount = await page.locator('.dr-shelf .dr-tile').count();
    let tapped = 0;
    for (let i = 0; i < hatCount && tapped < 12; i++) {
      look = parseLook(await D.roomLook(page));
      if (look.head.length >= 3) break;
      const tile = page.locator('.dr-shelf .dr-tile').nth(i);
      await tile.scrollIntoViewIfNeeded().catch(() => {});
      await tile.tap();
      tapped++;
      await L.sleep(700);
    }
    await L.sleep(900); // the flight lands
    look = parseLook(await D.roomLook(page));
    log.check(look.head.length === 3, 'dress-tower', W, `after ${tapped} hat taps the tower is ${look.head.length} high (${look.head})`);
    const tower = look.head.slice();
    const lvls = await page.$$eval('.dr-shelf .dr-tile.worn .dr-tile-lvl', (els) => els.map((e) => e.textContent.trim()));
    console.log(`  [entry] ${key} tower ${tower} level badges ${JSON.stringify(lvls)}`);
    await S.sweepShot(page, OUT, '07-tower3', log, { allowOverlap: true });
    const towerAudit = page.__lastAudit;
    // the doll (with its tower) must stay on the stage
    const rig = await page.evaluate(() => {
      const st = document.querySelector('.dr-stage').getBoundingClientRect();
      const items = [...document.querySelectorAll('.dr-it')].map((e) => e.getBoundingClientRect());
      const top = Math.min(...items.map((r) => r.top));
      const bar = document.querySelector('.dr-bar, .dr-chip-float');
      const say = document.querySelector('.dr-say:not(.quiet)');
      return { stageTop: Math.round(st.top), itemsTop: Math.round(top), items: items.length, bar: bar ? Math.round(bar.getBoundingClientRect().bottom) : null, say: say ? Math.round(say.getBoundingClientRect().bottom) : null };
    });
    console.log(`  [entry] ${key} tower geometry ${JSON.stringify(rig)}`);
    log.check(rig.itemsTop >= rig.stageTop - 2, 'dress-tower-cut', W, `the top hat (${rig.itemsTop}) rises above the stage (${rig.stageTop})`);
    if (towerAudit && towerAudit.a.overlaps.length) log.issue('text-overlap', `${W}/07-tower3`, towerAudit.a.overlaps.slice(0, 4).join(' | '), { shot: `tests/e2e/out/sweep-phone-/entry/${key}-07-tower3.png` });

    // a fourth hat replaces the top one
    const free = await page.$$eval('.dr-shelf .dr-tile', (els) => els.map((e, i) => (e.classList.contains('worn') ? -1 : i)).filter((i) => i >= 0));
    if (free.length) {
      const tile = page.locator('.dr-shelf .dr-tile').nth(free[free.length - 1]);
      await tile.scrollIntoViewIfNeeded().catch(() => {});
      await tile.tap();
      await L.sleep(1200);
      look = parseLook(await D.roomLook(page));
      log.check(look.head.length === 3 || look.head.length < 3, 'dress-tower-4', W, `a 4th hat makes the tower ${look.head.length} high`);
      log.check(look.head.length <= 3, 'dress-tower-over', W, `tower over 3: ${look.head}`);
      console.log(`  [entry] ${key} 4th hat: ${tower} -> ${look.head}`);
      await S.sweepShot(page, OUT, '08-tower-4th', log, { allowOverlap: true });
    }

    // shake again with the tower on
    await page.locator('.dr-shake').tap();
    await L.sleep(400);
    await S.sweepShot(page, OUT, '09-shake-mid', log, { allowOverlap: true, allowInner: true });
    await L.sleep(1600);
    look = parseLook(await D.roomLook(page));
    log.check(bare(look), 'dress-shake-tower', W, `after shaking the tower off the doll wears ${JSON.stringify(look)}`);

    // randomize
    const before = await D.roomLook(page);
    await page.locator('.dr-rand').tap();
    await L.sleep(500);
    await S.sweepShot(page, OUT, '10-random-mid', log, { allowOverlap: true, allowInner: true });
    await L.sleep(2200);
    const rnd = await D.roomLook(page);
    look = parseLook(rnd);
    log.check(rnd !== before && !bare(look), 'dress-random', W, `randomize: ${before} -> ${rnd}`);
    await S.sweepShot(page, OUT, '11-random', log);
    // a second randomize gives another look
    await page.locator('.dr-rand').tap();
    await L.sleep(2600);
    const rnd2 = await D.roomLook(page);
    log.check(rnd2 !== rnd, 'dress-random-again', W, `a second randomize kept ${rnd}`);

    // done → waiting room alone
    await D.finishDressing(page, 20000);
    await L.sleep(1500);
    const done = await D.roomLook(page).catch(() => null);
    const shown = await page.$eval('.pw-me-doll', (e) => e.dataset.look).catch(() => null);
    await L.waitFor(() => {
      const me = host.state().players[0];
      return me && me.look === rnd2;
    }, 4000, 'server look').catch(() => {});
    const server = host.state().players[0] && host.state().players[0].look;
    log.check(shown === rnd2 && server === rnd2, 'dress-look-sync', W, `room ${rnd2}, waiting room shows ${shown}, server has ${server} (start ${startLook}, after done probe ${done})`);
    await S.sweepShot(page, OUT, '12-lobby-alone', log, { fonts: true });
    const alone = await page.evaluate(() => ({ count: document.querySelector('.pp-count')?.textContent, empty: document.querySelector('.pp-empty')?.textContent, name: document.querySelector('.pp-me-name')?.textContent }));
    log.check(alone.count === '1' && !!alone.empty, 'lobby-alone', W, JSON.stringify(alone));
    log.check(alone.name === NAMES[key], 'lobby-name', W, `name shown "${alone.name}" for "${NAMES[key]}"`);
    const nameBox = await page.$eval('.pp-me-name', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth, to: getComputedStyle(e).textOverflow, ws: getComputedStyle(e).whiteSpace, dir: getComputedStyle(e).direction }));
    log.check(nameBox.sw <= nameBox.cw + 1, 'name-cut', W, `"${NAMES[key]}" needs ${nameBox.sw}px in ${nameBox.cw}px (${JSON.stringify(nameBox)})`);

    // 20 guests
    const guestNames = ['רוני', 'Guest 2', 'מוזמנת 3', 'אורח עם שם ארוך', 'דניאלה', 'Mike', 'שירה 🎉', 'בני', 'עמית', 'ליאת', 'Yael יעל', 'גל', 'נועה', 'Tom', 'שחר', 'אורית', 'קובי 99', 'Ziv', 'הדס'];
    bots = await S.addPlanBots(code, 19, (i) => guestNames[i], () => null);
    await L.waitFor(() => host.state().players.length === 20, 10000, '20 players');
    await L.sleep(1500);
    await S.sweepShot(page, OUT, '13-lobby-20', log, { fonts: true });
    const many = await page.evaluate(() => {
      const chips = document.querySelector('.pp-chips');
      const r = chips ? chips.getBoundingClientRect() : null;
      const lastChip = chips ? chips.lastElementChild.getBoundingClientRect() : null;
      return { count: document.querySelector('.pp-count')?.textContent, chips: chips ? chips.children.length : 0, sh: chips ? chips.scrollHeight : 0, ch: chips ? chips.clientHeight : 0, oy: chips ? getComputedStyle(chips).overflowY : null, chipsBottom: r ? Math.round(r.bottom) : null, last: lastChip ? Math.round(lastChip.bottom) : null };
    });
    log.check(many.count === '20' && many.chips === 19, 'lobby-20', W, JSON.stringify(many));
    if (many.sh > many.ch + 2) {
      log.check(/auto|scroll/.test(many.oy), 'lobby-chips-unreachable', W, `the guest list is ${many.sh}px in ${many.ch}px and does not scroll (${many.oy})`);
      // scroll the list by touch and look at its end
      await page.evaluate(() => {
        const c = document.querySelector('.pp-chips');
        c.scrollTop = c.scrollHeight;
      });
      await L.sleep(300);
      await S.sweepShot(page, OUT, '14-lobby-20-scrolled', log);
    }
    console.log(`  [entry] ${key} lobby 20: ${JSON.stringify(many)}`);

    // back to the dressing room and out
    await page.locator('.pw-redress').tap();
    await D.waitDressing(page, 15000);
    await L.sleep(800);
    await S.sweepShot(page, OUT, '15-redress', log);
    const kept = await D.roomLook(page);
    log.check(kept === rnd2, 'redress-look', W, `back in the dressing room with ${kept}, had ${rnd2}`);
    await D.finishDressing(page, 15000);
    await L.sleep(500);
    log.check((await L.screen(page)) === 'lobby', 'redress-back', W, `after done: ${await L.screen(page)}`);
  } catch (e) {
    log.issue('flow', `${W}@${page.__label}`, e.message, { shot: await page.screenshot({ path: path.join(OUT, `${key}-ERROR.png`) }).then(() => `tests/e2e/out/sweep-phone-/entry/${key}-ERROR.png`).catch(() => null) });
  } finally {
    if (bots) bots.close();
    host.close();
    await page.__ctx.close().catch(() => {});
  }
}

(async () => {
  const browser = await L.launch();
  const keys = process.env.ONLY ? process.env.ONLY.split(',') : S.ORDER;
  const par = Number(process.env.PAR || 3);
  const queue = keys.slice();
  await Promise.all(
    Array.from({ length: par }, async () => {
      while (queue.length) await flow(browser, queue.shift());
    }),
  );
  await browser.close();
  process.exit(log.summary() ? 1 : 0);
})();
