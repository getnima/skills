// Shared helpers for the icy / flappy QA scripts: real touch input through CDP,
// device sizes, and the three icy players (clumsy / normal / expert).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIZES = {
  '320x568': { width: 320, height: 568 },
  '375x667': { width: 375, height: 667 },
  '390x844': { width: 390, height: 844 },
  '430x932': { width: 430, height: 932 },
  '360x640': { width: 360, height: 640 },
  '412x915': { width: 412, height: 915 },
  '844x390': { width: 844, height: 390 },
};

function phoneContext(browser, size, extra) {
  const vp = SIZES[size] || size;
  return browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...(extra || {}) });
}

/** Real touch events (CDP Input.dispatchTouchEvent): several fingers, cancel. */
async function createTouch(context, page) {
  const cdp = await context.newCDPSession(page);
  const active = new Map(); // id -> {x, y}
  const points = () => [...active.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id }));
  return {
    cdp,
    async down(id, x, y) {
      active.set(id, { x, y });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points() });
    },
    async move(id, x, y) {
      if (!active.has(id)) return;
      active.set(id, { x, y });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points() });
    },
    async up(id) {
      const p = active.get(id);
      if (!p) return;
      active.delete(id);
      // Chromium releases the points LISTED in a touchEnd (not the missing ones)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
    },
    async cancel() {
      active.clear();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    },
    async tap(x, y) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...points(), { x, y, id: 99 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y, id: 99 }] });
    },
    isDown: (id) => active.has(id),
  };
}

/** Deterministic random for the bots (so a run can be repeated). */
function makeRand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// ───────────────────────────── icy ─────────────────────────────

const ICY_STATE = () => {
  const d = window.__icy;
  const c = document.querySelector('.pa-stage-game canvas');
  const p = window.__party;
  if (!p) return null;
  if (!d) return p.ended ? { s: null, hook: null, ended: true, score: p.score } : null;
  return { s: d.state, hook: c ? c.dataset.icy : null, ended: p.ended, score: p.score, frozen: p.frozen, leftMs: p.leftMs };
};

/**
 * In-page planner: tries [first dir for n steps, then second dir] plans with the
 * real physics (window.__icy.predict) and returns the best first dir.
 */
const ICY_PLAN = ({ horizon, firsts, combos, cur, thens }) => {
  const d = window.__icy;
  if (!d || d.state.mode !== 'run') return null;
  const s = d.state;
  let best = null;
  for (const a of [-1, 0, 1]) {
    for (const n of firsts) {
      for (const b of thens || [-1, 0, 1]) {
        if (n >= horizon && b !== a) continue;
        const r = d.predict([[a, n], [b, horizon]], horizon);
        let top = s.grounded >= 0 ? s.grounded : -1;
        let comboLand = 0;
        let prev = s.grounded;
        let topAt = horizon;
        for (const l of r.landings) {
          if (l.floor > top) {
            top = l.floor;
            topAt = l.step;
          }
          if (prev >= 0 && l.floor - prev >= 2) comboLand++;
          prev = l.floor;
        }
        // higher is better, sooner is better; keep the finger where it is on a tie
        let score = top * 10 - topAt / 20 + (combos ? comboLand * 6 + Math.abs(r.vx) / 120 : 0);
        if (r.deadAt >= 0) score = -10000 + r.deadAt;
        if (a === cur) score += 0.05;
        if (!best || score > best.score) best = { a, n, b, score, top, dead: r.deadAt };
      }
    }
  }
  return best;
};

/**
 * Expert planner: plays like the bounce player (push the way you move, turn at
 * the walls) but steers every flight onto the best floor. The first `lat`
 * steps keep the current finger (reaction time), then each candidate pushes
 * dir `a` for `n` steps and follows the motion after that.
 */
const ICY_EXPERT = ({ lat, cur, firsts, horizon, expertSafe }) => {
  const d = window.__icy;
  if (!d || d.state.mode !== 'run') return null;
  const s = d.state;
  const from = s.grounded >= 0 ? s.grounded : s.runFloor;
  let best = null;
  for (const a of s.grounded >= 0 ? [-1, 1, 2] : [-1, 0, 1, 2]) {
    for (const n of firsts) {
      const r = d.predict([[cur === 0 ? 2 : cur, lat], [a, n], [2, horizon]], horizon);
      let first = null;
      let top = from;
      for (const l of r.landings) {
        if (l.step <= lat) continue;
        if (!first) first = l;
        if (l.floor > top) top = l.floor;
      }
      let score = (first ? first.floor * 10 : from * 10 - 5) + top * 4 + Math.abs(r.vx) / 100;
      if (first && first.floor - from >= 2) score += 8;
      // an expert also keeps away from the bottom edge (the floors speed up)
      if (r.margin !== undefined) score += Math.min(r.margin, 240) / (expertSafe || 1e9);
      if (a === 0) score -= 3; // letting go only when it clearly lands better
      if (r.deadAt >= 0) score = -10000 + r.deadAt;
      if (!best || score > best.score) best = { a, n, score, first: first && first.floor, top, dead: r.deadAt };
    }
  }
  if (best && best.a === 2) best.a = s.vx < 0 ? -1 : 1;
  return best;
};

