// sweep-phone-*: a sweep of every phone screen on six device profiles.
// Shared helpers on top of qa-phone-lib.cjs (which reads SERVER_URL / CLIENT_URL when it is required).
//
//   PORT=8951 PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=30000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//
// Outputs: tests/e2e/out/sweep-phone-/<script>/
process.env.SERVER_URL = process.env.SERVER_URL || 'http://localhost:8951';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5351';
const fs = require('fs');
const path = require('path');
const L = require('./qa-phone-lib.cjs');

const { devices } = L;
const OUT_ROOT = path.join(__dirname, 'out', 'sweep-phone-');

const ANDROID_UA = devices['Pixel 7'].userAgent;

/**
 * The six device profiles of the brief. `inset` = emulated safe area [top, bottom] in CSS px.
 * The Pro Max runs as the home-screen app (the manifest asks for standalone): the whole
 * 430x932 screen, notch (Dynamic Island) 59 px on top, home indicator 34 px at the bottom.
 */
const PROFILES = {
  se: { label: 'iPhone SE 320x568', device: { ...devices['iPhone SE'] }, inset: null },
  ip14: { label: 'iPhone 14 (Safari 390x664)', device: { ...devices['iPhone 14'] }, inset: null },
  promax: {
    label: 'iPhone 14 Pro Max standalone 430x932 + notch/home indicator',
    device: { ...devices['iPhone 14 Pro Max'], viewport: { width: 430, height: 932 } },
    inset: [59, 34],
  },
  pixel7: { label: 'Pixel 7 412x839', device: { ...devices['Pixel 7'] }, inset: null },
  s8: { label: 'Galaxy S8 360x740', device: { ...devices['Galaxy S8'] }, inset: null },
  a412: {
    label: 'Android 412x915',
    device: { userAgent: ANDROID_UA, viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    inset: null,
  },
};
const ORDER = Object.keys(PROFILES);

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

// ───────── findings log (data the report is built from) ─────────
function makeLog(tag, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const issues = [];
  const passes = [];
  const file = path.join(outDir, 'findings.jsonl');
  fs.writeFileSync(file, '');
  return {
    issue(kind, where, detail, extra = {}) {
      const rec = { t: stamp(), kind, where, detail: String(detail).slice(0, 600), ...extra };
      issues.push(rec);
      fs.appendFileSync(file, JSON.stringify(rec) + '\n');
      console.log(`  ✗ [${tag} ${rec.t}] ${kind} ${where}: ${rec.detail}`);
    },
    pass(msg) {
      passes.push(msg);
      if (!process.env.QUIET) console.log(`  ✓ [${tag}] ${msg}`);
    },
    check(cond, kind, where, detail) {
      if (cond) passes.push(`${kind} ${where}`);
      else this.issue(kind, where, detail);
      return !!cond;
    },
    issues,
    passes,
    summary() {
      const by = {};
      for (const i of issues) by[i.kind] = (by[i.kind] || 0) + 1;
      fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ issues: issues.length, passes: passes.length, byKind: by }, null, 1));
      console.log(`\n[${tag}] ${issues.length} issue(s), ${passes.length} pass(es) ${JSON.stringify(by)}`);
      return issues.length;
    },
  };
}

// ───────── pages ─────────
/** A preloader request aborted within this long of the page navigating was cut off by it (openProfile). */
const PRELOAD_CUT_MS = 1500;

