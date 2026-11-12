// The dressing-room step, for every end-to-end script.
//
// After a join in the lobby the phone opens the dressing room (screen 'dressing') before
// the waiting room (screen 'lobby'). THE TEST SWITCH (client/src/player/dressing-state.ts):
//   - an automated browser (navigator.webdriver) skips the step: scripts that expect the
//     waiting screen right after the join keep working unchanged;
//   - `dress=1` in the phone's URL forces the real flow, `dress=0` skips it in any browser.
// A script that wants the real flow opens the phone with withDressing(url) and presses
// through with passDressing(page).
//
//   const D = require('./dress-lib.cjs');
//   await page.goto(D.withDressing(`${CLIENT}/?room=${code}`));
//   ... type the name, tap the join button ...
//   await D.passDressing(page);            // waits for the room, taps "מוכן!", waits for 'lobby'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The phone URL with the dressing-room step forced on. */
function withDressing(url) {
  return url + (url.includes('?') ? '&' : '?') + 'dress=1';
}

async function playerInfo(page) {
  return page.evaluate(() => {
    const p = window.__player;
    if (!p) return null;
    const me = p.snap.state ? p.snap.state.players.find((x) => x.id === p.snap.playerId) : null;
    return {
      screen: p.screen,
      id: p.snap.playerId,
      look: p.snap.look,
      serverLook: me ? me.look : null,
      dressed: p.snap.dressed,
      dressing: p.snap.dressing,
      meBar: p.meBar.visible,
      phase: p.snap.state ? p.snap.state.phase : null,
    };
  });
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(40);
  }
}

/** Waits until the dressing room is on screen and usable (its code is a chunk of its own). */
async function waitDressing(page, ms = 30000) {
  await waitFor(
    () =>
      page.evaluate(() => {
        const p = window.__player;
        if (!p || p.screen !== 'dressing') return false;
        const room = document.querySelector('.pw-dress .dr');
        return room !== null && document.querySelectorAll('.dr-tile').length > 0 && !!window.__dressingRoom;
      }),
    ms,
    `dressing room (${page.__name || 'phone'})`,
  );
}

/** The look the dressing room itself holds right now (it reports it to the app 400 ms after the last change). */
async function roomLook(page) {
  return page.evaluate(() => (window.__dressingRoom ? window.__dressingRoom.look : null));
}

/** A real touch tap on the middle of an element. */
async function touch(page, selector) {
  const el = typeof selector === 'string' ? page.locator(selector).first() : selector;
  await el.tap();
}

/** Opens a shelf ('HEAD' | 'EYES' | 'FACE' | 'EARS' | 'NECK' | 'BG') and taps its n-th tile. Returns the room's look. */
async function tapItem(page, tab, n) {
  await touch(page, `.dr-tab[data-tab=${tab}]`);
  await sleep(120);
  const tile = page.locator('.dr-shelf .dr-tile').nth(n);
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  await tile.tap();
  await sleep(60);
  return roomLook(page);
}

/** Taps "מוכן!" and waits for the waiting room. */
async function finishDressing(page, ms = 15000) {
  await touch(page, '.dr-done');
  await waitFor(() => page.evaluate(() => window.__player && window.__player.screen === 'lobby'), ms, `waiting room after "done" (${page.__name || 'phone'})`);
}

/**
 * Presses through the dressing room: waits for it, optionally taps `taps` items of the first
 * shelf, finishes. Returns the look the guest ends up with. A page that is already past the
 * step (the step is off, or a round is running) is left alone.
 */
async function passDressing(page, opts = {}) {
  const info = await waitFor(async () => {
    const i = await playerInfo(page);
    return i && i.screen !== 'join' && i.screen !== 'boot' ? i : null;
  }, opts.timeout || 20000, `joined (${page.__name || 'phone'})`);
  if (info.screen !== 'dressing') return info.look;
  await waitDressing(page);
  for (let i = 0; i < (opts.taps || 0); i++) await tapItem(page, 'HEAD', i);
  await finishDressing(page);
  return (await playerInfo(page)).look;
}

module.exports = { withDressing, playerInfo, waitDressing, roomLook, touch, tapItem, finishDressing, passDressing, waitFor, sleep };
