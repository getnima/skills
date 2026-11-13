// NOTE (13.11): the automatic videos are switched off for now (shared/cutscenes.ts, AUTO = false). The parts of
// this script that wait for tap_freeze, before_ninja or before_podium to start by themselves need AUTO = true.
// chaos-party: ONE realistic party end to end, with real intro / countdown timing, and chaos.
//
//   PORT=8941 PARTY_TEST_DURATION_MS=28000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8941 PARTY_CLIENT_PORT=5341 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/chaos-party.cjs
//
// The TV (1920x1080), the owner's remote on a phone page, eight touch phones (three through the
// real dressing room), two late joiners and 12 socket bots (tests/load/bots.ts) play all five games
// and the podium. A node observer socket (a second remote, password) records the server's truth.
// Everything lands in tests/e2e/out/chaos-/ (report.json, timeline.log, samples.jsonl, shots/).
'use strict';
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out', 'chaos-');
const SHOTS = path.join(OUT, 'shots');
const BASE = (process.env.BASE_URL || 'http://localhost:5341').replace(/\/+$/, '');
const SERVER = (process.env.SERVER_URL || 'http://localhost:8941').replace(/\/+$/, '');
const PW = process.env.PARTY_REMOTE_PASSWORD || 'kioso3tbh';
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(SHOTS)) fs.rmSync(path.join(SHOTS, f), { force: true });
const SAMPLES = path.join(OUT, 'samples.jsonl');
fs.writeFileSync(SAMPLES, '');

const { io } = require(path.join(ROOT, 'node_modules/socket.io-client'));
function loadTs(entry) {
  const esbuild = require(path.join(ROOT, 'node_modules/esbuild'));
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { computeRoundScores } = loadTs('shared/scoring.ts');
const { GAMES, GAME_IDS, WINNER_REVEAL_MS } = loadTs('shared/protocol.ts');
const { roundTime } = loadTs('shared/round-clock.ts');

// ───────────────────────────── logging ─────────────────────────────
const T0 = Date.now();
const hhmm = (t = Date.now()) => new Date(t).toISOString().slice(11, 23);
const timeline = [];
const j = (x) => (typeof x === 'string' ? x : JSON.stringify(x));
function ev(...a) {
  const line = `${hhmm()} +${((Date.now() - T0) / 1000).toFixed(1)}s ${a.map(j).join(' ')}`;
  console.log(line);
  timeline.push(line);
}
const checks = [];
function check(ok, name, extra) {
  checks.push({ ok: !!ok, name, extra: extra === undefined ? undefined : JSON.parse(JSON.stringify(extra)), t: hhmm() });
  ev(ok ? 'ok  ' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 900));
  return !!ok;
}
const issues = [];
function issue(sev, area, title, data) {
  issues.push({ sev, area, title, data, t: hhmm() });
  ev('ISSUE', sev, area, title, JSON.stringify(data === undefined ? '' : data).slice(0, 900));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label, step = 60) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      last = await fn();
    } catch (e) {
      last = null;
    }
    if (last) return last;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(step);
  }
}
let shotN = 0;
async function shot(stage, list) {
  const n = String(++shotN).padStart(3, '0');
  await Promise.all(
    list.map(async (p) => {
      if (!p || !p.page || p.page.isClosed()) return;
      const f = path.join(SHOTS, `${n}-${hhmm().replace(/[:.]/g, '')}-${stage}-${p.label}.png`);
      await p.page.screenshot({ path: f, timeout: 15000 }).catch((e) => ev('shot failed', p.label, String(e.message).slice(0, 80)));
    }),
  );
}

// ───────────────────────────── the observer (server truth) ─────────────────────────────
const obs = { states: [], trans: [], scores: [], last: null, model: null, lastKey: '' };
function stKey(st) {
  const r = st.round;
  return [st.phase, st.cutscene ? st.cutscene.id : '', r ? r.index : '', r ? r.frozenAt : '', r ? r.resumeAt : '', r ? r.startAt : '', st.results ? st.results.revealAt : ''].join('|');
}
function pushState(st) {
  obs.last = st;
  obs.states.push({ wall: Date.now(), st });
  const k = stKey(st);
  if (k !== obs.lastKey) {
    obs.trans.push({ t: st.serverNow, key: k, phase: st.phase, cut: st.cutscene ? st.cutscene.id : null });
    obs.lastKey = k;
  }
}
function startObserver(code) {
  return new Promise((resolve, reject) => {
    const s = io(SERVER, { transports: ['websocket'], forceNew: true, reconnectionDelay: 200 });
    let done = false;
    s.on('state', pushState);
    s.on('scores', (m) => {
      obs.scores.push({ wall: Date.now(), round: m.round, active: m.active, out: m.out.length, top: m.scores.slice(0, 3), n: m.scores.length });
      obs.lastScores = m;
    });
    s.on('relay', ({ data }) => {
      if (data && data.t === 'model') obs.model = data.model;
    });
    s.on('connect', () =>
      s.emit('remote:attach', { password: PW, code }, (res) => {
        if (res.ok) {
          pushState(res.state);
          if (!done) {
            done = true;
            resolve(s);
          }
        } else if (!done) reject(new Error('observer attach: ' + res.error));
      }),
    );
  });
}
/** The server's state at server time t (same machine: server time = Date.now()). */
function stateAt(t) {
  let lo = 0;
  let hi = obs.states.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (obs.states[mid].st.serverNow <= t) {
      best = obs.states[mid].st;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}
const transNear = (t, ms) => obs.trans.some((x) => Math.abs(x.t - t) <= ms);
const S = () => obs.last;

// ───────────────────────────── pages ─────────────────────────────
const errors = [];
const pages = [];
/** Chaos windows: [label, kind, from, to] (wall ms), so a mismatch inside one is classified. */
const windows = [];
function openWindow(label, kind) {
  const w = { label, kind, from: Date.now(), to: Infinity };
  windows.push(w);
  return w;
}
const windowOf = (label, t) => windows.filter((w) => (w.label === label || w.label === '*') && t >= w.from - 300 && t <= w.to + 2500).map((w) => w.kind);

async function addPage(browser, label, kind, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(() => {
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      console.error('[chaos] unhandledrejection: ' + (r && (r.stack || r.message) ? r.stack || r.message : String(r)));
    });
  });
  const page = await ctx.newPage();
  const p = { label, kind, ctx, page, cdp: null, hold: false };
  page.on('pageerror', (e) => errors.push({ t: hhmm(), wall: Date.now(), label, type: 'pageerror', text: e.message, stack: String(e.stack || '').slice(0, 400) }));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {};
    errors.push({ t: hhmm(), wall: Date.now(), label, type: 'console', text: m.text().slice(0, 500), url: loc.url || '' });
  });
  p.cdp = await ctx.newCDPSession(page);
  pages.push(p);
  return p;
}

const SAMPLE = () => {
  const se = document.scrollingElement || document.documentElement;
  const vv = window.visualViewport;
  const o = {
    wall: Date.now(),
    sh: se.scrollHeight,
    sw: se.scrollWidth,
    H: innerHeight,
    W: innerWidth,
    sx: Math.round(scrollX),
    sy: Math.round(scrollY),
    scale: vv ? Math.round(vv.scale * 1000) / 1000 : 1,
    vvx: vv ? Math.round(vv.offsetLeft) : 0,
    vvy: vv ? Math.round(vv.offsetTop) : 0,
  };
  try {
    if (window.__host) {
      const s = window.__host.state();
      o.kind = 'tv';
      o.now = window.__host.now();
      o.status = window.__host.status();
      if (s) {
        o.phase = s.phase;
        o.cut = s.cutscene ? s.cutscene.id : null;
        o.round = s.round;
        o.revealAt = s.results ? s.results.revealAt : null;
        o.players = s.players.length;
      }
    } else if (window.__remote) {
      o.kind = 'remote';
      const m = window.__remote.model();
      o.mphase = m ? m.phase : null;
      o.tv = window.__remote.tv();
      o.server = window.__remote.server();
      const c = document.querySelector('[data-testid=clock]');
      o.clockText = c ? c.textContent : null;
      const main = document.querySelector('[data-testid=main]');
      o.phase = main ? main.dataset.phase : null;
      const big = document.querySelector('[data-testid=big]');
      o.big = big ? big.dataset.action : null;
    } else if (window.__player) {
      const p = window.__player;
      const s = p.snap.state;
      o.kind = 'phone';
      o.now = p.now();
      o.screen = p.screen;
      o.status = p.snap.status;
      o.online = p.snap.online;
      if (s) {
        o.phase = s.phase;
        o.cut = s.cutscene ? s.cutscene.id : null;
        o.round = s.round;
        o.revealAt = s.results ? s.results.revealAt : null;
      }
      const pl = window.__playerPlay;
      if (pl) {
        o.playLeft = Math.round(pl.leftMs);
        o.playFrozen = pl.frozen;
        o.playRound = pl.round;
      }
      const rot = document.querySelector('.pp-rotate');
      if (rot) {
        const cs = getComputedStyle(rot);
        o.rotate = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5;
      }
    }
  } catch (e) {
    o.err = String(e && e.message);
  }
  return o;
};

