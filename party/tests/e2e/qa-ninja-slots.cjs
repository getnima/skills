// Art slots of "נינג׳ה תבורי", WITHOUT touching a file of the real tree.
//  1. real tree, read only: every picture the game needs is there (a transparent 384x384 PNG,
//     listed in the README), nothing else is shipped from client/public/assets/ninja/, the
//     game requests every one of them and shows none as a drawn stand-in;
//  2. real tree, every /assets/ninja/ request blocked: every picture falls back to its
//     drawing and the game still plays (slices, no page errors);
//  3. a TEMPORARY COPY of the tree (os.tmpdir(), its own vite on QA_SLOTS_PORT, deleted at
//     the end): a test picture dropped over a slot replaces it, another extension of the
//     same base name works, and really missing files (a food, the gold falafel, one host
//     bomb) fall back to the drawings while the game plays.
// The earlier version of this script wrote into and deleted from the real assets folder.
//   PARTY_CLIENT_PORT=5261 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   QA_BASE=http://localhost:5261 node tests/e2e/qa-ninja-slots.cjs [real|copy|all]
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { chromium, check, fails, sleep, outDir, openGame, touch, BASE } = require('./qa-tap-lib.cjs');

const REPO = path.join(__dirname, '..', '..');
const DIR = path.join(REPO, 'client', 'public', 'assets', 'ninja');
const MODE = process.argv[2] || 'all';
const PORT = Number(process.env.QA_SLOTS_PORT || 5262);
const OUT = outDir('qa-ninja');

const FOOD = ['shawarma', 'hummus', 'sabich', 'falafel', 'bourekas', 'shakshuka', 'schnitzel', 'sufganiya', 'pickle', 'limonana', 'peanut_puffs', 'garden_chair', 'flip_flop', 'gold_falafel'];
const BOMBS = ['bomb_host_a', 'bomb_host_b'];
/** slot key → file under assets/ninja/ */
const SLOTS = Object.fromEntries([...FOOD.map((k) => [k, `food/${k}.png`]), ...BOMBS.map((k) => [k, `bombs/${k}.png`])]);
const IMAGE = /\.(png|webp|jpe?g|svg|gif)$/i;

/** Size and transparency of a PNG or an extended WebP (tools/assets/to_webp.py writes VP8X with alpha). */
function pngInfo(file) {
  const b = fs.readFileSync(file);
  const kb = Math.round(b.length / 1024);
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 6, kb };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' && b.toString('ascii', 12, 16) === 'VP8X') {
    return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1, alpha: (b[20] & 0x10) !== 0, kb };
  }
  return null;
}
/** The file actually shipped for a slot: the slot's own name, else the same base name as WebP (the kit finds either). */
function shipped(rel) {
  if (fs.existsSync(path.join(DIR, rel))) return rel;
  return rel.replace(/\.png$/, '.webp');
}
function listImages(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listImages(p, base));
    else if (IMAGE.test(e.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}
/** name, size and time of every file of the real folder (to prove nothing was touched). */
function fingerprint() {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return walk(DIR)
    .sort()
    .map((f) => {
      const s = fs.statSync(f);
      return `${path.relative(DIR, f)}:${s.size}:${s.mtimeMs}`;
    })
    .join('\n');
}

const loaded = (page) => page.evaluate(() => performance.getEntriesByType('resource').map((e) => decodeURIComponent(new URL(e.name).pathname)).filter((p) => p.startsWith('/assets/')));
const state = (page) => page.evaluate(() => ({ art: window.__ninja.art, sliced: window.__ninja.sliced, launched: window.__ninja.launched, score: window.__ninja.score }));

/** A few seconds of plain play: a horizontal swipe through whatever is highest and not a bomb. */
async function playFor(page, cdp, ms) {
  const t0 = Date.now();
  let id = 50;
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => ({ ts: window.__ninja.targets(), top: window.__ninja.fieldTop, stunned: window.__ninja.stunned }));
    const bombs = st.ts.filter((t) => t.kind === 'bomb');
    const t = st.ts.filter((o) => o.kind !== 'bomb' && o.y > st.top + 40 && o.y < 700 && bombs.every((b) => Math.abs(b.y - o.y) > b.r * 2.6)).sort((a, b) => a.y - b.y)[0];
    if (!t || st.stunned) {
      await sleep(40);
      continue;
    }
    const y = t.y + t.vy * 0.06;
    const pend = [touch(cdp, 'touchStart', [{ x: t.x - t.r * 1.8, y, id }])];
    for (let i = 1; i <= 6; i++) {
      await sleep(16);
      pend.push(touch(cdp, 'touchMove', [{ x: t.x - t.r * 1.8 + (t.r * 3.6 * i) / 6, y, id }]));
    }
    pend.push(touch(cdp, 'touchEnd', []));
    await Promise.all(pend);
    id++;
    await sleep(120);
  }
}

