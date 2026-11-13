// Phone QA: every screen outside the games, on every phone size, audited for scroll,
// clipping, overlaps, tap targets, input font size, touch drag and zoom.
//
//   PARTY_SERVER_PORT=8812 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts   (real intro/countdown)
//   PARTY_SERVER_PORT=8812 PARTY_CLIENT_PORT=5212 npx vite
//   node tests/e2e/qa-phone-screens.cjs
//
// Screenshots: tests/e2e/out/qa-phone/screens/<phone>-<screen>.png
const path = require('path');
const L = require('./qa-phone-lib.cjs');

const OUT = path.join(L.OUT_ROOT, 'screens');
const { check, done } = L.makeChecker('screens');

// Long, mixed names: 14 graphemes each (the server's limit).
const NAMES = {
  se320: 'אלכסנדרה גדולה',
  se375: 'Dana דנה 😀🎉ab',
  iphone14: 'WWWWWWWWWWWWWW',
  promax: 'שששששששששששששש',
  pixel7: 'יוסי Yossi 👑',
  s8: '👨‍👩‍👧 משפחה Fam',
  a360: 'מיכל הגדולה',
  ipadmini: 'טאבלט Tablet',
};
const NOTCH = { iphone14: [47, 34], promax: [59, 34], se375: [20, 0] };

