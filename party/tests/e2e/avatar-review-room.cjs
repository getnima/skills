// Release review of the dressing room with the final catalog, on 320x568, 390x844 and 412x915.
// Every tab and every tile, a three-hat tower, the combination lines, shake, randomize, done, a flood of taps.
// node tests/e2e/avatar-review-room.cjs   (vite on ROOM_PORT=5296)
process.env.ROOM_PORT = process.env.ROOM_PORT || '5296';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { openRoom, probe, tapEl, labLook, labDone } = require('./avatar-room-lib.cjs');
const OUT = path.join(__dirname, 'out', 'avatar-review');
fs.mkdirSync(OUT, { recursive: true });
const SIZES = [{ name: '320x568', width: 320, height: 568 }, { name: '390x844', width: 390, height: 844 }, { name: '412x915', width: 412, height: 915 }];
const TABS = ['HEAD', 'EYES', 'EARS', 'FACE', 'NECK', 'BG'];
let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log('  FAIL', what); } };

async function geometry(page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const bad = [];
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    for (const sel of ['.dr-tab', '.dr-btn', '.dr-chip', '.dr-name', '.dr-say:not(.quiet)', '.dr-acts', '.dr-tabs']) {
      for (const e of document.querySelectorAll(sel)) {
        if (!vis(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) bad.push(`${sel} out of screen ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
        if ((sel === '.dr-tab' || sel === '.dr-btn') && (r.height < 43.5 || r.width < 43.5)) bad.push(`${sel} small ${Math.round(r.width)}x${Math.round(r.height)}`);
        if (e.scrollWidth > e.clientWidth + 1 && sel !== '.dr-tabs' && sel !== '.dr-acts' && sel !== '.dr-name') bad.push(`${sel} text clipped: ${e.textContent.trim().slice(0, 30)}`);
      }
    }
    for (const e of document.querySelectorAll('.dr-shelf .dr-tile')) {
      const r = e.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) bad.push(`tile small ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const se = document.scrollingElement;
    return { bad, pageScroll: se.scrollHeight > vh + 1 || se.scrollWidth > vw + 1 || scrollY !== 0 || scrollX !== 0, tiles: document.querySelectorAll('.dr-shelf .dr-tile').length };
  });
}
const parse = (t) => { const f = String(t).split('.'); return { head: f[2] === '0' ? [] : f[2].split('-').map(Number), rest: f.slice(3).map(Number).filter((x) => x > 0) }; };
const worn = (p) => { const l = parse(p.look); return [...l.head, ...l.rest]; };
const onDoll = (page) => page.evaluate(() => [...document.querySelectorAll('.dr-rig [data-item]')].map((e) => Number(e.dataset.item)).sort((a, b) => a - b));
const said = (page) => page.evaluate(() => document.querySelector('.dr-say-text')?.textContent.trim() ?? '');
async function settle(page, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const p = await probe(page); if (p && p.flying === 0) break; await page.waitForTimeout(120); }
  await page.waitForTimeout(350);
}
async function tapTile(page, tab, id) {
  await tapEl(page, `.dr-tab[data-tab="${tab}"]`);
  await page.waitForTimeout(200);
  const tile = page.locator(`.dr-shelf .dr-tile[data-id="${id}"]`);
  await tile.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await tapEl(page, `.dr-shelf .dr-tile[data-id="${id}"]`);
}

(async () => {
  const browser = await chromium.launch();
  for (const size of SIZES) {
    console.log(size.name);
    const { ctx, page, errors } = await openRoom(browser, size, { settle: 1500 });
    const bad404 = [];
    page.on('response', (r) => { if (r.status() >= 400) bad404.push(r.url()); });
    const shot = (n) => page.screenshot({ path: path.join(OUT, `room-${size.name}-${n}.png`) });
    await page.waitForTimeout(1200);
    await shot('0-hello');
    let g = await geometry(page);
    ok(g.bad.length === 0, `start: ${g.bad.join('; ')}`); ok(!g.pageScroll, 'page scrolls at start');
    // every tab: all tiles have pictures, nothing clipped
    let total = 0;
    for (const tab of TABS) {
      await tapEl(page, `.dr-tab[data-tab="${tab}"]`);
      await page.waitForTimeout(700);
      // scroll the shelf to its end and back so every thumbnail is asked for
      await page.evaluate(async () => { const s = document.querySelector('.dr-shelf'); for (let x = 0; x <= s.scrollWidth; x += 120) { s.scrollLeft = -x; await new Promise((r) => setTimeout(r, 40)); s.scrollLeft = x; await new Promise((r) => setTimeout(r, 40)); } s.scrollLeft = 0; });
      await page.waitForTimeout(900);
      g = await geometry(page);
      const t = await page.evaluate(() => ({ n: document.querySelectorAll('.dr-shelf .dr-tile').length, wait: document.querySelectorAll('.dr-shelf .dr-tile.wait, .dr-shelf .dr-tile.missing').length }));
      total += tab === 'BG' ? 0 : t.n;
      ok(g.bad.length === 0, `tab ${tab}: ${g.bad.join('; ')}`); ok(!g.pageScroll, `tab ${tab} page scrolls`);
      ok(t.n > 0 && t.wait === 0, `tab ${tab}: ${t.wait} of ${t.n} tiles without a picture`);
      await shot(`1-tab-${tab}`);
    }
    ok(total === 51, `tray holds ${total} accessories, catalog has 51`);
    // a three-hat tower -> the guide's tower line
    for (const id of [2, 10, 17]) { await tapTile(page, 'HEAD', id); await settle(page); }
    let p = await probe(page);
    ok(/^1\.\d+\.2-10-17\./.test(p.look), `tower is ${p.look}`);
    ok((await said(page)).includes('תמ״א 38'), `tower line: ${await said(page)}`);
    await shot('2-tower3');
    g = await geometry(page); ok(g.bad.length === 0, `tower: ${g.bad.join('; ')}`);
    // shake -> bare, unplugged line
    await tapEl(page, '.dr-shake'); await settle(page); await page.waitForTimeout(900);
    p = await probe(page);
    ok(worn(p).length === 0 && (await onDoll(page)).length === 0, 'shake leaves something on');
    await shot('3-shake');
    // combination: pirate hat + eye patch
    await tapTile(page, 'HEAD', 3); await settle(page);
    await tapTile(page, 'EYES', 205); await settle(page);
    ok((await said(page)).includes('חצי מהחשבון'), `pirate combo line: ${await said(page)}`);
    await shot('4-combo');
    // full look: every slot
    await tapTile(page, 'EARS', 302); await settle(page);
    await tapTile(page, 'FACE', 229); await settle(page);
    await tapTile(page, 'NECK', 325); await settle(page);
    ok((await said(page)).includes('עלי אקספרס'), `full look line: ${await said(page)}`);
    await shot('5-full');
    g = await geometry(page); ok(g.bad.length === 0, `full: ${g.bad.join('; ')}`);
    // flood: 60 fast taps over the tiles of two tabs, then the doll must show exactly the look
    for (const tab of ['HEAD', 'EYES']) {
      await tapEl(page, `.dr-tab[data-tab="${tab}"]`); await page.waitForTimeout(250);
      const boxes = await page.evaluate(() => [...document.querySelectorAll('.dr-shelf .dr-tile')].map((e) => e.getBoundingClientRect()).filter((r) => r.left >= 0 && r.right <= innerWidth).map((r) => [r.left + r.width / 2, r.top + r.height / 2]));
      for (let i = 0; i < 30; i++) { const b = boxes[(i * 7) % boxes.length]; await page.touchscreen.tap(b[0], b[1]); await page.waitForTimeout(25 + (i % 3) * 20); }
    }
    await settle(page, 8000); await page.waitForTimeout(800);
    p = await probe(page);
    ok(JSON.stringify(await onDoll(page)) === JSON.stringify(worn(p).sort((a, b) => a - b)), `ghost after flood: doll ${JSON.stringify(await onDoll(page))} look ${JSON.stringify(worn(p))}`);
    ok((await page.evaluate(() => document.querySelectorAll('.dr-fx > *').length)) < 12, 'effects left on the fx layer after the flood');
    await shot('6-flood');
    // randomize x3
    for (let i = 0; i < 3; i++) { await tapEl(page, '.dr-rand'); await page.waitForTimeout(1900); }
    await settle(page);
    p = await probe(page);
    ok(worn(p).length >= 2, 'random look wears fewer than two things');
    ok(JSON.stringify(await onDoll(page)) === JSON.stringify(worn(p).sort((a, b) => a - b)), 'random: doll differs from the look');
    await shot('7-random');
    // plate, then done
    await tapEl(page, '.dr-tab[data-tab="BG"]'); await page.waitForTimeout(250);
    await tapEl(page, '.dr-shelf .dr-tile[data-bg="8"]'); await page.waitForTimeout(500);
    await tapEl(page, '.dr-done'); await page.waitForTimeout(1500);
    p = await probe(page);
    const done = await labDone(page);
    ok(done !== null && done === (await labLook(page)) && /^1\.8\./.test(done), `done ${done} lab ${await labLook(page)}`);
    await shot('8-done');
    g = await geometry(page); ok(g.bad.length === 0, `end: ${g.bad.join('; ')}`); ok(!g.pageScroll, 'page scrolls at end');
    ok(errors.length === 0, `page errors: ${errors.join(' | ')}`); ok(bad404.length === 0, `404: ${bad404.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(`${checks - fails} of ${checks} checks pass`);
  process.exit(fails ? 1 : 0);
})();