async function realTree(browser) {
  // ── 1. the files ──
  const readme = ['README.md', 'food/README.md', 'bombs/README.md'].map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  const sizes = {};
  for (const [key, slot] of Object.entries(SLOTS)) {
    const rel = shipped(slot);
    const file = path.join(DIR, rel);
    const info = fs.existsSync(file) ? pngInfo(file) : null;
    sizes[key] = info ? info.kb : null;
    check(`${rel}: a transparent 384x384 picture`, !!info && info.w === 384 && info.h === 384 && info.alpha, info);
    check(`${rel}: listed in the README`, readme.includes('`' + path.basename(slot) + '`') || readme.includes('`' + path.basename(rel) + '`'));
  }
  console.log('kB per picture', JSON.stringify(sizes), 'total', Object.values(sizes).reduce((a, b) => a + (b || 0), 0));
  const images = listImages(DIR);
  const wanted = new Set([...Object.values(SLOTS).map(shipped), 'background.jpg', 'background.png', 'background.webp']);
  check('nothing else is shipped from assets/ninja (no picture the game does not load)', images.every((f) => wanted.has(f)), images.filter((f) => !wanted.has(f)));

  // ── 1b. the game loads every one of them ──
  {
    const { page, cdp, context, errors } = await openGame(browser, 'ninja', { viewport: { width: 390, height: 844 }, query: 'seed=4&duration=60000' });
    await page.waitForFunction(() => !!window.__ninja, null, { timeout: 20000 });
    await playFor(page, cdp, 5000);
    const got = await loaded(page);
    const st = await state(page);
    const want = Object.values(SLOTS).map((f) => `/assets/ninja/${shipped(f)}`);
    check('every ninja picture is requested', want.every((w) => got.includes(w)), want.filter((w) => !got.includes(w)));
    check('only those are requested from /assets/ninja/', got.filter((p) => p.startsWith('/assets/ninja/')).every((p) => want.includes(p) || /\/background\./.test(p)), got.filter((p) => p.startsWith('/assets/ninja/') && !want.includes(p)));
    check('no picture shows as a drawn stand-in', Object.keys(SLOTS).every((k) => st.art[k] === true), st.art);
    check('real art: the game plays, no errors', st.sliced > 0 && errors.length === 0, { sliced: st.sliced, errors: errors.slice(0, 3) });
    await page.screenshot({ path: path.join(OUT, 'slots-1-real-art.png') });
    await context.close();
  }

  // ── 2. every picture blocked: drawings, and the game plays ──
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/assets/ninja/**', (r) => r.abort());
    await page.goto(`${BASE}/dev.html?game=ninja&seed=4&duration=60000`);
    await page.waitForFunction(() => !!window.__ninja, null, { timeout: 30000 });
    await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
    const cdp = await context.newCDPSession(page);
    await playFor(page, cdp, 9000);
    const st = await state(page);
    check('blocked: every picture falls back to its drawing', Object.keys(SLOTS).every((k) => st.art[k] === false), st.art);
    check('blocked: the game still plays, no page errors', st.sliced > 0 && st.launched > 3 && errors.length === 0, { sliced: st.sliced, launched: st.launched, errors: errors.slice(0, 3) });
    await page.screenshot({ path: path.join(OUT, 'slots-2-blocked-drawings.png') });
    await context.close();
  }
}

// ───────────────────────────── the temporary copy ─────────────────────────────

function waitForServer(url, ms) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => (Date.now() - t0 > ms ? reject(new Error(`no server at ${url}`)) : setTimeout(tick, 300)));
    };
    tick();
  });
}

/** A loud test picture (a disc with a check mark, off centre) as a file buffer. */
async function testPicture(maker, color, type) {
  const dataUrl = await maker.evaluate(
    ({ color, type }) => {
      const c = document.createElement('canvas');
      c.width = 384;
      c.height = 384;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(230, 150, 130, 90, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 14;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.lineWidth = 26;
      g.beginPath();
      g.moveTo(170, 150);
      g.lineTo(215, 195);
      g.lineTo(300, 105);
      g.stroke();
      return c.toDataURL(type);
    },
    { color, type },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function tempCopy(browser) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ninja-slots-'));
  let vite = null;
  try {
    // the client, what it imports from outside itself, and the configs; node_modules by link
    for (const d of ['client', 'shared']) fs.cpSync(path.join(REPO, d), path.join(tmp, d), { recursive: true });
    for (const f of ['vite.config.ts', 'tsconfig.json', 'package.json']) fs.copyFileSync(path.join(REPO, f), path.join(tmp, f));
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
    // its own dependency cache (never the real tree's node_modules/.vite), no HMR
    fs.writeFileSync(
      path.join(tmp, 'qa.config.mjs'),
      `import base from './vite.config.ts';\nexport default { ...base, cacheDir: ${JSON.stringify(path.join(tmp, '.vite-cache'))}, resolve: { ...(base.resolve || {}), preserveSymlinks: true }, server: { ...base.server, hmr: false, fs: { strict: false } } };\n`,
    );
    const assets = path.join(tmp, 'client', 'public', 'assets', 'ninja');
    const maker = await browser.newPage();
    // drop-ins: a test picture over a slot, and another extension of the same base name
    // (a PNG with the slot's own name wins over the shipped WebP; a JPEG of the same base name replaces it)
    fs.writeFileSync(path.join(assets, 'food', 'shawarma.png'), await testPicture(maker, '#ff00aa', 'image/png'));
    for (const ext of ['png', 'webp']) fs.rmSync(path.join(assets, 'food', `pickle.${ext}`), { force: true });
    fs.writeFileSync(path.join(assets, 'food', 'pickle.jpg'), await testPicture(maker, '#00d0ff', 'image/jpeg'));
    await maker.close();
    // really missing files (every extension of the base name)
    const gone = ['food/falafel', 'food/gold_falafel', 'bombs/bomb_host_b'];
    for (const f of gone) for (const ext of ['png', 'webp', 'jpg']) fs.rmSync(path.join(assets, `${f}.${ext}`), { force: true });

    vite = spawn(process.execPath, [path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'qa.config.mjs'], { cwd: tmp, env: { ...process.env, PARTY_CLIENT_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    vite.stdout.on('data', (d) => (log += d));
    vite.stderr.on('data', (d) => (log += d));
    const url = `http://localhost:${PORT}`;
    await waitForServer(`${url}/dev.html`, 60000).catch((e) => {
      throw new Error(`${e.message}\n${log}`);
    });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // seed 3: its golden target comes early enough to be on the screenshot
    await page.goto(`${url}/dev.html?game=ninja&seed=3&duration=60000`);
    // (the first load of a cold vite may reload the page once while it bundles the dependencies)
    await page.waitForFunction(() => !!window.__ninja && window.__ninja.launched > 0, null, { timeout: 120000 });
    await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
    const cdp = await context.newCDPSession(page);
    await playFor(page, cdp, 9000);
    const got = await loaded(page);
    const st = await state(page);
    check('copy: the dropped test picture is loaded by its slot (food/shawarma.png)', got.includes('/assets/ninja/food/shawarma.png') && st.art.shawarma === true);
    check('copy: another extension of the same base name works (food/pickle.jpg)', got.includes('/assets/ninja/food/pickle.jpg') && !got.some((p) => /\/pickle\.(png|webp)$/.test(p)) && st.art.pickle === true, got.filter((p) => p.includes('pickle')));
    check('copy: missing files are not requested', gone.every((f) => !got.some((p) => p.startsWith(`/assets/ninja/${f}.`))));
    check('copy: missing files show their drawings', st.art.falafel === false && st.art.gold_falafel === false && st.art.bomb_host_b === false && st.art.bomb_host_a === true && st.art.hummus === true, st.art);
    check('copy: without the gold falafel the gold party props are fetched', got.some((p) => p.startsWith('/assets/shimi/prop_')), got.filter((p) => p.startsWith('/assets/shimi/')));
    check('copy: the game plays, no page errors', st.sliced > 0 && errors.length === 0, { sliced: st.sliced, errors: errors.slice(0, 3) });
    await page.screenshot({ path: path.join(OUT, 'slots-3-copy-dropins-and-missing.png') });
    await context.close();
  } finally {
    if (vite) vite.kill('SIGTERM');
    await sleep(500);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check('copy: the temporary tree is gone', !fs.existsSync(tmp));
}

(async () => {
  const before = fingerprint();
  const browser = await chromium.launch();
  try {
    if (MODE === 'real' || MODE === 'all') await realTree(browser);
    if (MODE === 'copy' || MODE === 'all') await tempCopy(browser);
  } finally {
    await browser.close();
  }
  check('the real client/public/assets/ninja is untouched (same files, sizes and times)', fingerprint() === before);
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