/** A phone page with console / page errors / failed requests recorded, and the safe area emulated. */
async function openProfile(browser, key, log, opts = {}) {
  const prof = PROFILES[key];
  const name = opts.name || key;
  const ctx = await browser.newContext({ ...prof.device, ...(opts.context || {}) });
  if (opts.initScript) await ctx.addInitScript(opts.initScript);
  const page = await ctx.newPage();
  page.__name = name;
  page.__key = key;
  page.__ctx = ctx;
  page.__label = 'boot';
  page.__errors = [];
  page.__failed = [];
  page.on('pageerror', (e) => {
    page.__errors.push(`${page.__label}: ${e.message}`);
    log.issue('pageerror', `${name}@${page.__label}`, e.message);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    if (m.type() === 'warning' && !/font|decode|Failed|error/i.test(text)) return;
    // an offline test produces expected socket errors
    if (page.__offline && /ERR_INTERNET_DISCONNECTED|WebSocket|socket|net::/i.test(text)) return;
    const where = (m.location() && m.location().url) || '';
    page.__errors.push(`${page.__label}: ${text}`);
    log.issue(m.type() === 'error' ? 'console-error' : 'console-warning', `${name}@${page.__label}`, `${text} ${where.replace(L.CLIENT, '')}`);
  });
  page.__leftAt = 0;
  page.on('framenavigated', (fr) => {
    if (fr === page.mainFrame()) page.__leftAt = Date.now();
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (page.__offline) return;
    if (/\/socket\.io\//.test(u)) return; // transport upgrades and reconnects
    const f = r.failure();
    if (f && /ERR_ABORTED/.test(f.errorText) && /\.(mp3|m4a|ogg|wav|webm|mp4)/.test(u)) return; // media range aborts
    const report = () => {
      page.__failed.push(`${page.__label}: ${u.replace(L.CLIENT, '')} ${f ? f.errorText : ''}`);
      log.issue('request-failed', `${name}@${page.__label}`, `${u.replace(L.CLIENT, '')} ${f ? f.errorText : ''}`);
    };
    // The background preloader (client/src/kit/preload.ts: a fetch() per file under /assets/, and
    // the picture a doll / accessory file is then handed to the avatar compositor as) is still
    // loading art for later when a script leaves the page (a reload, a goto, a back, a close):
    // those requests are cut off, not failed. Only when the page did leave around that moment:
    // the preloader giving up on a stalled file is the same ERR_ABORTED, and is still reported.
    const file = u.replace(L.CLIENT, '');
    const preloaders = (r.resourceType() === 'fetch' && /^\/assets\//.test(file)) || (r.resourceType() === 'image' && /^\/assets\/shimi\/(doll\.|props\/)/.test(file));
    if (f && /ERR_ABORTED/.test(f.errorText) && preloaders) {
      const at = Date.now();
      setTimeout(() => {
        if (!page.isClosed() && Math.abs(page.__leftAt - at) > PRELOAD_CUT_MS) report();
      }, PRELOAD_CUT_MS);
      return;
    }
    report();
  });
  page.on('response', (r) => {
    const s = r.status();
    if (s < 400) return;
    const u = r.url();
    page.__failed.push(`${page.__label}: ${s} ${u.replace(L.CLIENT, '')}`);
    log.issue('http-' + s, `${name}@${page.__label}`, u.replace(L.CLIENT, ''));
  });
  if (prof.inset) await L.setSafeArea(page, prof.inset[0], prof.inset[1]);
  return page;
}

/**
 * qa-phone-lib's layout audit, with what it cannot know about the newer screens: decorations
 * (aria-hidden, the dressing room's rays / fx / screen-reader line) and content of a scroller
 * (a horizontal shelf, a list) are not "off screen"; a span inside a button is not a tap target.
 */
async function audit(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const vv = window.visualViewport;
    const VH = vv ? vv.height : H;
    const decor = '.kit-scroll, .pp-confetti, .pp-rays, .pp-spot, .pa-stage-game, .pp-tv-legs, .pp-me-glow, .pp-prize-shine, .pp-dots, .pp-eq, .dr-rays, .dr-glow, .dr-dots, .dr-fx, .dr-sr, .pw-glow, .pw-dots, [aria-hidden="true"]:not(.pp-rotate)';
    const out = { clipped: [], small: [], inputs: [], overlaps: [], inner: [] };
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      let n = el;
      while (n && n !== document.body) {
        const c = getComputedStyle(n);
        if (Number(c.opacity) < 0.05 || c.display === 'none') return false;
        n = n.parentElement;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const scroller = (el) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (/auto|scroll/.test(c.overflowX + c.overflowY)) return n;
      }
      return null;
    };
    const topLayer = document.querySelector('.pp-landscape .pp-rotate, .pp-cutscene, .pp-resume');
    const leaves = [];
    for (const el of document.querySelectorAll('#app *')) {
      if (el.closest(decor)) continue;
      if (topLayer && !topLayer.contains(el) && !el.closest('.pp-banner')) continue;
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const isCtl = /^(BUTTON|INPUT)$/.test(el.tagName);
      if (el.tagName === 'INPUT') {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) out.inputs.push(`${el.className} ${fs}px`);
      }
      const leaf = isCtl || el.children.length === 0 || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
      if (!leaf) continue;
      const sc = scroller(el);
      if (!sc && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > VH + 1)) {
        out.clipped.push(`${el.tagName}.${el.className} "${(el.textContent || '').trim().slice(0, 18)}" ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
      const cs = getComputedStyle(el);
      if (el.tagName !== 'INPUT' && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && cs.overflow !== 'visible' && !/auto|scroll/.test(cs.overflowX)) {
        out.inner.push(`${el.className} ${el.scrollWidth}>${el.clientWidth} "${(el.textContent || '').trim().slice(0, 16)}"`);
      }
      if (((el.textContent || '').trim() !== '' || isCtl) && !el.closest('.pw-burst')) leaves.push({ el, r, rs: [...el.getClientRects()], sc });
    }
    for (const s of document.querySelectorAll('.pp-screen, .pp-join-card, .pp-res-card, .pp-panel:not(.pp-grow)')) {
      if (topLayer && !topLayer.contains(s)) continue;
      const box = s.getBoundingClientRect();
      for (const el of s.querySelectorAll('*')) {
        if (el.closest(decor) || !visible(el)) continue;
        if (getComputedStyle(el).position === 'absolute' && el.parentElement === s) continue;
        const sc = scroller(el);
        if (sc && s.contains(sc) && sc !== el) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > box.bottom + 2 || r.top < box.top - 2 || r.left < box.left - 2 || r.right > box.right + 2) {
          out.inner.push(`${s.className.split(' ').slice(0, 2).join('.')} cuts ${el.className || el.tagName} ${Math.round(r.top)}..${Math.round(r.bottom)} of ${Math.round(box.top)}..${Math.round(box.bottom)}`);
          break;
        }
      }
    }
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i];
        const b = leaves[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const hit = a.rs.some((ra) => b.rs.some((rb) => Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 4 && Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 4));
        if (hit) {
          // inside a scroller, only what shows counts
          const shown = (x) => {
            if (!x.sc) return true;
            const b2 = x.sc.getBoundingClientRect();
            return x.r.bottom > b2.top && x.r.top < b2.bottom && x.r.right > b2.left && x.r.left < b2.right;
          };
          if (!shown(a) || !shown(b)) continue;
          const nm = (e) => `${e.className || e.tagName}"${(e.textContent || '').trim().slice(0, 10)}"`;
          out.overlaps.push(`${nm(a.el)} × ${nm(b.el)}`);
        }
      }
    }
    return { W, H, VH, sh: se.scrollHeight, sw: se.scrollWidth, sy: window.scrollY, sx: window.scrollX, scale: vv ? vv.scale : 1, ...out };
  });
}

/**
 * The checks of the brief on the current screen, on top of qa-phone-lib's audit:
 * notch / home indicator bands, sideways scroll inside boxes, tap targets (also non-button
 * controls), broken pictures, fonts (digits by heavy Rubik, Hebrew not in a fallback font),
 * document direction.
 */
async function deepAudit(page) {
  return page.evaluate(() => {
    const W = innerWidth;
    const H = innerHeight;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:env(safe-area-inset-bottom,0px);height:env(safe-area-inset-top,0px);pointer-events:none;visibility:hidden';
    document.body.append(probe);
    const pr = probe.getBoundingClientRect();
    probe.remove();
    const sat = pr.height;
    const sab = pr.width;
    const decor = '.pp-confetti, .pp-rays, .pp-spot, .pp-tv-legs, .pp-me-glow, .pp-prize-shine, .pp-dots, .pp-eq, .dr-rays, .dr-glow, .dr-dots, .dr-fx, .pw-glow, .pw-dots, [aria-hidden="true"]:not(.pp-rotate)';
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      let n = el;
      while (n && n !== document.body) {
        const c = getComputedStyle(n);
        if (Number(c.opacity) < 0.05 || c.display === 'none' || c.visibility === 'hidden') return false;
        n = n.parentElement;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const topLayer = document.querySelector('.pp-landscape .pp-rotate, .pp-cutscene, .pp-resume');
    const out = { sat, sab, notch: [], home: [], sideScroll: [], smallCtl: [], keys: [], brokenImg: [], digitFont: [], dir: document.documentElement.dir, lang: document.documentElement.lang, texts: 0 };
    const isText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    for (const el of document.querySelectorAll('#app *')) {
      if (el.closest(decor)) continue;
      if (topLayer && !topLayer.contains(el) && !el.closest('.pp-banner')) continue;
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ctlSel = 'button, input, a[href], [role="button"], [role="tab"], [data-k], [data-act]';
      const ctl = el.matches(ctlSel) && !(el.parentElement && el.parentElement.closest(ctlSel));
      const text = isText(el);
      if (text) out.texts++;
      // notch / home indicator: text and controls must stay out of the bands (as clipped by their scrollers)
      let vr = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
        const b = n.getBoundingClientRect();
        vr = { top: Math.max(vr.top, b.top), bottom: Math.min(vr.bottom, b.bottom), left: Math.max(vr.left, b.left), right: Math.min(vr.right, b.right) };
      }
      if (vr.bottom - vr.top <= 1 || vr.right - vr.left <= 1) continue;
      if ((text || ctl) && sat > 0 && vr.top < sat - 1 && vr.bottom > 0) out.notch.push(`${el.tagName}.${String(el.className).slice(0, 40)} "${(el.textContent || '').trim().slice(0, 16)}" top ${Math.round(r.top)}`);
      if ((text || ctl) && sab > 0 && vr.bottom > H - sab + 1 && vr.top < H) out.home.push(`${el.tagName}.${String(el.className).slice(0, 40)} "${(el.textContent || '').trim().slice(0, 16)}" bottom ${Math.round(vr.bottom)} of ${H}`);
      // boxes that scroll sideways
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) out.sideScroll.push(`${el.tagName}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      if (ctl && el.tagName !== 'INPUT') {
        const m = Math.min(r.width, r.height);
        if (el.hasAttribute('data-k')) {
          if (m < 43.5) out.keys.push(Math.round(r.width) + 'x' + Math.round(r.height));
        } else if (m < 43.5) out.smallCtl.push(`${el.tagName}.${String(el.className).slice(0, 40)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0 && el.getAttribute('src')) out.brokenImg.push(el.getAttribute('src').slice(0, 80));
      // digits in the display font must come from 'Motaleh Fill' (heavy Rubik)
      if (text && /[0-9]/.test([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''))) {
        const ff = cs.fontFamily;
        if (/Motaleh/.test(ff) && !/Motaleh Fill/.test(ff)) out.digitFont.push(`${String(el.className).slice(0, 30)} "${el.textContent.trim().slice(0, 12)}" ff=${ff.slice(0, 50)}`);
      }
    }
    out.fonts = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')).filter((v, i, a) => a.indexOf(v) === i);
    out.fontErr = [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family);
    return out;
  });
}

/**
 * Fonts the renderer really used, per text node (CDP). A text whose CSS stack STARTS with the
 * party's own fonts (Motaleh / Party Rubik / Rubik) but is drawn (in part) by a system font is a
 * fallback (a missing glyph or a face that did not load); a system-ui stack is the system font on
 * purpose and is not judged here (this headless machine's system-ui is Inter, a phone's is SF / Roboto).
 * Emoji fonts are fine.
 */
async function usedFonts(page) {
  const c = await L.cdp(page);
  try {
    await c.send('DOM.enable');
    await c.send('CSS.enable');
    const { root } = await c.send('DOM.getDocument', { depth: -1 });
    const texts = [];
    const walk = (n, parent, inApp) => {
      const app = inApp || (n.attributes && n.attributes.includes('id') && n.attributes[n.attributes.indexOf('id') + 1] === 'app');
      if (app && n.nodeType === 3 && n.nodeValue.trim()) texts.push({ n, parent });
      for (const ch of n.children || []) walk(ch, n, app);
    };
    walk(root, null, false);
    const fam = {};
    const odd = [];
    for (const { n, parent } of texts.slice(0, 500)) {
      let fonts;
      try {
        fonts = (await c.send('CSS.getPlatformFontsForNode', { nodeId: n.nodeId })).fonts;
      } catch {
        continue;
      }
      if (!fonts || fonts.length === 0) continue; // not rendered
      for (const f of fonts) fam[f.familyName] = (fam[f.familyName] || 0) + f.glyphCount;
      let ff = '';
      try {
        const { computedStyle } = await c.send('CSS.getComputedStyleForNode', { nodeId: parent.nodeId });
        ff = computedStyle.find((x) => x.name === 'font-family').value;
      } catch {}
      if (!/^["']?(Motaleh|Party Rubik|Rubik)/.test(ff)) continue;
      const bad = fonts.filter((f) => !f.isCustomFont && !/Emoji/i.test(f.familyName));
      // pictographs (⏱, ✕, ←...) are not in any text font: a symbol font for them is expected
      const symbols = [...n.nodeValue].filter((ch) => /[\u2190-\u2BFF\u{1F000}-\u{1FFFF}]/u.test(ch)).length;
      if (bad.reduce((a, f) => a + f.glyphCount, 0) <= symbols) continue;
      if (bad.length) odd.push(`${bad.map((f) => `${f.familyName}x${f.glyphCount}`).join(',')} in "${n.nodeValue.trim().slice(0, 24)}" (${ff.slice(0, 30)})`);
    }
    return { fam, odd: [...new Set(odd)].slice(0, 12) };
  } catch (e) {
    return { fam: {}, odd: [], error: e.message };
  }
}

/**
 * Screenshot + qa-phone-lib audit + deep audit, all reported into `log` (one issue per kind).
 * opts: allowSmall, allowOverlap, allowInner, allowNotch (a game canvas may paint there), fonts.
 */
async function sweepShot(page, dir, label, log, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  page.__label = label;
  const file = path.join(dir, `${page.__name}-${label}.png`);
  try {
    await page.screenshot({ path: file, timeout: 20000 });
  } catch (e) {
    log.issue('screenshot', `${page.__name}/${label}`, e.message);
  }
  let a;
  let d;
  try {
    a = await audit(page);
    d = await deepAudit(page);
  } catch (e) {
    log.issue('audit', `${page.__name}/${label}`, e.message);
    return file;
  }
  const w = `${page.__name}/${label}`;
  const scr = await L.screen(page);
  const ev = { shot: path.relative(path.join(__dirname, '../..'), file), screen: scr };
  const ok = (cond, kind, detail) => {
    if (cond) log.passes.push(`${kind} ${w}`);
    else log.issue(kind, w, detail, ev);
  };
  ok(a.sw <= a.W + 1 && a.sx === 0, 'side-scroll-page', `page scrolls sideways (${a.sw} wide in ${a.W}, scrollX ${a.sx})`);
  ok(a.sh <= a.H + 1 && a.sy === 0, 'page-scroll', `page scrolls (${a.sw}x${a.sh} in ${a.W}x${a.H}, at ${a.sx},${a.sy})`);
  ok(a.scale === 1, 'zoomed', `visual viewport scale ${a.scale}`);
  ok(a.clipped.length === 0, 'off-screen', a.clipped.slice(0, 4).join(' | '));
  if (!opts.allowInner) ok(a.inner.length === 0, 'cut-in-box', a.inner.slice(0, 4).join(' | '));
  if (!opts.allowSmall) ok(d.smallCtl.length === 0, 'tap-target<44', d.smallCtl.slice(0, 5).join(' | '));
  ok(a.inputs.length === 0, 'input-font<16', a.inputs.join(' | '));
  if (d.keys.length && !opts.allowSmall) {
    page.__keysSeen = page.__keysSeen || new Set();
    const sig = [...new Set(d.keys)].sort().join(' ');
    if (!page.__keysSeen.has(sig)) {
      page.__keysSeen.add(sig);
      log.issue('key<44', w, `${d.keys.length} on-screen keys under 44px: ${[...new Set(d.keys)].slice(0, 5).join(' ')}`, ev);
    }
  }
  if (!opts.allowOverlap) ok(a.overlaps.length === 0, 'text-overlap', a.overlaps.slice(0, 4).join(' | '));
  if (!opts.allowNotch) {
    ok(d.notch.length === 0, 'under-notch', `inset ${d.sat}px: ` + d.notch.slice(0, 4).join(' | '));
    ok(d.home.length === 0, 'under-home-indicator', `inset ${d.sab}px: ` + d.home.slice(0, 4).join(' | '));
  }
  ok(d.sideScroll.filter((s) => !/dr-shelf|pp-standings|pp-chips/.test(s)).length === 0, 'side-scroll-box', d.sideScroll.join(' | '));
  ok(d.brokenImg.length === 0, 'broken-img', d.brokenImg.join(' | '));
  ok(d.digitFont.length === 0, 'digit-font', d.digitFont.slice(0, 4).join(' | '));
  ok(d.dir === 'rtl' && d.lang === 'he', 'doc-dir', `html dir=${d.dir} lang=${d.lang}`);
  ok(d.fontErr.length === 0, 'font-load-error', d.fontErr.join(','));
  if (opts.fonts) {
    const f = await usedFonts(page);
    page.__fonts = f;
    ok(f.odd.length === 0, 'fallback-font', f.odd.join(' | '));
  }
  page.__lastAudit = { a, d };
  return file;
}

// ───────── host and bots over raw sockets ─────────
const { io } = require('socket.io-client');

function createHost() {
  const h = L.createHost();
  // patch looks into the state like the TV does
  h.socket.on('looks', (msg) => {
    const st = h.state();
    if (!st) return;
    for (const [id, look] of msg.looks) {
      const p = st.players.find((x) => x.id === id);
      if (p) p.look = look;
    }
  });
  h.scores = null;
  h.socket.on('scores', (m) => (h.scores = m));
  return h;
}

/**
 * Bots that behave per round as told by `plan(gameId, i)` → { raw, finalAtMs } (round time),
 * raw null = send nothing (a guest who does not play). They follow the round clock from the
 * state's serverNow (good enough: they only need to land before the end).
 */
async function addPlanBots(code, n, names, plan) {
  const bots = [];
  for (let i = 0; i < n; i++) {
    const s = io(L.SERVER, { transports: ['websocket'], forceNew: true });
    const call = (ev, req) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ack timeout ' + ev)), 8000);
        s.emit(ev, req, (res) => {
          clearTimeout(t);
          if (!res.ok) reject(new Error(ev + ': ' + res.error));
          else resolve(res);
        });
      });
    const res = await call('player:join', { code, name: names(i) });
    const bot = { s, id: res.playerId, timers: [], done: new Set() };
    s.on('state', (st) => {
      if (!st.round || st.phase !== 'playing' || bot.done.has(st.round.index) || st.round.frozenAt !== null) return;
      if (!st.round.participants && false) return;
      bot.done.add(st.round.index);
      const p = plan(st.round.gameId, i);
      if (!p || p.raw === null) return;
      const idx = st.round.index;
      const skew = Date.now() - st.serverNow;
      const startLocal = st.round.startAt + skew;
      const at = Math.max(0, startLocal + p.finalAtMs - Date.now());
      bot.timers.push(
        setTimeout(() => {
          s.emit('player:score', { round: idx, score: p.raw });
          s.emit('player:final', { round: idx, score: p.raw }, () => {});
        }, at),
      );
    });
    bots.push(bot);
  }
  return {
    bots,
    close: () =>
      bots.forEach((b) => {
        b.timers.forEach(clearTimeout);
        b.s.close();
      }),
  };
}

// ───────── input ─────────
async function touchTap(page, x, y) {
  const c = await L.cdp(page);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y, id: 1 }] });
}
async function touchDown(page, x, y, id = 2) {
  const c = await L.cdp(page);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
}
async function touchUp(page, x, y, id = 2) {
  const c = await L.cdp(page);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y, id }] });
}
async function swipe(page, pts, stepMs = 16) {
  const c = await L.cdp(page);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 3 }] });
  for (let i = 1; i < pts.length; i++) {
    await L.sleep(stepMs);
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i].x, y: pts[i].y, id: 3 }] });
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, id: 3 }] });
}
function line(ax, ay, bx, by, n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n });
  return out;
}

async function playInfo(page) {
  try {
    return await page.evaluate(() => {
      const p = window.__playerPlay;
      return p ? { leftMs: p.leftMs, frozen: p.frozen, score: p.stageScore } : null;
    });
  } catch {
    return null;
  }
}

module.exports = { L, PROFILES, ORDER, OUT_ROOT, stamp, makeLog, openProfile, audit, deepAudit, usedFonts, sweepShot, createHost, addPlanBots, touchTap, touchDown, touchUp, swipe, line, playInfo };
