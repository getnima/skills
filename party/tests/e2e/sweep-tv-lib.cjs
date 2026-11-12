// sweep-tv-lib: shared helpers of the sweep-tv-* scripts (the TV page through a whole evening).
//
// Everything runs from a TEMPORARY COPY of the tree (never the real client/public): the copy
// gets short test songs (sine tones, ffmpeg) for every music slot and a designed QR
// (assets/host/qr.png + qr.json) whose url is NOT this machine, then it is built, and the game
// server serves that build (the way party night runs: npm run build && npm start).
//
//   SWEEP_TREE=<dir>   where the copy lives (default: $TMPDIR/sweep-tv-tree)
//   SWEEP_REBUILD=1    make the copy again even when it exists
// Ports of this lane: server 8961, vite 5361 (vite only when a script asks for it).
// Outputs: tests/e2e/out/sweep-tv-/<script>/
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TREE = process.env.SWEEP_TREE || path.join(os.tmpdir(), 'sweep-tv-tree');
const SERVER_PORT = Number(process.env.SWEEP_SERVER_PORT || 8961);
const VITE_PORT = Number(process.env.SWEEP_VITE_PORT || 5361);
const SERVER = `http://localhost:${SERVER_PORT}`;
const PW = process.env.PARTY_REMOTE_PASSWORD || 'kioso3tbh';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** slot file → [Hz, seconds, codec args] */
const SONGS = {
  'lobby.mp3': [300, 30, ['-c:a', 'libmp3lame', '-b:a', '64k']],
  'tap.mp3': [440, 40, ['-c:a', 'libmp3lame', '-b:a', '64k']],
  'icy.mp3': [494, 40, ['-c:a', 'libmp3lame', '-b:a', '64k']],
  'flappy.mp3': [523, 40, ['-c:a', 'libmp3lame', '-b:a', '64k']],
  'plotzel.ogg': [587, 40, ['-c:a', 'libvorbis', '-q:a', '2']],
  'ninja.mp3': [659, 40, ['-c:a', 'libmp3lame', '-b:a', '64k']],
  'round.mp3': [220, 30, ['-c:a', 'libmp3lame', '-b:a', '64k']],
  'victory.mp3': [880, 20, ['-c:a', 'libmp3lame', '-b:a', '64k']],
  'final.ogg': [988, 30, ['-c:a', 'libvorbis', '-q:a', '2']],
};
const FOREIGN_QR_URL = 'https://34-77-1-2.sslip.io/j';