/**
 * One icy player. kind: 'clumsy' | 'normal' | 'expert' | 'holdRight' | 'rhythm'.
 * Drives real touches until the round ends; returns stats.
 */
async function playIcy(page, touch, vp, kind, seed, opts = {}) {
  const rand = makeRand(seed);
  const xs = { [-1]: vp.width * 0.22, 1: vp.width * 0.78 };
  const y = vp.height * 0.66;
  let held = 0; // side currently touched
  const queue = []; // [dueAt, dir]
  let lastChange = 0;
  let mistakeUntil = 0;
  let mistakeDir = 0;
  const runFloors = [];
  let lastHook = null;
  let lastState = null;
  let decided = 0;
  let expertPlan = null;
  let expertVy = 0;
  const t0 = Date.now();
  const cfg = {
    clumsy: { lat: [250, 400], minHold: 220, tick: 60 },
    normal: { lat: [180, 250], minHold: 140, tick: 50 },
    expert: { lat: [120, 150], minHold: 90, tick: 40, horizon: 150, firsts: [3, 8, 15, 25, 40, 60], combos: true, thens: [2, 0] },
    holdRight: { lat: [0, 0], minHold: 0, tick: 100 },
    bounce: { lat: [150, 150], minHold: 0, tick: 30 },
    tapper: { lat: [250, 400], minHold: 0, tick: 60 },
    rhythm: { lat: [0, 0], minHold: 0, tick: 20 },
  }[kind];

  async function setHeld(dir) {
    if (dir === held) return;
    if (held !== 0) await touch.up(1);
    held = dir;
    if (dir !== 0) await touch.down(1, xs[dir], y);
  }

  const hardEnd = Date.now() + (opts.maxMs || 200000);
  let lastLog = 0;
  for (;;) {
    if (Date.now() > hardEnd) throw new Error(`${kind}: round did not end in time`);
    let st;
    try {
      st = await page.evaluate(ICY_STATE);
    } catch (err) {
      await sleep(50);
      continue;
    }
    if (process.env.QA_LOG && Date.now() - lastLog > 3000) {
      lastLog = Date.now();
      console.log(kind, st && st.hook, st && st.leftMs, st && st.s && st.s.mode);
    }
    if (!st) {
      await sleep(50);
      continue;
    }
    if (st.ended) {
      lastState = { ...st, s: lastState ? lastState.s : null };
      break;
    }
    lastState = st;
    // run bookkeeping from the test hook: runs|runFloor|bonus|best|score
    if (st.hook) {
      if (lastHook) {
        const a = lastHook.split('|').map(Number);
        const b = st.hook.split('|').map(Number);
        if (b[0] > a[0]) runFloors.push(a[1]);
      }
      lastHook = st.hook;
    }
    const now = Date.now();
    let want = held;
    if (st.s.mode === 'run' && !st.frozen) {
      if (kind === 'holdRight') want = 1;
      else if (kind === 'bounce') want = st.s.vx < -40 ? -1 : st.s.vx > 40 ? 1 : held || 1; // follow the motion, never look at floors
      else if (kind === 'rhythm') want = Math.floor((now - t0) / (opts.period || 450)) % 2 === 0 ? 1 : -1;
      else if (kind === 'tapper') {
        // a first-timer who taps instead of holding: one tap towards the floor above every 0.35-0.6 s
        if (now >= (cfg.nextTap || 0)) {
          const s = st.s;
          const from = s.grounded >= 0 ? s.grounded + 1 : Math.max(1, s.runFloor);
          const fl = await page.evaluate(([f]) => (window.__icy ? window.__icy.floors(f, 1) : []), [from]).catch(() => []);
          const dir = fl[0] ? (fl[0].x < s.x ? -1 : 1) : 1;
          const d = rand() < 0.1 ? -dir : dir;
          cfg.nextTap = now + 350 + rand() * 250;
          setTimeout(() => touch.tap(xs[d], y).catch(() => {}), cfg.lat[0] + rand() * (cfg.lat[1] - cfg.lat[0]));
        }
        await sleep(cfg.tick);
        continue;
      } else if (kind === 'clumsy') {
        // looks at the next floor above and holds towards it; never plans ahead
        const s = st.s;
        const from = s.grounded >= 0 ? s.grounded + 1 : Math.max(1, s.runFloor);
        const fl = await page.evaluate(([f]) => (window.__icy ? window.__icy.floors(f, 2) : []), [from]).catch(() => []);
        const tgt = fl[0];
        let dir = held || 1;
        if (tgt) {
          const dx = tgt.x - s.x;
          if (Math.abs(dx) > tgt.half * 0.4) dir = dx < 0 ? -1 : 1;
          else dir = held || (dx < 0 ? -1 : 1); // under it: keeps holding (does not know better)
        }
        if (now > mistakeUntil && rand() < 0.035) {
          // a mistake: wrong side or lets go for a moment
          mistakeUntil = now + 300 + rand() * 500;
          mistakeDir = rand() < 0.6 ? -dir : 0;
        }
        want = now < mistakeUntil ? mistakeDir : dir;
      } else {
        if (kind === 'expert' || kind === 'normal') {
          // decides once per flight (at each take-off), like a person: where to land
          const s = st.s;
          const tookOff = s.vy > expertVy + 300 || (expertPlan === null && s.grounded < 0);
          expertVy = s.vy;
          if (tookOff || (s.grounded >= 0 && (!expertPlan || now >= expertPlan.until))) {
            const lat = Math.round((cfg.lat[0] + rand() * (cfg.lat[1] - cfg.lat[0])) / 16.7);
            const look = kind === 'expert' ? { firsts: [4, 10, 20, 40], horizon: 120, expertSafe: 12 } : { firsts: [10, 25], horizon: 50 };
            const p = await page.evaluate(ICY_EXPERT, { lat, cur: held, ...look }).catch(() => null);
            if (p) expertPlan = { a: p.a, from: now + lat * 16.7, until: now + (lat + p.n) * 16.7 };
            // a normal player misjudges about one flight in eight
            if (p && kind === 'normal' && rand() < 0.12) expertPlan.a = rand() < 0.5 ? -p.a || 1 : 0;
          }
          const follow = s.vx < -40 ? -1 : s.vx > 40 ? 1 : held || 1;
          if (expertPlan && now >= expertPlan.from && now < expertPlan.until) want = expertPlan.a;
          else if (expertPlan && now < expertPlan.from) want = held;
          else want = follow;
          // the plan already includes the reaction time: act now
          if (want !== held && now - lastChange >= cfg.minHold) {
            await setHeld(want);
            lastChange = now;
            decided++;
          }
          await sleep(cfg.tick);
          continue;
        }
        const p = await page.evaluate(ICY_PLAN, { horizon: cfg.horizon, firsts: cfg.firsts, combos: cfg.combos, cur: held, thens: cfg.thens }).catch(() => null);
        if (p) want = p.a;
        if (kind === 'normal' && now > mistakeUntil && rand() < 0.012) {
          mistakeUntil = now + 250 + rand() * 300;
          mistakeDir = rand() < 0.5 ? -want : 0;
        }
        if (now < mistakeUntil) want = mistakeDir;
      }
    } else if (st.frozen) {
      want = held; // keeps the finger where it was (the game must ignore it)
    }
    // reaction latency: a new intention lands after lat ms
    const lastQueued = queue.length ? queue[queue.length - 1][1] : held;
    if (want !== lastQueued) {
      const lat = cfg.lat[0] + rand() * (cfg.lat[1] - cfg.lat[0]);
      queue.push([now + lat, want]);
      decided++;
    }
    while (queue.length && queue[0][0] <= now) {
      const [, dir] = queue.shift();
      if (now - lastChange >= cfg.minHold || dir === 0) {
        await setHeld(dir);
        lastChange = now;
      } else {
        queue.unshift([lastChange + cfg.minHold, dir]);
        break;
      }
    }
    await sleep(cfg.tick);
  }
  // cancel, not lift: a lifted finger would tap the end screen's "again" button
  if (held !== 0) await touch.cancel().catch(() => {});
  const parts = (lastHook || '0|0|0|0|0').split('|').map(Number);
  if (!lastState || !lastState.s || lastState.s.mode === 'run') runFloors.push(parts[1]); // the run in progress at the end
  const sorted = [...runFloors].sort((a, b) => a - b);
  return {
    kind,
    score: lastState ? lastState.score : 0,
    runs: runFloors.length,
    runFloors,
    medianFloor: sorted[Math.floor(sorted.length / 2)],
    bestFloor: sorted[sorted.length - 1],
    decided,
  };
}

module.exports = { sleep, SIZES, phoneContext, createTouch, makeRand, playIcy, ICY_STATE };

/** Frame-time recorder (runs in the page): every rAF interval in ms. */
async function startFrameRecorder(page) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const f = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (!window.__party || !window.__party.ended) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
}

async function frameStats(page) {
  const d = await page.evaluate(() => window.__frames.slice(5));
  const s = [...d].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return {
    frames: d.length,
    p50: +q(0.5).toFixed(1),
    p95: +q(0.95).toFixed(1),
    p99: +q(0.99).toFixed(1),
    max: +s[s.length - 1].toFixed(1),
    over50: d.filter((v) => v > 50).length,
    // by quarter of the round: does it get slower?
    quarters: [0, 1, 2, 3].map((k) => {
      const part = d.slice(Math.floor((d.length * k) / 4), Math.floor((d.length * (k + 1)) / 4)).sort((a, b) => a - b);
      return +part[Math.floor(part.length * 0.95)].toFixed(1);
    }),
  };
}

module.exports.startFrameRecorder = startFrameRecorder;
module.exports.frameStats = frameStats;