(async () => {
  const browser = await L.launch();
  const host = L.createHost();
  const created = await host.call('host:create', {});
  const code = created.code;
  await host.call('host:setAutoCutscenes', { enabled: false });
  console.log('[screens] room', code);
  const pages = {};
  let bots = null;
  const all = () => Object.values(pages);
  const shotAll = (label, opts) => Promise.all(all().map((p) => L.shot(p, OUT, label, check, opts)));

  try {
    for (const [name, dev] of Object.entries(L.PHONES)) {
      const p = await L.openPhone(browser, name, dev, {}, check);
      if (NOTCH[name]) await L.setSafeArea(p, NOTCH[name][0], NOTCH[name][1]);
      pages[name] = p;
    }

    // ── join ──
    await Promise.all(all().map((p) => p.goto(`${L.CLIENT}/?room=${code}`)));
    await Promise.all(all().map((p) => L.waitScreen(p, 'join')));
    await L.sleep(500);
    await shotAll('01-join', { drag: true });
    for (const p of all()) {
      const tip = await p.locator('.pp-tip').count();
      const ios = /iPhone/.test(await p.evaluate(() => navigator.userAgent));
      check(tip === (ios ? 1 : 0), `${p.__name}: add-to-home-screen tip on the join screen only on iPhone Safari (${tip})`);
    }
    // the tip is dismissible and stays dismissed
    await pages.se375.tap('.pp-tip');
    check((await pages.se375.locator('.pp-tip').count()) === 0, 'tip dismissed with one tap');
    await pages.se375.reload();
    await L.waitScreen(pages.se375, 'join');
    check((await pages.se375.locator('.pp-tip').count()) === 0, 'tip stays dismissed after a reload');
    for (const p of all()) await p.fill('.pp-name-input', NAMES[p.__name]);
    const vals = await Promise.all(all().map((p) => p.$eval('.pp-name-input', (e) => e.value)));
    check(vals.every((v, i) => !/[\uD800-\uDBFF]$/.test(v)), `typed names keep whole emoji ${JSON.stringify(vals)}`);
    await shotAll('02-join-typed');

    // keyboard open: the visible viewport shrinks to ~55% (Android resizes-content; iOS visualViewport)
    for (const p of all()) {
      const vp = p.viewportSize();
      p.__vp = vp;
      await p.focus('.pp-name-input');
      await p.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) });
    }
    await L.sleep(400);
    for (const p of all()) {
      const vis = await p.evaluate(() => {
        const vh = visualViewport.height;
        const on = (s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return r.top >= 0 && r.bottom <= vh + 1;
        };
        return { field: on('.pp-name-input'), btn: on('.pp-btn-go'), rot: !!document.querySelector('.pp-rotate.is-on') };
      });
      check(vis.field && vis.btn && !vis.rot, `${p.__name}: keyboard open keeps the field and the button visible, no rotate overlay ${JSON.stringify(vis)}`);
    }
    await shotAll('03-join-keyboard');
    for (const p of all()) await p.setViewportSize(p.__vp);
    for (const p of all()) await p.evaluate(() => document.activeElement && document.activeElement.blur());

    // hand-typed room code (no QR): a fresh phone at the smallest size
    const hand = await L.openPhone(browser, 'hand-se320', L.PHONES.se320, {}, check);
    await hand.goto(`${L.CLIENT}/`);
    await L.waitScreen(hand, 'join');
    check((await hand.locator('.pp-code-input').count()) === 1, 'no ?room: a clean code entry');
    await L.shot(hand, OUT, '01-code-entry', check);
    await hand.tap('.pp-code-input');
    await hand.keyboard.type(code.toLowerCase().split('').join(' '), { delay: 40 }); // sloppy typing
    const typed = await hand.$eval('.pp-code-input', (e) => e.value);
    check(typed === code, `hand-typed code is normalised (${typed})`);
    await hand.tap('.pp-name-input');
    await hand.keyboard.type('ידני', { delay: 30 });
    await hand.keyboard.press('Enter');
    await L.waitScreen(hand, 'lobby');
    check(new URL(hand.url()).searchParams.get('room') === code, 'hand-typed join writes ?room for reloads');

    // ── join everyone ──
    for (const p of all()) await p.tap('.pp-btn-go');
    await Promise.all(all().map((p) => L.waitScreen(p, 'lobby')));
    await L.sleep(800);
    await shotAll('04-lobby-few', { drag: true });
    // long names must be shown whole somewhere sane
    const meNames = await Promise.all(all().map((p) => p.$eval('.pp-me-name', (e) => ({ t: e.textContent, w: e.scrollWidth, cw: e.clientWidth }))));
    console.log('[screens] me names', JSON.stringify(meNames));

    // 60 players
    bots = await L.addBots(code, 60 - 9, (i) => `${['אורח', 'Guest', 'מוזמנת'][i % 3]} ${i + 1} ${i % 4 === 0 ? '🎉🎉' : 'xx'}`);
    await L.waitFor(() => host.state() && host.state().players.length === 60, 15000, '60 players');
    await L.sleep(1200);
    await shotAll('05-lobby-60', { drag: true });
    const chipList = await pages.se320.evaluate(() => {
      const el = document.querySelector('.pp-chips');
      return el ? { sh: el.scrollHeight, ch: el.clientHeight, n: el.children.length } : null;
    });
    check(chipList && chipList.n === 59, `lobby lists the 59 others (${JSON.stringify(chipList)})`);

    // full room: a 61st phone gets a clear error
    const extra = await L.openPhone(browser, 'full-a360', L.PHONES.a360, {}, check);
    await extra.goto(`${L.CLIENT}/?room=${code}`);
    await L.waitScreen(extra, 'join');
    await extra.fill('.pp-name-input', 'עוד אחד');
    await extra.tap('.pp-btn-go');
    await L.waitFor(() => extra.locator('.pp-error').count(), 8000, 'room full error');
    check(/מלא/.test(await extra.textContent('.pp-error')), 'room full message');
    await L.shot(extra, OUT, '01-room-full', check);
    // name taken: same name as someone else is accepted with a suffix
    await host.call('host:kick', { playerId: bots.bots[0].id });
    await host.call('host:kick', { playerId: bots.bots[1].id });
    await extra.fill('.pp-name-input', NAMES.a360);
    await extra.tap('.pp-btn-go');
    await L.waitScreen(extra, 'lobby');
    const extraName = await extra.$eval('.pp-me-name', (e) => e.textContent);
    check(extraName !== NAMES.a360 && extraName.startsWith('מיכל'), `name taken → suffixed (${extraName})`);
    await L.shot(extra, OUT, '02-lobby-name-taken', check);

    // ── round 1 ──
    await host.call('host:start', { gameId: 'tap' });
    await Promise.all(all().map((p) => L.waitScreen(p, 'intro', 5000)));
    await L.sleep(400);
    await shotAll('06-intro');
    await Promise.all(all().map((p) => L.waitScreen(p, 'countdown', 32000))); // the 27 s how-to first
    await L.sleep(150);
    await shotAll('07-countdown', { allowOverlap: true });
    await Promise.all(all().map((p) => L.waitScreen(p, 'playing', 5000)));
    // late joiner during the round
    const late = await L.openPhone(browser, 'late-se375', L.PHONES.se375, {}, check);
    await late.goto(`${L.CLIENT}/?room=${code}`);
    await L.waitScreen(late, 'join');
    await late.fill('.pp-name-input', 'מאחר');
    await late.tap('.pp-btn-go');
    await L.waitScreen(late, 'late', 8000);
    await L.shot(late, OUT, '01-late', check);
    await L.sleep(700);
    // the winner taps a lot, two others a little
    const tapN = async (p, n) => {
      const vp = p.viewportSize();
      for (let i = 0; i < n; i++) await p.touchscreen.tap(vp.width / 2 + ((i * 37) % 60) - 30, vp.height * 0.55);
    };
    await Promise.all([tapN(pages.se320, 30), tapN(pages.pixel7, 5), tapN(pages.iphone14, 3)]);
    await shotAll('08-playing', { allowSmall: true });
    // HUD below the notch, timer + score visible
    for (const p of all()) {
      const has = await L.waitFor(() => p.evaluate(() => !!document.querySelector('.pa-hud-secs')), 4000, 'hud').catch(() => false);
      if (!check(has, `${p.__name}: stage HUD present while playing (screen ${await L.screen(p)})`)) continue;
      const hud = await p.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px)';
        document.body.append(probe);
        const inset = probe.getBoundingClientRect().height;
        probe.remove();
        return { secs: r('.pa-hud-secs'), score: r('.pa-hud-score'), inset, sat, txt: document.querySelector('.pa-hud-secs').textContent };
      });
      check(hud.secs.top >= hud.inset && hud.score.top >= hud.inset && hud.secs.right <= p.viewportSize().width && hud.score.left >= 0, `${p.__name}: HUD below the notch (inset ${hud.inset}, secs top ${Math.round(hud.secs.top)}) and on screen, secs "${hud.txt}"`);
    }

    // cutscene mid-game
    await host.call('host:cutscene', { id: 'joker_1' });
    await Promise.all(all().map((p) => L.waitFor(() => p.evaluate(() => window.__player.cutscene), 4000, 'cutscene')));
    await L.sleep(500);
    await shotAll('09-cutscene', { drag: true });
    await host.call('host:cutsceneEnd', {});
    await Promise.all(all().map((p) => L.waitFor(() => p.evaluate(() => !!document.querySelector('.pp-resume')), 3000, 'resume')));
    await L.sleep(300);
    await shotAll('10-resume', { allowOverlap: true });
    await Promise.all(all().map((p) => L.waitFor(() => p.evaluate(() => !document.querySelector('.pp-resume')), 6000, 'resumed')));
    await tapN(pages.se320, 10);

    await Promise.all(
      all().map(async (p) => {
        await L.waitScreen(p, ['sending', 'suspense'], 50000);
        if ((await L.screen(p)) === 'sending') await L.shot(p, OUT, '11-sending', check);
      }),
    );
    await Promise.all(all().map((p) => L.waitScreen(p, 'suspense', 8000)));
    await L.sleep(300);
    await shotAll('12-suspense');
    await L.waitScreen(pages.se320, 'win', 15000);
    const w = pages.se320;
    // the winner's song is the TV's alone (the owner, 13.11: no trumpets on the phones)
    await L.sleep(600);
    const mus = await w.evaluate(() => ({ on: window.__partyMusic ? window.__partyMusic.playing('victory') : false, vis: document.visibilityState, fs: !!document.fullscreenElement }));
    check(!mus.on, `no song on the phone at the WIN moment ${JSON.stringify(mus)}`);
    const others = all().filter((p) => p !== w);
    await Promise.all(others.map((p) => L.waitScreen(p, 'reveal', 4000)));
    await L.sleep(1200);
    await Promise.all([L.shot(w, OUT, '13-win', check), ...others.map((p) => L.shot(p, OUT, '13-reveal', check))]);
    // the WIN moment at every size: resize the winner's phone
    const base = w.viewportSize();
    for (const [name, dev] of Object.entries(L.PHONES)) {
      if (name === 'se320') continue;
      await L.resize(w, dev.viewport);
      await L.sleep(200);
      w.__name = `win-as-${name}`;
      await L.shot(w, OUT, '13-win', check);
    }
    w.__name = 'se320';
    await L.resize(w, base);
    if ((await L.screen(w)) !== 'win') console.log('[screens] (the WIN moment ran out during the size tour; it closes by itself after 14 s)');
    if ((await L.screen(w)) === 'win') await w.tap('.pp-win .pp-btn');
    await L.waitScreen(w, 'results', 3000);
    await L.sleep(300);
    check(!(await w.evaluate(() => (window.__partyMusic ? window.__partyMusic.playing('victory') : false))), 'no song after the WIN moment either');
    await Promise.all(others.map((p) => L.waitScreen(p, 'results', 8000)));
    await L.sleep(1800);
    await shotAll('14-results');

    await host.call('host:lobby', {});
    await Promise.all(all().map((p) => L.waitScreen(p, 'lobby')));
    await L.sleep(800);
    await shotAll('15-lobby-standings', { drag: true });

    // offline banner (on the lobby)
    await pages.iphone14.__ctx.setOffline(true);
    await pages.a360.__ctx.setOffline(true);
    await L.waitFor(() => pages.iphone14.evaluate(() => window.__player.banner), 30000, 'banner');
    await L.waitFor(() => pages.a360.evaluate(() => window.__player.banner), 30000, 'banner');
    await L.shot(pages.iphone14, OUT, '16-offline-banner', check);
    await L.shot(pages.a360, OUT, '16-offline-banner', check);
    await pages.iphone14.__ctx.setOffline(false);
    await pages.a360.__ctx.setOffline(false);
    await L.waitFor(async () => !(await pages.iphone14.evaluate(() => window.__player.banner)), 20000, 'banner gone');

    // ── final ──
    await host.call('host:final', {});
    await L.sleep(400);
    if (host.state().cutscene) {
      await host.call('host:cutsceneEnd', {});
    }
    await Promise.all(all().map((p) => L.waitScreen(p, 'final', 8000)));
    await L.sleep(1900);
    await shotAll('17-final');

    // kicked
    const idS8 = await pages.s8.evaluate(() => window.__player.snap.playerId);
    await host.call('host:kick', { playerId: idS8 });
    await L.waitScreen(pages.s8, 'kicked', 5000);
    await L.sleep(500);
    await L.shot(pages.s8, OUT, '18-kicked', check);
    await pages.s8.tap('.pp-btn');
    await L.waitScreen(pages.s8, 'join', 3000);
    await L.shot(pages.s8, OUT, '19-after-kicked-join', check);

    // room closed (stale identity)
    const cl = await L.openPhone(browser, 'closed-se320', L.PHONES.se320, {}, check);
    await cl.goto(`${L.CLIENT}/`);
    await cl.evaluate(() => {
      localStorage.setItem('party.player.QQQQ', JSON.stringify({ playerId: 'x', secret: 'y', name: 'רוני', lateRound: null }));
      localStorage.setItem('party.lastRoom', 'QQQQ');
    });
    await cl.goto(`${L.CLIENT}/`);
    await L.waitScreen(cl, 'closed', 8000);
    await L.shot(cl, OUT, '01-room-closed', check);
    await cl.tap('.pp-btn');
    await L.waitScreen(cl, 'join', 3000);
    check((await cl.locator('.pp-code-input').count()) === 1, 'after "room closed" the code is editable');
  } catch (err) {
    check(false, 'flow: ' + err.message);
    console.error(err);
  } finally {
    if (bots) bots.close();
    host.close();
    await browser.close();
  }
  process.exit(done() ? 1 : 0);
})();