function outDir(name) {
  const dir = path.join(__dirname, 'out', 'sweep-tv-', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

/** The temporary copy of the tree with the test songs + designed QR, built. Returns its path. */
function prepareTree() {
  const built = fs.existsSync(path.join(TREE, 'dist/client/host.html'));
  if (built && process.env.SWEEP_REBUILD !== '1') return TREE;
  fs.rmSync(TREE, { recursive: true, force: true });
  fs.mkdirSync(TREE, { recursive: true });
  execFileSync('bash', [
    '-c',
    `tar --exclude=./node_modules --exclude=./dist --exclude=./tests/e2e/out --exclude=./.git --exclude='./tools/*/node_modules' -cf - . | (cd "${TREE}" && tar xf -)`,
  ], { cwd: ROOT });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TREE, 'node_modules'));
  fs.writeFileSync(path.join(TREE, 'COPIED_AT.txt'), stamp() + '\n');
  const audio = path.join(TREE, 'client/public/audio');
  for (const [file, [hz, sec, codec]] of Object.entries(SONGS)) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${sec}`, '-ac', '2', '-ar', '44100', ...codec, path.join(audio, file)]);
  }
  writeDesignedQr(path.join(TREE, 'client/public/assets/host'), FOREIGN_QR_URL);
  execFileSync('npm', ['run', 'build'], { cwd: TREE, stdio: 'ignore' });
  return TREE;
}

/** qr.png encoding `url` (plain qrcode, no design) and qr.json naming `jsonUrl` (default: the same). */
function writeDesignedQr(dir, url, jsonUrl = url) {
  const QR = require(path.join(ROOT, 'node_modules/qrcode'));
  const png = path.join(dir, 'qr.png');
  // toFile is async; the sync path: a data URL → buffer
  return new Promise((resolve, reject) => {
    QR.toBuffer(url, { width: 900, margin: 4 }, (err, buf) => {
      if (err) return reject(err);
      fs.writeFileSync(png, buf);
      fs.writeFileSync(path.join(dir, 'qr.json'), JSON.stringify({ url: jsonUrl }) + '\n');
      resolve();
    });
  });
}

const procs = [];
function spawnProc(cmd, args, opts) {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  const keep = (d) => {
    log += d;
    if (log.length > 400_000) log = log.slice(-200_000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const p = {
    child,
    log: () => log,
    stop() {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // gone
      }
    },
  };
  procs.push(p);
  return p;
}
function stopAll() {
  for (const p of procs) p.stop();
}
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopAll();
    process.exit(130);
  });
}

async function waitHttp(url, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {
      // not yet
    }
    await sleep(300);
  }
  throw new Error('not up: ' + url);
}

/** The game server of the temp tree, serving its build. `env`: PARTY_TEST_* switches. */
async function startServer(env = {}) {
  const tree = prepareTree();
  const p = spawnProc('npx', ['tsx', 'server/index.ts'], { cwd: tree, env: { PORT: String(SERVER_PORT), ...env } });
  await waitHttp(`${SERVER}/healthz`);
  return p;
}

/** vite (HMR off) over the temp tree, proxying to the game server. */
async function startVite() {
  const tree = prepareTree();
  const cfg = path.join(tree, 'tests/e2e/sweep-tv-vite.config.mjs');
  fs.writeFileSync(
    cfg,
    "import base from '../../vite.config.ts';\nexport default { ...base, server: { ...base.server, hmr: false, allowedHosts: true } };\n",
  );
  const p = spawnProc('npx', ['vite', '--config', cfg], { cwd: tree, env: { PARTY_SERVER_PORT: String(SERVER_PORT), PARTY_CLIENT_PORT: String(VITE_PORT) } });
  await waitHttp(`http://localhost:${VITE_PORT}/host.html`);
  return p;
}

function checker() {
  const failures = [];
  const passed = [];
  const check = (ok, msg, extra) => {
    console.log(`${stamp()} ${ok ? '  ok  ' : '  FAIL'} ${msg}${!ok && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 800) : ''}`);
    (ok ? passed : failures).push(ok ? msg : { msg, extra });
    return ok;
  };
  return { check, failures, passed };
}

/** Collects page errors and console errors of a page under a label. */
function watchErrors(page, label, sink) {
  page.on('pageerror', (e) => sink.push({ at: stamp(), label, kind: 'pageerror', text: String(e.message).slice(0, 400) }));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const loc = m.location();
      sink.push({ at: stamp(), label, kind: m.type(), text: m.text().slice(0, 400), url: loc && loc.url ? `${loc.url}:${loc.lineNumber}` : '' });
    }
  });
  page.on('requestfailed', (r) => {
    const f = r.failure();
    // a media element that is stopped cancels its own range request: not an error
    if (f && /ERR_ABORTED/.test(f.errorText) && /\/(audio|cutscenes)\//.test(r.url())) return;
    sink.push({ at: stamp(), label, kind: 'requestfailed', text: `${r.url()} ${f ? f.errorText : ''}` });
  });
  page.on('response', (r) => {
    if (r.status() >= 400) sink.push({ at: stamp(), label, kind: 'http' + r.status(), text: r.url() });
  });
}