const mism = [];
const scrolls = [];
const clockOff = [];
const remoteClock = [];
const PHASE_SCREENS = {
  lobby: ['lobby', 'dressing'],
  intro: ['intro', 'late'],
  countdown: ['countdown', 'late', 'intro'],
  playing: ['playing', 'countdown', 'sending', 'suspense', 'late'],
  results: ['sending', 'suspense', 'win', 'reveal', 'results'],
  final: ['final'],
};
function analyze(r) {
  if (!r || r.err || !r.kind) return;
  const tw = r.wall;
  const truth = stateAt(tw);
  const win = windowOf(r.label, tw);
  // scroll / zoom (the TV is a 1920x1080 page; phones and the remote are phone pages)
  if (r.sh > r.H + 1 || r.sw > r.W + 1 || r.sy !== 0 || r.sx !== 0 || Math.abs((r.scale || 1) - 1) > 0.01 || r.vvx !== 0 || r.vvy !== 0) {
    scrolls.push({ t: hhmm(tw), label: r.label, screen: r.screen || r.phase, sh: r.sh, H: r.H, sw: r.sw, W: r.W, sx: r.sx, sy: r.sy, scale: r.scale, vv: [r.vvx, r.vvy], win });
  }
  if (!truth) return;
  const near = transNear(tw, 350);
  if (r.now !== undefined) {
    const off = r.now - tw;
    if (Math.abs(off) > 150) clockOff.push({ t: hhmm(tw), label: r.label, off: Math.round(off), win });
  }
  if (r.phase && r.phase !== 'none' && r.phase !== truth.phase && !near) {
    mism.push({ t: hhmm(tw), wall: tw, label: r.label, kind: 'phase', page: r.phase, truth: truth.phase, screen: r.screen, win });
  }
  if (r.kind === 'phone' && r.phase === truth.phase && r.screen && PHASE_SCREENS[r.phase] && !PHASE_SCREENS[r.phase].includes(r.screen) && !['boot', 'join'].includes(r.screen) && !near) {
    mism.push({ t: hhmm(tw), wall: tw, label: r.label, kind: 'screen', page: r.screen, truth: truth.phase, win });
  }
  if (r.cut !== undefined && (r.cut || null) !== (truth.cutscene ? truth.cutscene.id : null) && !near) {
    mism.push({ t: hhmm(tw), wall: tw, label: r.label, kind: 'cutscene', page: r.cut, truth: truth.cutscene ? truth.cutscene.id : null, win });
  }
  if (truth.phase === 'playing' && truth.round) {
    const tl = roundTime(truth.round, tw).leftMs;
    if (r.round && r.round.index === truth.round.index && r.now !== undefined) {
      const pl = roundTime(r.round, r.now).leftMs;
      if (Math.abs(pl - tl) > 300 && !near) mism.push({ t: hhmm(tw), wall: tw, label: r.label, kind: 'left', diff: Math.round(pl - tl), page: pl, truth: tl, win });
    }
    if (r.kind === 'phone' && r.screen === 'playing' && r.playLeft !== undefined && r.playRound === truth.round.index && !near && Math.abs(r.playLeft - tl) > 300) {
      mism.push({ t: hhmm(tw), wall: tw, label: r.label, kind: 'hudLeft', diff: Math.round(r.playLeft - tl), page: r.playLeft, truth: tl, win });
    }
    if (r.kind === 'remote' && r.clockText && !near) {
      const m = /(\d+):(\d\d)/.exec(r.clockText);
      if (m) {
        const shownS = Number(m[1]) * 60 + Number(m[2]);
        const want = Math.ceil(tl / 1000);
        if (Math.abs(shownS - want) > 1) remoteClock.push({ t: hhmm(tw), shown: r.clockText, wantS: want, win });
      }
    }
  }
}
let sampling = true;
let sampleN = 0;
async function sampler() {
  while (sampling) {
    const t0 = Date.now();
    const live = pages.filter((p) => !p.page.isClosed() && !p.noSample);
    const res = await Promise.all(
      live.map(async (p) => {
        try {
          const s = await Promise.race([p.page.evaluate(SAMPLE), sleep(2500).then(() => ({ err: 'sample timeout' }))]);
          return { label: p.label, ...s };
        } catch (e) {
          return { label: p.label, err: String(e.message).slice(0, 60) };
        }
      }),
    );
    sampleN++;
    for (const r of res) analyze(r);
    fs.appendFileSync(SAMPLES, JSON.stringify({ t: hhmm(t0), res: res.map((r) => ({ ...r, round: r.round ? { i: r.round.index, s: r.round.startAt, e: r.round.endAt, f: r.round.frozenAt, r: r.round.resumeAt } : r.round })) }) + '\n');
    await sleep(Math.max(150, 900 - (Date.now() - t0)));
  }
}

// ───────────────────────────── phones ─────────────────────────────
const pinfo = (ph) =>
  ph.page.evaluate(() => {
    const p = window.__player;
    if (!p) return null;
    const pl = window.__playerPlay;
    const st = p.snap.state;
    const hud = document.querySelector('.pa-hud-num');
    const hudScore = hud ? Number(hud.textContent.replace(/[^\d]/g, '')) : null;
    return {
      screen: p.screen,
      cutscene: p.cutscene,
      now: p.now(),
      id: p.snap.playerId,
      name: st && p.snap.playerId ? (st.players.find((x) => x.id === p.snap.playerId) || {}).name : null,
      score: pl ? (hudScore ?? pl.stageScore) : null,
      stageScore: pl ? pl.stageScore : null,
      leftMs: pl ? pl.leftMs : null,
      frozen: pl ? pl.frozen : null,
      playRound: pl ? pl.round : null,
      endedRound: p.snap.endedRound,
      endedScore: p.snap.endedScore,
      finalAcked: p.snap.finalAcked,
      phase: st ? st.phase : null,
      roundIndex: st && st.round ? st.round.index : null,
    };
  });
const screenOf = async (ph) => {
  const i = await pinfo(ph).catch(() => null);
  return i ? i.screen : null;
};

function drive(ph, step) {
  const d = { alive: true };
  d.done = (async () => {
    while (d.alive) {
      try {
        const i = await pinfo(ph);
        if (i && i.screen === 'playing' && typeof i.score === 'number' && i.playRound === ph.curRound) ph.hudFinal = Math.max(ph.hudFinal || 0, i.score);
        if (!i || i.screen !== 'playing' || i.frozen !== false || i.cutscene || ph.hold) {
          await sleep(70);
          continue;
        }
        await step(i);
      } catch {
        await sleep(120);
      }
    }
  })();
  return d;
}
async function stopDrivers(list) {
  for (const d of list) d.alive = false;
  await Promise.all(list.map((d) => Promise.race([d.done, sleep(8000)])));
}
async function touchStart(ph, x, y) {
  await ph.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
}
async function touchMove(ph, x, y) {
  await ph.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
}
async function touchEnd(ph) {
  await ph.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function touchSwipe(ph, x0, y0, x1, y1) {
  await touchStart(ph, x0, y0);
  for (let k = 1; k <= 6; k++) {
    await touchMove(ph, x0 + ((x1 - x0) * k) / 6, y0 + ((y1 - y0) * k) / 6);
    await sleep(12);
  }
  await touchEnd(ph);
}
function tapDriver(ph, gapMs) {
  return drive(ph, async () => {
    const f = await ph.page.evaluate(() => (window.__tap ? window.__tap() : null));
    if (!f) return sleep(60);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * f.r * 0.5;
    await ph.page.touchscreen.tap(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r);
    await sleep(gapMs);
  });
}
function icyDriver(ph, holdMs) {
  let left = true;
  return drive(ph, async () => {
    const vp = ph.page.viewportSize();
    await touchStart(ph, left ? vp.width * 0.18 : vp.width * 0.82, vp.height * 0.62);
    await sleep(holdMs);
    await touchEnd(ph);
    left = !left;
    await sleep(50);
  });
}
function flappyDriver(ph, skill, giveUpMs) {
  let lastTap = 0;
  return drive(ph, async () => {
    const s = await ph.page.evaluate(() => {
      const f = window.__flappy;
      const p = window.__player;
      const r = p && p.snap.state && p.snap.state.round;
      return f ? { mode: f.mode, y: f.birdY, vy: f.vy, next: f.next, hint: f.hint, startAt: r ? r.startAt : 0, now: p.now(), frozenAt: r ? r.frozenAt : null } : null;
    });
    if (!s) return sleep(40);
    const elapsed = s.now - s.startAt;
    if (elapsed > giveUpMs) return sleep(60); // this guest stops flying: the bird drops
    const vp = ph.page.viewportSize();
    const tap = async () => {
      await ph.page.touchscreen.tap(vp.width * (0.3 + Math.random() * 0.4), vp.height * (0.4 + Math.random() * 0.3));
      lastTap = Date.now();
    };
    if (s.mode === 'fly' && s.hint > 0.5 && Date.now() - lastTap > 300) await tap();
    else if (s.mode === 'fly') {
      const aim = (s.next.x < 30 ? s.next.gapY + s.next.gap * 0.18 : 48) + (1 - skill) * (Math.random() - 0.5) * 22;
      if (s.y > aim && s.vy > -25 && Date.now() - lastTap > 150) await tap();
    }
    await sleep(10);
  });
}
function ninjaDriver(ph, restMs) {
  return drive(ph, async () => {
    const ts = await ph.page.evaluate(() => (window.__ninja ? window.__ninja.targets() : []));
    const vp = ph.page.viewportSize();
    const lead = 0.06;
    const pts = ts.map((t) => ({ ...t, px: t.x + t.vx * lead, py: t.y + (t.vy + 600) * lead }));
    const bombs = pts.filter((t) => t.kind === 'bomb');
    const fruit = pts.find((t) => t.kind !== 'bomb' && t.py > 140 && t.py < vp.height - 50 && bombs.every((b) => Math.abs(b.py - t.py) > b.r * 2.4 || Math.abs(b.px - t.px) > b.r * 4));
    if (!fruit) return sleep(45);
    await touchSwipe(ph, fruit.px - fruit.r * 1.5, fruit.py, fruit.px + fruit.r * 1.5, fruit.py);
    await sleep(restMs);
  });
}
function plotzelDriver(ph, keyGapMs) {
  const key = (k) => ph.page.locator(`.pz-key[data-k="${k}"]`).tap({ timeout: 1500 });
  return drive(ph, async () => {
    const s = await ph.page.evaluate(() => {
      const p = window.__plotzel;
      return p && p.phase === 'play' ? { next: p.path()[1], typed: Array.from(p.typed).length } : null;
    });
    if (!s || !s.next) return sleep(90);
    for (let i = 0; i < s.typed; i++) await key('BACK');
    for (const ch of Array.from(s.next)) {
      await key(ch);
      await sleep(keyGapMs);
    }
    await key('ENTER');
    await sleep(keyGapMs);
  });
}

// ───────────────────────────── the run ─────────────────────────────
const EMOJI_NAME = '🎉🍕🐱🌈🔥🎈🦄🍉⚽🎸🚀🌵🍩👨‍👩‍👧';
const graphemes = (s) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);

(async () => {
  const browser = await chromium.launch();
  const phones = [];
  const late = [];
  let drivers = [];
  let bots = null;
  let obsSock = null;
  const totals = new Map(); // playerId -> my recomputed total
  const kicked = new Set();
  const roundsOut = [];
  let TV;
  let R;
  let code;
  const sampleLoop = { p: null };
  try {
    // ── the TV ──
    TV = await addPage(browser, 'tv', 'tv', { viewport: { width: 1920, height: 1080 } });
    const tv = TV.page;
    await tv.goto(BASE + '/host.html');
    await tv.evaluate(() => localStorage.clear());
    await tv.goto(BASE + '/host.html');
    await tv.waitForSelector('[data-testid=room-code]', { timeout: 30000 });
    await waitFor(() => tv.evaluate(() => window.__host && window.__host.state() && window.__host.status() === 'online'), 20000, 'tv online');
    code = (await tv.textContent('[data-testid=room-code]')).trim();
    ev('room', code);
    await tv.mouse.click(960, 60);
    const shown = (await tv.textContent('[data-testid=join-url]')).trim();
    const join = new URL(/^https?:/.test(shown) ? shown : 'http://' + shown);
    const joinUrl = (extra) => `${BASE}${join.pathname}${join.search}${extra || ''}`;
    ev('join url on TV', shown);
    obsSock = await startObserver(code);
    sampleLoop.p = sampler();

    // ── the owner's remote ──
    R = await addPage(browser, 'remote', 'remote', { ...devices['iPhone 13'] });
    const r = R.page;
    await r.goto(BASE + '/remote.html');
    await r.waitForSelector('[data-testid=unlock]', { timeout: 20000 });
    await r.locator('[data-testid=unlock-input]').tap();
    await r.fill('[data-testid=unlock-input]', PW);
    await r.locator('[data-testid=unlock-go]').tap();
    await r.waitForSelector('[data-testid=main]', { timeout: 20000 });
    await waitFor(() => r.evaluate(() => window.__remote.tv() === 'online' && !!window.__remote.model()), 15000, 'remote sees the TV');
    await waitFor(async () => S().remotes >= 2, 8000, 'remotes counted');
    await sleep(800);
    check(!(await tv.locator('[data-testid=strip]').isVisible().catch(() => false)), 'TV hides its strip with the remote attached');
    await shot('remote-attached', [TV, R]);

    // ── eight phones ──
    const spec = [
      { label: 'se', device: 'iPhone SE', name: 'דני', dress: true },
      { label: 'i14', device: 'iPhone 14', name: 'דני', dress: false },
      { label: 'pm', device: 'iPhone 14 Pro Max', name: EMOJI_NAME, dress: true },
      { label: 'px7', device: 'Pixel 7', name: 'מיכל', dress: true },
      { label: 's8', device: 'Galaxy S8', name: 'אבי', dress: false },
      { label: 'i13', device: 'iPhone 13', name: 'נועה', dress: false },
      { label: 'px7b', device: 'Pixel 7', name: 'יוסי המלך', dress: false },
      { label: 'mini', device: 'iPhone 12 Mini', name: 'שירה', dress: false },
    ];
    async function joinPhone(s, viaCode) {
      const ph = await addPage(browser, s.label, 'phone', { ...devices[s.device] });
      Object.assign(ph, { name: s.name, typedName: s.name, hudFinal: 0, rounds: [], device: s.device });
      const page = ph.page;
      if (viaCode) {
        await page.goto(BASE + '/');
        await page.waitForSelector('.pp-code-input', { timeout: 20000 });
        await page.locator('.pp-code-input').tap();
        await page.keyboard.type(code.toLowerCase(), { delay: 90 });
      } else {
        await page.goto(joinUrl(s.dress ? '&dress=1' : ''));
      }
      await page.waitForSelector('.pp-name-input', { timeout: 20000 });
      await page.locator('.pp-name-input').tap();
      await page.keyboard.type(s.name, { delay: 40 });
      await page.locator('.pp-btn-go').tap();
      if (s.dress) {
        const DRESS = require('./dress-lib.cjs');
        await DRESS.waitDressing(page, 40000);
        await sleep(900);
        await shot('dressing', [ph]);
        const look = await DRESS.tapItem(page, 'HEAD', 2);
        await DRESS.tapItem(page, 'EYES', 1).catch(() => null);
        const onTv = await waitFor(async () => {
          const st = await tv.evaluate(() => window.__host.state());
          const roomLook = await DRESS.roomLook(page);
          return st && st.players.some((p) => p.look === roomLook) ? roomLook : null;
        }, 6000, 'TV hears the look').catch(() => null);
        check(onTv !== null, `${s.label}: the doll dressed on the phone reaches the TV`, { look, onTv });
        await DRESS.finishDressing(page, 20000);
      }
      const i = await waitFor(async () => {
        const x = await pinfo(ph);
        return x && x.id && !['join', 'boot', 'dressing'].includes(x.screen) ? x : null;
      }, 30000, `${s.label} joined`);
      ph.id = i.id;
      ph.name = i.name;
      ph.joinedAt = Date.now();
      totals.set(ph.id, 0);
      ev('joined', s.label, s.device, JSON.stringify(i.name), i.screen);
      return ph;
    }
    for (const s of spec) phones.push(await joinPhone(s, false));
    // ── 12 bots ──
    bots = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', '12', '--play', '--elim-by', '14000', '--quiet'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const botLog = fs.createWriteStream(path.join(OUT, 'bots.log'));
    bots.stdout.pipe(botLog);
    bots.stderr.pipe(botLog);
    await waitFor(() => S().players.length >= 20, 30000, '20 players');
    for (const p of S().players) if (!totals.has(p.id)) totals.set(p.id, 0);
    ev('players', S().players.length);

    // names: same name twice, the 14-grapheme emoji name
    const names = S().players.map((p) => p.name);
    const dani = names.filter((n) => n.startsWith('דני'));
    check(dani.length === 2 && new Set(dani).size === 2, 'two guests called דני get two different names on the server', dani);
    const se = phones[0];
    const i14 = phones[1];
    check(se.name !== i14.name, 'each דני phone shows its own name', { se: se.name, i14: i14.name });
    const pm = phones[2];
    check(pm.name === EMOJI_NAME && graphemes(pm.name).length === 14, 'the 14-grapheme emoji name is kept whole', { got: pm.name, graphemes: graphemes(pm.name || '').length });
    await sleep(1200);
    const tvText = await tv.evaluate(() => document.body.innerText);
    check(tvText.includes(EMOJI_NAME) || tvText.includes(EMOJI_NAME.slice(0, 8)), 'TV lobby shows the emoji name (at least its start)', { found: tvText.includes(EMOJI_NAME) });
    check(tvText.includes('דני 2') || tvText.includes(i14.name), 'TV lobby lists the second דני', { i14: i14.name });
    await shot('lobby-full', [TV, R, phones[0], phones[2]]);

    // ───────────────────────── helpers bound to this party ─────────────────────────
    const hs = () => tv.evaluate(() => (window.__host ? window.__host.state() : null));
    const waitObs = (fn, ms, label) => waitFor(() => fn(S()), ms, label, 40);
    const curElapsed = () => {
      const s = S();
      if (!s || !s.round) return -1e9;
      return roundTime(s.round, Date.now()).elapsedMs;
    };
    async function waitElapsed(ms, label) {
      await waitFor(() => {
        const s = S();
        if (!s || s.phase !== 'playing' || !s.round) return s && s.phase === 'results' ? 'ended' : null;
        const t = roundTime(s.round, Date.now());
        return !t.frozen && t.elapsedMs >= ms ? 'ok' : null;
      }, 120000, `elapsed ${ms} (${label})`, 50);
      return S().phase === 'playing';
    }
    async function remoteBig() {
      const b = r.locator('[data-testid=big]');
      await waitFor(() => b.isEnabled(), 15000, 'remote big enabled');
      return { action: await b.getAttribute('data-action'), cls: await b.getAttribute('class'), label: (await b.textContent()).trim(), box: await b.boundingBox() };
    }
    async function closeRemoteSheets() {
      for (const id of ['confirm-no', 'more-close', 'cutscenes-close', 'players-close']) {
        if (await r.locator(`[data-testid=${id}]`).isVisible().catch(() => false)) await r.locator(`[data-testid=${id}]`).tap().catch(() => undefined);
      }
    }
    /** The owner double-taps the big button (two real taps ~140 ms apart). Returns what the server did next. */
    async function doubleTapBig(step, expectAction, gapMs = 140) {
      await closeRemoteSheets();
      const b = await remoteBig();
      if (expectAction && b.action !== expectAction) issue('minor', 'remote', `big button is "${b.action}" where "${expectAction}" was expected (${step})`, b);
      const x = b.box.x + b.box.width / 2;
      const y = b.box.y + b.box.height / 2;
      const before = { phase: S().phase, round: S().round ? S().round.index : null, played: S().played.length, trans: obs.trans.length };
      ev(`remote double-tap big (${step}, ${gapMs} ms apart)`, b.action, b.label);
      const flashes = [];
      const flashWatch = { on: true };
      const fw = (async () => {
        while (flashWatch.on) {
          const f = await r.evaluate(() => {
            const e = document.querySelector('[data-testid=flash]');
            const big = document.querySelector('[data-testid=big]');
            return [e ? e.textContent : '', big ? big.dataset.action + (big.disabled ? '(off)' : '') : ''];
          }).catch(() => null);
          if (f && (flashes.length === 0 || flashes[flashes.length - 1] !== f.join('|'))) flashes.push(f.join('|'));
          await sleep(60);
        }
      })();
      await r.touchscreen.tap(x, y);
      await sleep(gapMs);
      await r.touchscreen.tap(x, y);
      await sleep(2600);
      flashWatch.on = false;
      await fw;
      const after = obs.trans.slice(before.trans).map((t) => `${t.phase}${t.cut ? '+' + t.cut : ''}`);
      const sheet = await r.locator('[data-testid=confirm]').isVisible().catch(() => false);
      const sheetText = sheet ? (await r.locator('[data-testid=confirm]').textContent().catch(() => '')).trim().slice(0, 80) : null;
      ev(`  after double-tap: transitions ${after.join(' → ') || '(none)'}; sheet ${sheet ? sheetText : 'none'}; remote flash|big: ${flashes.join(' / ')}`);
      if (sheet) await closeRemoteSheets();
      return { before, after, sheet: sheetText, action: b.action, flashes, now: { phase: S().phase, round: S().round ? S().round.index : null } };
    }
    async function remoteCutscene(id) {
      await closeRemoteSheets();
      await r.locator('[data-testid=tray-cutscenes]').tap();
      await r.waitForSelector('[data-testid=cutscenes]', { timeout: 5000 });
      await r.locator(`[data-testid=cut-${id}]`).tap();
      await waitObs((s) => s.cutscene && s.cutscene.id === id, 8000, `cutscene ${id}`);
      ev('remote fired cutscene', id);
    }
    async function remoteKick(name) {
      await closeRemoteSheets();
      await r.locator('[data-testid=tray-more]').tap();
      await r.waitForSelector('[data-testid=more]', { timeout: 5000 });
      await r.locator('[data-testid=more-kick]').tap();
      await r.waitForSelector('[data-testid=players]', { timeout: 5000 });
      const row = r.locator(`[data-testid=kick-row][data-name="${name}"]`).first();
      await row.scrollIntoViewIfNeeded().catch(() => undefined);
      await row.tap();
      await r.waitForSelector('[data-testid=confirm]', { timeout: 5000 });
      await sleep(400);
      await r.locator('[data-testid=confirm-yes]').tap();
      await sleep(450);
      if (await r.locator('[data-testid=confirm-yes]').isVisible().catch(() => false)) await r.locator('[data-testid=confirm-yes]').tap();
    }
    async function remoteEndRound() {
      await closeRemoteSheets();
      const b = await remoteBig();
      if (b.action !== 'end-round') issue('minor', 'remote', 'big button is not end-round while playing', b);
      await r.locator('[data-testid=big]').tap();
      await r.waitForSelector('[data-testid=confirm]', { timeout: 5000 });
      await sleep(400);
      await r.locator('[data-testid=confirm-yes]').tap();
      await sleep(450);
      if (await r.locator('[data-testid=confirm-yes]').isVisible().catch(() => false)) await r.locator('[data-testid=confirm-yes]').tap();
    }
    async function tvReload(why) {
      const w = openWindow('tv', 'tvreload');
      const before = await hs();
      const t0 = Date.now();
      ev('TV reload', why);
      await tv.reload();
      await waitFor(() => tv.evaluate(() => window.__host && window.__host.state() !== null && window.__host.status() === 'online'), 20000, 'tv back');
      const after = await hs();
      const ms = Date.now() - t0;
      w.to = Date.now();
      check(after.code === before.code && after.phase === S().phase && (after.round ? after.round.index : null) === (S().round ? S().round.index : null), `TV reload (${why}) re-attaches to the same room and phase in ${ms} ms`, { code: after.code, phase: after.phase });
      await sleep(600);
      const strip = await tv.locator('[data-testid=strip]').isVisible().catch(() => false);
      check(!strip, `TV strip stays hidden after its reload (${why}) with the remote attached`);
      await tv.mouse.click(960, 60); // the owner clicks once so sound is allowed again (README step 4); the strip peeks 4 s by design
      const locked = await tv.evaluate(() => document.body.innerText.includes('לחצו') && document.body.innerText.includes('סאונד')).catch(() => null);
      ev('TV after reload: audio hint visible before click?', locked);
    }
    async function phoneReload(ph, why) {
      const w = openWindow(ph.label, 'reload');
      ph.hold = true;
      const before = await pinfo(ph).catch(() => null);
      const t0 = Date.now();
      ev('phone reload', ph.label, why, before && before.screen);
      await ph.page.reload();
      const after = await waitFor(async () => {
        const i = await pinfo(ph);
        return i && i.id && i.screen !== 'boot' && i.screen !== 'join' ? i : null;
      }, 25000, `${ph.label} back after reload`);
      w.to = Date.now();
      check(after.id === ph.id, `${ph.label} reload (${why}): same player, back on "${after.screen}" in ${Date.now() - t0} ms`, { before: before && before.screen, after: after.screen });
      ph.hold = false;
      return { before, after };
    }
    async function phoneOffline(ph, ms) {
      const w = openWindow(ph.label, 'offline');
      ph.hold = true;
      await ph.cdp.send('Network.enable');
      await ph.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      ev('phone OFFLINE', ph.label, `${ms} ms`);
      const t0 = Date.now();
      const seen = [];
      while (Date.now() - t0 < ms) {
        await sleep(1000);
        const i = await pinfo(ph).catch(() => null);
        seen.push(i ? `${i.screen}${i.frozen ? '*' : ''}` : '?');
      }
      await ph.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      const t1 = Date.now();
      ev('phone ONLINE again', ph.label, 'screens while offline', seen.join(','));
      const back = await waitFor(async () => {
        const st = S().players.find((p) => p.id === ph.id);
        const i = await pinfo(ph);
        return st && st.connected && i && i.phase === S().phase ? { i, ms: Date.now() - t1 } : null;
      }, 20000, `${ph.label} reconnects`).catch(() => null);
      w.to = Date.now();
      ph.hold = false;
      check(back !== null, `${ph.label}: back in sync ${back ? back.ms : '?'} ms after 15 s offline`, back && back.i.screen);
      return { seen, back };
    }
    async function hideTab(ph) {
      const w = openWindow(ph.label, 'hidden');
      ph.hold = true;
      await ph.page.evaluate(() => {
        const q = [];
        window.__chaosRaf = { orig: window.requestAnimationFrame.bind(window), cancel: window.cancelAnimationFrame.bind(window), q };
        window.requestAnimationFrame = (cb) => {
          q.push(cb);
          return 1e9 + q.length;
        };
        window.cancelAnimationFrame = (id) => {
          if (id >= 1e9) q[id - 1e9 - 1] = null;
          else window.__chaosRaf.cancel(id);
        };
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      ev('tab HIDDEN', ph.label);
      return w;
    }
    async function showTab(ph, w) {
      await ph.page
        .evaluate(() => {
          const c = window.__chaosRaf;
          delete document.visibilityState;
          delete document.hidden;
          if (c) {
            window.requestAnimationFrame = c.orig;
            window.cancelAnimationFrame = c.cancel;
          }
          document.dispatchEvent(new Event('visibilitychange'));
          if (c) for (const cb of c.q) if (cb) c.orig(cb);
          return document.visibilityState;
        })
        .catch(() => null);
      w.to = Date.now();
      ph.hold = false;
      ev('tab VISIBLE again', ph.label);
    }
    async function rotate(ph, ms) {
      const w = openWindow(ph.label, 'rotate');
      const vp = ph.page.viewportSize();
      ev('rotate to landscape', ph.label, vp);
      ph.hold = true;
      const dpr = (devices[ph.device] || {}).deviceScaleFactor || 2;
      const fs0 = await ph.page.evaluate(() => document.fullscreenElement !== null).catch(() => null);
      let l;
      let p;
      try {
        // a real rotation: the phone may be in fullscreen (Android goes fullscreen on join), so the
        // window is not resized; the device metrics and the screen orientation change instead
        await ph.cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.height, height: vp.width, deviceScaleFactor: dpr, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
        await sleep(900);
        l = await ph.page.evaluate(SAMPLE);
        await shot('landscape', [ph]);
        await sleep(Math.max(0, ms - 900));
        await ph.cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: dpr, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
        await sleep(900);
        p = await ph.page.evaluate(SAMPLE);
      } finally {
        w.to = Date.now();
        ph.hold = false;
      }
      ev('rotation done', ph.label, { fullscreen: fs0, landscape: [l.W, l.H], portrait: [p.W, p.H] });
      check(l.rotate === true, `${ph.label}: landscape shows the "rotate the phone" screen`, { rotate: l.rotate, screen: l.screen, sh: l.sh, H: l.H, sw: l.sw, W: l.W });
      check(p.rotate === false && p.sh <= p.H + 1 && p.sw <= p.W + 1 && p.scale === 1, `${ph.label}: back to portrait, no overlay, no scroll`, { rotate: p.rotate, screen: p.screen, sh: p.sh, H: p.H, sw: p.sw, W: p.W, scale: p.scale });
      return { l, p };
    }

    // ───────────────────────── one round ─────────────────────────
    async function playRound(n, gameId, plan) {
      const game = GAMES[gameId];
      ev(`══════ round ${n}: ${gameId} ══════`);
      const roundPhones = phones.filter((p) => !kicked.has(p.id));
      for (const p of roundPhones) {
        p.hudFinal = 0;
        p.curRound = null;
      }
      const startTrans = obs.trans.length;
      // start
      let dt = null;
      if (plan.start === 'remote') {
        dt = await doubleTapBig(`start ${gameId}`, 'next');
        const seq = dt.after.map((x) => x.split('+')[0]);
        const started = seq.includes('intro');
        const cancelled = started && seq.indexOf('lobby', seq.indexOf('intro')) > 0;
        check(started && !cancelled, `round ${n}: remote double-tap "next" starts ${gameId} exactly once (no cancel, no second action)`, dt);
        if (dt.sheet) issue('polish', 'remote', `double-tap on "next" opened a confirm sheet on the second tap (${dt.sheet})`, dt);
      }
      // the 'before' cutscene (ninja): skipped with the TV's own keyboard (S) while the remote is attached
      if (plan.beforeCut) {
        const fired = obs.trans.slice(startTrans).filter((t) => t.cut === plan.beforeCut);
        check(fired.length > 0, `round ${n}: automatic "before" cutscene ${plan.beforeCut} fires`, dt && dt.after);
        // the placeholder of a missing video lasts 4 s: a cutscene that is over inside the double-tap window was skipped by the second tap
        const firstCut = obs.trans.slice(startTrans).find((t) => t.cut === plan.beforeCut);
        const endCut = firstCut ? obs.trans.slice(startTrans).find((t) => t.t > firstCut.t && t.cut === null) : null;
        const lasted = firstCut && endCut ? endCut.t - firstCut.t : null;
        if (lasted !== null && lasted < 3000) issue('major', 'remote', `double-tap on "next" skipped the automatic "${plan.beforeCut}" video (it lasted ${lasted} ms; placeholder is 4000 ms)`, { lasted, dt });
        check(lasted === null || lasted >= 3000, `round ${n}: the double-tap on "next" does not skip the "${plan.beforeCut}" video`, { lastedMs: lasted, flashes: dt && dt.flashes });
        if (S().cutscene && S().cutscene.id === plan.beforeCut) {
          await sleep(800);
          await shot(`r${n}-before-cut`, [TV, phones[0]]);
          await tv.bringToFront().catch(() => undefined);
          await tv.keyboard.press('KeyS');
          const skipped = await waitObs((s) => s.cutscene === null, 4000, 'S skips').then(() => true).catch(() => false);
          check(skipped, `round ${n}: TV keyboard S skips the cutscene while the remote is attached`);
          if (!skipped) await waitObs((s) => s.cutscene === null, 20000, 'cutscene end');
        } else ev('before cutscene already over: S on the TV not exercised this run');
      }
      await waitObs((s) => ['intro', 'countdown', 'playing'].includes(s.phase) && s.round && s.round.gameId === gameId, 15000, 'intro');
      const round = S().round;
      for (const p of roundPhones) p.curRound = round.index;
      ev(`intro ${gameId} round index ${round.index}`);
      await sleep(1500);
      const introPhones = await Promise.all(roundPhones.map((p) => screenOf(p)));
      check(introPhones.every((s) => s === 'intro'), `round ${n}: every phone shows the intro`, introPhones);
      await shot(`r${n}-intro`, [TV, R, phones[0]]);
      await waitObs((s) => s.phase === 'countdown', 35000, 'countdown'); // the 27 s how-to first
      await sleep(1200);
      await shot(`r${n}-countdown`, [TV, phones[0], phones[2]]);
      await waitObs((s) => s.phase === 'playing', 10000, 'playing');
      const duration = S().round.endAt - S().round.startAt;
      ev(`playing, duration ${duration}`);
      await waitFor(async () => (await Promise.all(roundPhones.map((p) => screenOf(p)))).filter((s) => s === 'playing').length >= roundPhones.length - 1, 10000, 'phones playing').catch(() => null);

      // drivers
      const lateHere = late.filter((p) => p.playsFrom !== undefined && p.playsFrom <= n);
      const players = [...roundPhones, ...lateHere];
      for (const p of players) {
        p.hudFinal = 0;
        p.curRound = round.index;
      }
      if (gameId === 'tap') drivers = players.map((p, k) => tapDriver(p, [40, 70, 110, 150, 60, 90, 130, 200, 80, 100][k % 10]));
      else if (gameId === 'icy') drivers = players.map((p, k) => icyDriver(p, [700, 1000, 850, 550, 900, 650, 800, 750, 950, 600][k % 10]));
      else if (gameId === 'flappy') {
        const gives = plan.giveUps;
        drivers = players.map((p, k) => flappyDriver(p, 0.85, gives[k % gives.length]));
        ev('flappy give-up times (round ms)', players.map((p, k) => `${p.label}:${gives[k % gives.length]}`).join(' '));
      } else if (gameId === 'ninja') drivers = players.map((p, k) => ninjaDriver(p, [260, 420, 120, 60, 200, 300, 150, 90, 240, 180][k % 10]));
      else if (gameId === 'plotzel') drivers = players.map((p, k) => plotzelDriver(p, [60, 140, 220, 320, 100, 180, 260, 80, 160, 120][k % 10]));
      // the phones' own score, polled fast (the HUD at the end of an early-ended round is the phone's last word)
      const poll = { on: true };
      const pollers = players.map(async (p) => {
        p.stageMax = 0;
        while (poll.on) {
          const v = await p.page.evaluate(() => (window.__playerPlay ? { r: window.__playerPlay.round, s: window.__playerPlay.stageScore } : null)).catch(() => null);
          if (v && v.r === round.index && typeof v.s === 'number') p.stageMax = Math.max(p.stageMax, v.s);
          await sleep(150);
        }
      });

      // chaos during the round
      const chaosOut = {};
      try {
        if (plan.during) await plan.during(chaosOut, { round, duration, players });
      } catch (e) {
        issue('minor', 'test', `round ${n}: a chaos step failed: ${e.message}`, String(e.stack || '').slice(0, 300));
      }
      await shot(`r${n}-late-play`, [TV, R, phones[0], phones[3]]);

      // results
      const resultsAt = await waitObs((s) => s.phase === 'results', duration + 90000, 'results').then(() => Date.now());
      const st = S();
      const res = st.results;
      ev(`results of round ${n}: revealAt in ${res.revealAt - Date.now()} ms; winner ${res.winnerIds.map((id) => (st.players.find((p) => p.id === id) || {}).name).join(',')}`);
      // spoiler watch (no phone shows a result before revealAt)
      const spoiled = [];
      const watch = { on: true };
      const watcher = (async () => {
        while (watch.on) {
          await Promise.all(
            [...roundPhones, ...late].map(async (p) => {
              const i = await pinfo(p).catch(() => null);
              const ra = S().results ? S().results.revealAt : res.revealAt;
              if (i && ['win', 'reveal', 'results'].includes(i.screen) && i.now < ra) spoiled.push(`${p.label}:${i.screen}@${Math.round(i.now - ra)}`);
            }),
          );
          await sleep(80);
        }
      })();
      // the phone's own last word, read before the drivers stop
      const endedNow = await Promise.all(players.map((p) => pinfo(p).catch(() => null)));
      players.forEach((p, k) => (p.atEnd = endedNow[k]));
      poll.on = false;
      await sleep(400);
      await stopDrivers(drivers);
      drivers = [];
      await Promise.race([Promise.all(pollers), sleep(3000)]);
      const winnerId = res.winnerIds[0];
      const winnerPhone = [...phones, ...late].find((p) => p.id === winnerId);
      const others = [...roundPhones, ...late].filter((p) => p.id !== winnerId && !p.gone);
      // the reveal is measured WHILE the results chaos runs (a cutscene in the suspense moves revealAt)
      const stamp = async (fn, ms) => {
        try {
          await waitFor(fn, ms, 'reveal', 40);
          return Date.now();
        } catch {
          return null;
        }
      };
      const revealP = (async () => {
        await waitFor(() => S().results && S().cutscene === null && Date.now() > S().results.revealAt - 3000, 60000, 'late suspense', 50);
        const sus = await tv.locator('.sh-cer-name').count().catch(() => -1);
        check(sus === 0, `round ${n}: TV keeps the winner hidden in the suspense`, { cerNames: sus, revealInMs: S().results.revealAt - Date.now() });
        shot(`r${n}-suspense`, [TV, phones[0], phones[4]]).catch(() => undefined);
        return Promise.all([
          stamp(async () => (await tv.locator('.sh-cer-name').count()) > 0, 20000),
          winnerPhone ? stamp(async () => (await screenOf(winnerPhone)) === 'win', 20000) : Promise.resolve(undefined),
          ...others.map((p) => stamp(async () => ['reveal', 'results'].includes(await screenOf(p)), 20000)),
        ]);
      })();
      try {
        if (plan.results) await plan.results(chaosOut, { res });
      } catch (e) {
        issue('minor', 'test', `round ${n}: a results chaos step failed: ${e.message}`, String(e.stack || '').slice(0, 300));
      }
      const [tTv, tWin, ...tOthers] = await revealP;
      const res2 = S().results;
      const winnerRow = res2.rows.find((x) => x.playerId === winnerId);
      check(res2.winnerIds[0] === winnerId, `round ${n}: the winner did not change during the results`, { before: winnerId, after: res2.winnerIds });
      watch.on = false;
      await watcher;
      const ra = S().results.revealAt;
      const relTv = tTv === null ? null : tTv - ra;
      const relWin = tWin === undefined ? undefined : tWin === null ? null : tWin - ra;
      const relOthers = tOthers.map((t) => (t === null ? null : t - ra));
      check(spoiled.length === 0, `round ${n}: no phone shows a result before revealAt`, spoiled.slice(0, 8));
      check(relTv !== null && relTv >= -50 && relTv < 1800, `round ${n}: TV reveals the winner at revealAt (+${relTv} ms)`);
      if (winnerPhone) check(relWin !== null && relWin >= -50 && relWin < 1800 && Math.abs(relWin - (relTv || 0)) < 800, `round ${n}: winner's phone (${winnerPhone.label}) shows WIN on the TV's beat (TV +${relTv}, phone +${relWin})`);
      const lateOthers = relOthers.map((x, k) => [others[k].label, x]).filter(([, x]) => x === null || x < -50 || x > 2500);
      check(lateOthers.length === 0, `round ${n}: every other phone shows who won within the beat`, { lateOthers, all: relOthers });
      await sleep(1400);
      await shot(`r${n}-ceremony`, [TV, winnerPhone || phones[1], others[0]]);
      const tvName = await tv.textContent('.sh-cer-name', { timeout: 2000 }).catch(() => '');
      check(winnerRow && tvName.includes(winnerRow.name), `round ${n}: TV ceremony names the round winner "${winnerRow && winnerRow.name}"`, { tvName });
      // a round has no prize (the angel is given at the podium): the ceremony shows the round medal
      const medal = await tv.locator('.sh-cer-prize .sh-medal').count().catch(() => 0);
      const prize = await tv.locator('.sh-cer .sh-prize').count().catch(() => 1);
      check(medal > 0 && prize === 0, `round ${n}: TV ceremony shows the round medal and no prize`);
      const mus = await tv.evaluate(() => (window.__partyMusic ? { playing: window.__partyMusic.playing('victory'), started: window.__partyMusic.started.slice(-4) } : null)).catch(() => null);
      check(mus && mus.playing, `round ${n}: TV plays the victory song in the ceremony`, mus);
      if (winnerPhone) {
        const wt = await winnerPhone.page.textContent('.pp-win', { timeout: 2000 }).catch(() => '');
        check(wt.includes('זכית'), `round ${n}: ${winnerPhone.label} WIN screen`, wt.slice(0, 60));
        const wm = await winnerPhone.page.evaluate(() => (window.__partyMusic ? window.__partyMusic.playing('victory') : null)).catch(() => null);
        check(wm === true, `round ${n}: victory song on the winner's phone`, wm);
      }
      const revealTexts = await Promise.all(others.slice(0, 3).map((p) => p.page.textContent('.pp-reveal', { timeout: 1500 }).catch(() => null)));
      check(revealTexts.every((t) => t === null || t.includes(winnerRow.name)), `round ${n}: other phones name the winner`, revealTexts.map((t) => (t || '').slice(0, 50)));
      try {
        if (plan.afterReveal) await plan.afterReveal(chaosOut, { res: res2 });
      } catch (e) {
        issue('minor', 'test', `round ${n}: an after-reveal step failed: ${e.message}`, String(e.stack || '').slice(0, 300));
      }

      // scoring
      const players2 = S().players;
      const joinOrder = new Map(players2.map((p, k) => [p.id, k]));
      const expect = computeRoundScores(
        res2.rows.map((x) => ({ id: x.playerId, raw: x.raw, reachedAt: x.reachedAt, joinOrder: joinOrder.get(x.playerId) ?? 1e9, totalBefore: totals.get(x.playerId) || 0 })),
        { lastStanding: game.mode === 'elimination' },
      );
      const byRound = [...res2.rows].sort((a, b) => a.roundRank - b.roundRank);
      const scorers = byRound.filter((x) => x.raw > 0);
      check(res2.winnerIds.length === 1 && scorers[0] && res2.winnerIds[0] === scorers[0].playerId, `round ${n}: exactly one winner, the first scorer`, res2.winnerIds);
      check(res2.rows.every((x, k) => x.rank === k + 1) && byRound.every((x, k) => x.roundRank === k + 1), `round ${n}: strict ranks 1..n`);
      const bad = [];
      for (const row of res2.rows) {
        const e = expect.get(row.playerId);
        const want = (totals.get(row.playerId) || 0) + (e ? e.points : 0);
        if (!e || e.points !== row.points || e.roundRank !== row.roundRank || row.total !== want) bad.push({ name: row.name, raw: row.raw, points: row.points, want: e && e.points, total: row.total, wantTotal: want });
        totals.set(row.playerId, row.total);
      }
      check(bad.length === 0, `round ${n}: points and totals = shared/scoring.ts on the raw scores`, bad.slice(0, 6));
      const totalsNZ = res2.rows.map((x) => x.total).filter((t) => t > 0);
      check(new Set(totalsNZ).size === totalsNZ.length, `round ${n}: no two players on the same total`);
      // every phone that played scored > 0, the server row = the phone's own final
      const perPhone = [];
      for (const p of players) {
        const row = res2.rows.find((x) => x.playerId === p.id);
        const i = p.atEnd && p.atEnd.endedRound === res2.roundIndex ? p.atEnd : await pinfo(p).catch(() => null);
        const ended = !!i && i.endedRound === res2.roundIndex;
        const own = ended ? i.endedScore : Math.max(p.stageMax || 0, p.hudFinal || 0);
        perPhone.push({ label: p.label, raw: row ? row.raw : null, own, ended, stageMax: p.stageMax, hudMax: p.hudFinal, chaos: [...new Set(windows.filter((w) => w.label === p.label && w.from >= T0).map((w) => w.kind))] });
      }
      for (const x of perPhone) {
        check(x.raw > 0, `round ${n}: ${x.label} scored (raw ${x.raw})`);
        const elimLast = game.mode === 'elimination' && players.find((p) => p.label === x.label).id === winnerId && !x.ended;
        if (elimLast) check(x.raw > 0 && x.raw <= x.own + 10 && res2.rows.every((row) => row.playerId === winnerId || row.raw < x.raw), `round ${n}: ${x.label}, last one standing, is above every final`, x);
        else check(x.raw === x.own, `round ${n}: ${x.label}: server raw = the phone's final score`, x);
      }
      const out = { n, gameId, roundIndex: res2.roundIndex, winner: winnerRow && winnerRow.name, winnerIsPhone: !!winnerPhone, rel: { tv: relTv, win: relWin, others: relOthers }, perPhone, chaos: chaosOut, endedEarlyAt: null };
      roundsOut.push(out);
      // after the ceremony: the standings
      await waitFor(() => r.evaluate(() => {
        const m = window.__remote.model();
        const c = m && m.actions.find((a) => a.id === 'continue' || a.id === 'podium');
        return m && m.phase === 'results' && c && c.confirm === undefined;
      }), 40000, 'ceremony over').catch(() => issue('minor', 'tv', `round ${n}: the ceremony never reported done to the remote`));
      await sleep(1500);
      await shot(`r${n}-standings`, [TV, R, phones[0], phones[2]]);
      return out;
    }

    async function toLobby(n, how) {
      const before = obs.trans.length;
      if (how === 'tvkey') {
        await tv.bringToFront().catch(() => undefined);
        ev('TV keyboard Space (remote attached)');
        await tv.keyboard.press('Space');
        await tv.keyboard.press('Space'); // a second press right after must not skip the lobby
        const ok = await waitObs((s) => s.phase === 'lobby', 6000, 'lobby by key').then(() => true).catch(() => false);
        await sleep(2000);
        check(ok, `after round ${n}: TV Space continues to the lobby with the remote attached`);
        check(S().phase === 'lobby', `after round ${n}: Space-Space on the TV does not start the next game`, obs.trans.slice(before).map((t) => t.phase));
        const rm = await r.evaluate(() => document.querySelector('[data-testid=main]').dataset.phase).catch(() => null);
        check(rm === 'lobby', `after round ${n}: the remote follows the TV's key press (phase ${rm})`);
      } else {
        const dt = await doubleTapBig(`continue after round ${n}`, 'continue', n === 3 ? 320 : 140);
        const went = dt.after.map((x) => x.split('+')[0]);
        const skipped = went.includes('intro') || ['intro', 'countdown', 'playing'].includes(S().phase);
        check(went[0] === 'lobby' && !skipped, `after round ${n}: remote double-tap "continue" goes to the lobby once (does not also start the next game)`, dt);
        if (skipped) {
          issue('major', 'remote', `double-tap on "continue" after round ${n} also STARTED the next game (lobby skipped)`, dt);
          return 'started';
        }
      }
      await sleep(1500);
      await shot(`lobby-after-r${n}`, [TV, R, phones[0]]);
      return 'lobby';
    }

    // ═════════════ ROUND 1: tap ═════════════
    let lateCodePhone = null;
    const r1 = await playRound(1, 'tap', {
      start: 'remote',
      async during(out, { duration, players }) {
        // the automatic tap_freeze cutscene (8 s of 53, scaled)
        const cutAt = Math.round((8000 * duration) / GAMES.tap.durationMs);
        const sawCut = await waitObs((s) => s.cutscene && s.cutscene.id === 'tap_freeze', 15000, 'tap_freeze').then(() => true).catch(() => false);
        check(sawCut, `round 1: automatic cutscene tap_freeze fires (~${cutAt} ms)`);
        if (sawCut) {
          await sleep(1200);
          await shot('r1-tap-freeze', [TV, phones[0], phones[5]]);
          const frozen = await Promise.all(players.map((p) => pinfo(p).then((i) => (i ? `${i.screen}:${i.frozen}:${i.cutscene}` : '?')).catch(() => '?')));
          check(frozen.every((x) => /:true:true$/.test(x) || x.startsWith('late')), 'round 1: every phone frozen with "watch the TV" during the cutscene', frozen);
          await waitObs((s) => s.cutscene === null, 20000, 'tap_freeze ends');
        }
        // late joiner #1 types the room code mid-round
        await waitElapsed(Math.min(7000, duration * 0.3), 'late joiner 1');
        lateCodePhone = await joinPhone({ label: 'late-code', device: 'Galaxy S9+', name: 'מאוחר', dress: false }, true);
        lateCodePhone.playsFrom = 2;
        late.push(lateCodePhone);
        const ls = await screenOf(lateCodePhone);
        check(ls === 'late', 'late joiner (typed the code) mid-round sees the "late, next round" screen', ls);
        await shot('r1-late-joiner', [lateCodePhone]);
        // a phone reload mid-round
        await waitElapsed(Math.min(11000, duration * 0.42), 'reload');
        const s8 = phones[4];
        const before = await pinfo(s8);
        out.reload = await phoneReload(s8, 'mid-round');
        const after = await pinfo(s8);
        check(after.screen === 'playing' && after.playRound === before.playRound, 's8: back in the same round after a mid-round reload', { before: [before.screen, before.score], after: [after.screen, after.score] });
        out.reloadScoreBefore = before.score;
        // kick one bot (the live leader if a bot leads), from the remote
        await waitElapsed(Math.min(15000, duration * 0.55), 'kick');
        const live = obs.lastScores ? obs.lastScores.scores : [];
        const pl = S().players;
        const botIds = new Set(pl.filter((p) => p.name.startsWith('בוט')).map((p) => p.id));
        const target = live.find(([id]) => botIds.has(id)) || [pl.find((p) => botIds.has(p.id)).id, 0];
        const victim = pl.find((p) => p.id === target[0]);
        ev('kick', victim.name, 'live score', target[1], 'live place', live.findIndex(([id]) => id === victim.id) + 1);
        await remoteKick(victim.name);
        const gone = await waitObs((s) => !s.players.some((p) => p.id === victim.id), 6000, 'kicked').then(() => true).catch(() => false);
        check(gone, `remote kicks bot ${victim.name} mid-round`);
        kicked.add(victim.id);
        totals.delete(victim.id);
        out.kicked = { name: victim.name, liveScore: target[1] };
        // a hidden tab across the round end (Android-style: visibility hidden, no animation frames)
        const i13 = phones[5];
        await waitFor(() => {
          const s = S();
          return s.phase !== 'playing' || (s.round && roundTime(s.round, Date.now()).leftMs <= 6000);
        }, 60000, 'hide time');
        out.hidden = { label: i13.label, before: await pinfo(i13) };
        out.hiddenWin = await hideTab(i13);
      },
      async results(out) {
        // the TV reloaded in the suspense
        await sleep(2200);
        await tvReload('during the suspense');
        await shot('r1-tv-reloaded-suspense', [TV]);
        // the hidden phone comes back in the suspense
        await sleep(1500);
        const i13 = phones[5];
        await showTab(i13, out.hiddenWin);
        await sleep(600);
        const i = await pinfo(i13);
        check(['suspense', 'sending'].includes(i.screen), 'i13: back from a hidden tab across the round end, on the suspense screen', i.screen);
        out.hidden.after = i;
      },
    });
    check(!S().players.some((p) => kicked.has(p.id)) && !S().results.rows.some((x) => kicked.has(x.playerId)), 'round 1: the kicked bot is in no row of the results');
    const after1 = await toLobby(1, 'tvkey');

    // ═════════════ ROUND 2: icy ═════════════
    let lateLinkPhone = null;
    await playRound(2, 'icy', {
      start: after1 === 'started' ? 'none' : 'remote',
      async during(out, { duration }) {
        await waitElapsed(2500, 'late 2');
        lateLinkPhone = await joinPhone({ label: 'late-link', device: 'iPhone XR', name: 'רון', dress: false }, false);
        lateLinkPhone.playsFrom = 3;
        late.push(lateLinkPhone);
        check((await screenOf(lateLinkPhone)) === 'late', 'late joiner (link) mid-round sees the "late" screen');
        await waitElapsed(4000, 'offline');
        const px7b = phones[6];
        const offlineP = phoneOffline(px7b, 15000);
        await waitElapsed(8000, 'joker_1');
        const leftBefore = roundTime(S().round, Date.now()).leftMs;
        await remoteCutscene('joker_1');
        await sleep(1500);
        await shot('r2-joker1', [TV, R, phones[0], phones[3]]);
        const fr = await Promise.all(phones.slice(0, 4).map((p) => pinfo(p).then((i) => `${p.label}:${i.screen}:${i.frozen}:${i.cutscene}`)));
        check(fr.every((x) => /:true:true$/.test(x)), 'round 2: manual cutscene from the remote freezes the phones', fr);
        await waitObs((s) => s.cutscene === null, 30000, 'joker_1 ends');
        const frozenSt = obs.states.find((x) => x.st.cutscene && x.st.cutscene.id === 'joker_1' && x.st.round && x.st.round.frozenAt !== null);
        const rr = S().round;
        const leftAtFreeze = frozenSt ? frozenSt.st.round.endAt - frozenSt.st.round.frozenAt : null;
        const leftAtResume = rr.resumeAt !== null ? rr.endAt - rr.resumeAt : null;
        check(leftAtFreeze !== null && leftAtFreeze === leftAtResume, 'round 2: the round continues with exactly the time left it froze at (manual cutscene)', { leftBefore, leftAtFreeze, leftAtResume });
        out.offline = await offlineP;
        if (!(await waitElapsed(16500, 'tv reload'))) return;
        await tvReload('mid-round');
        await shot('r2-tv-reloaded', [TV]);
        if (!(await waitElapsed(Math.min(22000, duration - 3000), 'end early'))) return;
        const left = roundTime(S().round, Date.now()).leftMs;
        ev('remote ends the round early with', left, 'ms left');
        await remoteEndRound();
        const ended = await waitObs((s) => s.phase === 'results', 8000, 'ended early').then(() => true).catch(() => false);
        check(ended, `round 2: remote "end round now" (confirmed) ends icy early with ${left} ms left`);
        out.endedEarlyLeftMs = left;
      },
      async results() {
        await sleep(2500);
        await phoneReload(phones[1], 'during the suspense');
        const i = await pinfo(phones[1]);
        check(['suspense', 'sending'].includes(i.screen), 'i14 reloaded in the suspense: back on the suspense screen (no spoiler)', i.screen);
      },
    });
    const after2 = await toLobby(2, 'remote');

    // the TV keyboard while the remote is attached: M twice
    await tv.bringToFront().catch(() => undefined);
    await tv.keyboard.press('KeyM');
    await sleep(700);
    const m1 = await tv.evaluate(() => window.__host.model().actions.find((a) => a.id === 'mute').on);
    await tv.keyboard.press('KeyM');
    await sleep(700);
    const m2 = await tv.evaluate(() => window.__host.model().actions.find((a) => a.id === 'mute').on);
    const rm2 = await r.evaluate(() => (window.__remote.model().actions.find((a) => a.id === 'mute') || {}).on).catch(() => null);
    check(m1 === true && m2 === false && rm2 === false, 'TV keyboard M mutes and unmutes with the remote attached; the remote follows', { m1, m2, remote: rm2 });

    // ═════════════ ROUND 3: flappy ═════════════
    await playRound(3, 'flappy', {
      start: after2 === 'started' ? 'none' : 'remote',
      giveUps: [4500, 6500, 8000, 9500, 11000, 12500, 14000, 15500, 17000, 1e9],
      async during(out, { duration }) {
        const t0 = Date.now();
        const act = [];
        let remoteSeen = false;
        while (S().phase === 'playing') {
          const m = obs.lastScores;
          if (m && m.round === S().round.index) act.push([Date.now() - t0, m.active]);
          if (!remoteSeen && curElapsed() > 7000) {
            remoteSeen = true;
            out.remoteLive = await r.evaluate(() => Array.from(document.querySelectorAll('[data-testid=top5-row]')).map((e) => e.textContent.trim())).catch(() => null);
            ev('remote live top five in flappy', out.remoteLive);
            await shot('r3-remote-live', [R, TV]);
          }
          await sleep(500);
        }
        out.active = act;
      },
      async results(out, { res }) {
        // round end: one left (or nobody), before the 28 s cap
        const flRound = obs.states.filter((x) => x.st.round && x.st.round.gameId === 'flappy').slice(-1)[0].st.round;
        const resState = obs.states.find((x) => x.st.phase === 'results' && x.st.results && x.st.results.roundIndex === res.roundIndex).st;
        const endedEarly = resState.serverNow < flRound.endAt;
        const lastMsg = obs.scores.filter((x) => x.round === res.roundIndex).slice(-1)[0];
        check(endedEarly && lastMsg && lastMsg.active <= 1, 'round 3: flappy ends with one person left, before the hard cap', { endedBeforeCapMs: flRound.endAt - resState.serverNow, lastActive: lastMsg && lastMsg.active, activeTimeline: (out.active || []).filter((_, k) => k % 2 === 0).map((a) => a[1]).join(',') });
        // a manual cutscene in the suspense pushes the reveal back
        await sleep(1800);
        const ra0 = S().results.revealAt;
        await remoteCutscene('joker_2');
        await sleep(1200);
        await shot('r3-joker2-suspense', [TV, phones[0], phones[2]]);
        await waitObs((s) => s.cutscene === null, 30000, 'joker_2 ends');
        const ra1 = S().results.revealAt;
        check(ra1 > ra0 + 1000, 'round 3: a cutscene in the suspense pushes revealAt back by its length', { pushedMs: ra1 - ra0 });
        out.revealPushedMs = ra1 - ra0;
      },
      async afterReveal(out) {
        // places, not distances: on the phones and the TV
        await waitFor(() => Date.now() > S().results.revealAt + 7000, 30000, 'personal results');
        const rows = S().results.rows;
        const rawStrs = rows.filter((x) => x.raw >= 100).map((x) => [String(x.raw), x.raw.toLocaleString('he-IL'), x.raw.toLocaleString('en-US')]);
        const phoneTexts = await Promise.all(phones.slice(0, 4).map((p) => p.page.evaluate(() => document.body.innerText).catch(() => '')));
        const phoneShows = phoneTexts.map((t, k) => [phones[k].label, rawStrs.filter((ss) => ss.some((x) => t.includes(x))).map((ss) => ss[0]).slice(0, 3)]).filter(([, v]) => v.length > 0);
        check(phoneShows.length === 0, 'round 3: phones show places, not flappy distances', phoneShows);
        await shot('r3-phone-results', [phones[0], phones[1], phones[2]]);
        const tvVisible = await tv.evaluate(() => document.body.innerText).catch(() => '');
        const tvShows = rawStrs.filter((ss) => ss.some((x) => tvVisible.includes(x))).map((ss) => ss[0]);
        check(tvShows.length === 0, 'round 3: TV shows places, not flappy distances', tvShows.slice(0, 5));
        const remoteText = await r.evaluate(() => document.body.innerText).catch(() => '');
        out.remoteText = remoteText.slice(0, 300);
      },
      async _remoteLive() {},
    });
    const after3 = await toLobby(3, 'remote');

    // ═════════════ ROUND 4: plotzel ═════════════
    await playRound(4, 'plotzel', {
      start: after3 === 'started' ? 'none' : 'remote',
      async during(out) {
        await waitElapsed(6000, 'rotate');
        out.rotate = await rotate(phones[2], 3500);
        if (!(await waitElapsed(12000, 'reload 2'))) return;
        await phoneReload(phones[7], 'mid-round (plotzel)');
        // the remote's live list during plotzel
        out.remoteTop = await r.evaluate(() => Array.from(document.querySelectorAll('[data-testid=top5-row]')).map((e) => e.textContent.trim())).catch(() => null);
      },
      async results() {
        await waitFor(() => Date.now() > S().results.revealAt + 1500, 30000, 'after the reveal');
        await phoneReload(phones[3], 'right after the reveal');
        const i = await pinfo(phones[3]);
        check(['results', 'reveal', 'win'].includes(i.screen), 'px7 reloaded after the reveal: lands on its result', i.screen);
      },
    });
    const after4 = await toLobby(4, 'remote');

    // ═════════════ ROUND 5: ninja ═════════════
    await playRound(5, 'ninja', {
      start: after4 === 'started' ? 'none' : 'remote',
      beforeCut: 'before_ninja',
      async during() {},
    });

    // ═════════════ the podium ═════════════
    ev('══════ podium ══════');
    check(GAME_IDS.every((g) => S().played.includes(g)), 'all five games played', S().played);
    const podT = obs.trans.length;
    const dt = await doubleTapBig('podium', 'podium');
    const cutOk = await waitObs((s) => s.phase === 'final', 8000, 'final').then(() => true).catch(() => false);
    check(cutOk && !dt.after.some((x) => x.startsWith('lobby')), 'remote double-tap: the podium, once', dt);
    const pc = obs.trans.slice(podT).find((t) => t.cut === 'before_podium');
    const pe = pc ? obs.trans.slice(podT).find((t) => t.t > pc.t && t.cut === null) : null;
    const podLasted = pc && pe ? pe.t - pc.t : null;
    check(pc !== undefined, "the 'final' cutscene before_podium fires", dt.after);
    check(podLasted === null || podLasted >= 3000, 'the double-tap on "podium" does not skip the before_podium video', { lastedMs: podLasted, flashes: dt.flashes });
    if (podLasted !== null && podLasted < 3000) issue('major', 'remote', `double-tap on "podium" skipped the before_podium video (it lasted ${podLasted} ms)`, dt);
    if (S().cutscene) {
      check(S().cutscene.id === 'before_podium', "the 'final' cutscene plays before the podium");
      await sleep(1500);
      await shot('final-cutscene', [TV, phones[0], R]);
      await waitObs((s) => s.cutscene === null, 30000, 'podium cutscene ends');
    }
    await sleep(3000);
    await shot('final-1', [TV, R]);
    await sleep(6000);
    await shot('final-2', [TV, phones[0], phones[2], phones[4]]);
    await sleep(6000);
    await shot('final-3', [TV, phones[1], late[0]]);
    const end = S();
    const ranks = [...end.players].sort((a, b) => a.rank - b.rank);
    const champ = ranks[0];
    const finalText = await tv.textContent('[data-testid=final]').catch(() => '');
    check(finalText.includes(champ.name), `podium names the champion ${champ.name}`, { champ: champ.name });
    check(ranks.slice(0, 3).every((p) => finalText.includes(p.name)), 'podium names the top three', ranks.slice(0, 3).map((p) => `${p.rank}.${p.name} ${p.total}`));
    const mine = [...totals].filter(([id]) => end.players.some((p) => p.id === id));
    const badTot = mine.filter(([id, t]) => end.players.find((p) => p.id === id).total !== t);
    check(badTot.length === 0, 'final totals = the sum of every round of shared/scoring.ts', badTot.slice(0, 5));
    check(ranks.every((p, k) => p.rank === k + 1) && ranks.every((p, k) => k === 0 || p.total <= ranks[k - 1].total), 'final ranks 1..n, following the totals');
    for (const p of [...phones, ...late]) {
      const place = await p.page.textContent('.pp-final-place').catch(() => null);
      const want = end.players.find((x) => x.id === p.id);
      if (want) check(place !== null && place.includes(String(want.rank)), `${p.label}: podium phone shows its own place ${want.rank}`, place && place.slice(0, 40));
    }
    const finalMusic = await tv.evaluate(() => (window.__partyMusic ? { final: window.__partyMusic.playing('final'), started: window.__partyMusic.started.slice(-3) } : null)).catch(() => null);
    check(finalMusic && finalMusic.final, "TV plays the champion's song on the podium", finalMusic);

    // side check: the emoji guest's name when this phone opens another room (loadLastName)
    const pmPage = phones[2].page;
    await pmPage.goto(BASE + '/?room=QQQQ');
    const pre = await pmPage.waitForSelector('.pp-name-input', { timeout: 15000 }).then(() => pmPage.inputValue('.pp-name-input')).catch(() => null);
    check(pre === EMOJI_NAME, 'the emoji guest opening another room gets the whole name prefilled', { prefilled: pre, codeUnits: pre && pre.length, graphemes: pre && graphemes(pre).length, loneSurrogate: pre ? /[\ud800-\udbff](?![\udc00-\udfff])|(?:[^\ud800-\udbff]|^)[\udc00-\udfff]/.test(pre) : null });
  } catch (err) {
    issue('blocker?', 'run', 'the run stopped: ' + (err && err.message), String(err && err.stack).slice(0, 600));
    await shot('ERROR', pages).catch(() => undefined);
  } finally {
    await stopDrivers(drivers).catch(() => undefined);
    sampling = false;
    await sampleLoop.p;
    if (bots) {
      try {
        process.kill(-bots.pid);
      } catch {
        // gone
      }
    }
    if (obsSock) obsSock.disconnect();
    // summaries
    const grp = (arr, keyf) => {
      const m = new Map();
      for (const x of arr) {
        const k = keyf(x);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(x);
      }
      return [...m].map(([k, v]) => ({ k, n: v.length, first: v[0].t, last: v[v.length - 1].t, ex: v.slice(0, 3) }));
    };
    const report = {
      code,
      sampleTicks: sampleN,
      checks,
      failed: checks.filter((c) => !c.ok),
      issues,
      rounds: roundsOut,
      errors,
      mismatches: grp(mism, (x) => `${x.label}|${x.kind}|${x.win.join('+') || 'none'}`),
      scrolls: grp(scrolls, (x) => `${x.label}|${x.screen}|${x.win.join('+') || 'none'}`),
      clockOffsets: grp(clockOff, (x) => `${x.label}|${x.win.join('+') || 'none'}`),
      remoteClock: grp(remoteClock, (x) => (x.win.join('+') || 'none')),
      windows: windows.map((w) => ({ ...w, from: hhmm(w.from), to: w.to === Infinity ? null : hhmm(w.to) })),
      trans: obs.trans.map((t) => ({ t: hhmm(t.t), phase: t.phase, cut: t.cut })),
    };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    fs.writeFileSync(path.join(OUT, 'mismatches.json'), JSON.stringify(mism, null, 1));
    fs.writeFileSync(path.join(OUT, 'timeline.log'), timeline.join('\n') + '\n');
    console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks ok, ${issues.length} issues, ${errors.length} console/page errors, ${mism.length} mismatch samples, ${scrolls.length} scroll samples`);
    for (const c of checks.filter((c) => !c.ok)) console.log('  FAILED:', c.name, JSON.stringify(c.extra || '').slice(0, 300));
    await browser.close().catch(() => undefined);
    process.exit(0);
  }
})();