/** DOM size, heap, live media of the page. */
const sample = (page) =>
  page.evaluate(() => {
    const st = window.__host && window.__host.state();
    const m = window.__partyMusic ? window.__partyMusic.stats() : null;
    return {
      phase: st ? st.phase : null,
      cut: !!(st && st.cutscene),
      nodes: document.getElementsByTagName('*').length,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      totalHeapMB: performance.memory ? +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) : null,
      media: document.querySelectorAll('audio, video').length,
      imgs: document.images.length,
      blobImgs: [...document.images].filter((i) => i.src.startsWith('blob:')).length,
      music: m,
    };
  });

/** rAF deltas for `ms`: p50 / p95 / worst and fps, plus long frames (> 50 ms). */
const frames = (page, ms) =>
  page.evaluate(
    (dur) =>
      new Promise((res) => {
        const d = [];
        let last = performance.now();
        const t0 = last;
        const step = (t) => {
          d.push(t - last);
          last = t;
          if (t - t0 < dur) requestAnimationFrame(step);
          else {
            const long = d.filter((x) => x > 50).length;
            d.sort((a, b) => a - b);
            const q = (p) => +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1);
            res({ n: d.length, fps: +((d.length * 1000) / dur).toFixed(1), p50: q(0.5), p95: q(0.95), worst: q(1), long });
          }
        };
        requestAnimationFrame(step);
      }),
    ms,
  );

/**
 * Readability at a distance: every visible piece of text that is a player's name or carries a
 * digit, with its font size scaled to a 1080-px-high screen. Returns the ones under `minPx`
 * (grouped by class) and the smallest name / number.
 */
const textScan = (page, minPx = 28) =>
  page.evaluate((min) => {
    const st = window.__host && window.__host.state();
    const names = new Set(((st && st.players) || []).map((p) => p.name));
    const scale = 1080 / window.innerHeight;
    const out = new Map();
    let minName = null;
    let minNum = null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || '').trim();
      if (text.length === 0) continue;
      const el = n.parentElement;
      if (!el) continue;
      const isName = names.has(text);
      const isNum = /\d/.test(text);
      if (!isName && !isNum) continue;
      // visible?
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
      let op = 1;
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const o = Number(getComputedStyle(e).opacity);
        op *= o;
        if (op < 0.2) break;
      }
      if (op < 0.2) continue;
      // the text's real drawn size: font size times every scale transform above it
      let k = 1;
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const t = getComputedStyle(e).transform;
        if (t && t !== 'none') {
          const m = t.match(/matrix\(([^)]+)\)/);
          if (m) {
            const [a, b] = m[1].split(',').map(Number);
            k *= Math.hypot(a, b);
          }
        }
      }
      const px = +(parseFloat(cs.fontSize) * k * scale).toFixed(1);
      const where = (el.closest('[class]') || el).className.toString().split(/\s+/).slice(0, 2).join('.');
      const kind = isName ? 'name' : 'num';
      if (isName && (minName === null || px < minName.px)) minName = { px, text, where };
      if (isNum && (minNum === null || px < minNum.px)) minNum = { px, text: text.slice(0, 30), where };
      if (px < min) {
        const key = `${kind}:${where}`;
        const prev = out.get(key);
        if (!prev || px < prev.px) out.set(key, { kind, where, px, text: text.slice(0, 30), count: (prev ? prev.count : 0) + 1 });
        else prev.count++;
      }
    }
    return { small: [...out.values()].sort((a, b) => a.px - b.px), minName, minNum };
  }, minPx);

module.exports = {
  ROOT,
  TREE,
  SERVER,
  SERVER_PORT,
  VITE_PORT,
  PW,
  SONGS,
  FOREIGN_QR_URL,
  sleep,
  stamp,
  outDir,
  prepareTree,
  writeDesignedQr,
  spawnProc,
  stopAll,
  waitHttp,
  startServer,
  startVite,
  checker,
  watchErrors,
  sample,
  frames,
  textScan,
};
