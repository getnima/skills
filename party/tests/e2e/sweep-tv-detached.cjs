// sweep-tv-detached: where the TV's slowly growing DOM count goes. The evening run sees the
// page's node count (document + detached, after a forced GC) climb all night while the document
// itself stays the same size. This plays short rounds (all five games, the podium, a new
// competition, twice) with 30 bots, takes a heap snapshot after each competition and counts the
// DETACHED DOM nodes by element and class, so the growth can be pinned on what keeps them.
//
//   SWEEP_TREE=<temp tree> node tests/e2e/sweep-tv-detached.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('./sweep-tv-lib.cjs');

const OUT = L.outDir('detached');
const COMPS = Number(process.env.COMPS || 3);

async function snapshot(cdp) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks = [];
  const onChunk = (e) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const snap = JSON.parse(chunks.join(''));
  const f = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const nameAt = f.indexOf('name');
  const typeAt = f.indexOf('type');
  const detAt = f.indexOf('detachedness');
  const n = f.length;
  const counts = new Map();
  let detached = 0;
  for (let i = 0; i < snap.nodes.length; i += n) {
    const name = snap.strings[snap.nodes[i + nameAt]];
    const type = types[snap.nodes[i + typeAt]];
    const isDet = detAt >= 0 ? snap.nodes[i + detAt] === 2 : /^Detached /.test(name);
    if (!isDet || type === 'hidden' || type === 'synthetic') continue;
    if (!/HTML|SVG|Text|Comment|Element|Node|Detached/.test(name)) continue;
    detached++;
    const key = name.slice(0, 120);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { detached, top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25) };
}

(async () => {
  await L.startServer({ PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '12000' });
  const browser = await chromium.launch();
  let bots = null;
  const rows = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const tv = await ctx.newPage();
    await tv.goto(`${L.SERVER}/host`);
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 60000 });
    const code = await tv.evaluate(() => window.__host.state().code);
    await tv.mouse.click(960, 6);
    bots = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', L.SERVER, '--code', code, '--players', '30', '--play', '--quiet'], { cwd: L.TREE, stdio: 'ignore', detached: true });
    await tv.waitForFunction(() => window.__host.state().players.length >= 30, null, { timeout: 60000 });
    const cdp = await ctx.newCDPSession(tv);
    const s0 = await snapshot(cdp);
    const dom0 = await cdp.send('Memory.getDOMCounters');
    rows.push({ at: 'lobby', nodes: dom0.nodes, ...s0 });
    console.log(L.stamp(), 'lobby: detached', s0.detached, 'all nodes', dom0.nodes);
    for (let c = 1; c <= COMPS; c++) {
      let guard = 0;
      while (guard++ < 400) {
        const st = await tv.evaluate(() => {
          const s = window.__host.state();
          return { phase: s.phase, cut: !!s.cutscene, primary: window.__host.model().primary, hint: window.__host.model().hint };
        });
        if (st.phase === 'final') break;
        if (!st.cut && (st.phase === 'lobby' || (st.phase === 'results' && /נגמר/.test(st.hint)))) {
          await L.sleep(1700);
          await tv.keyboard.press('Space');
        }
        await L.sleep(1000);
      }
      await L.sleep(16000); // the podium plays out
      const s = await snapshot(cdp);
      const dom = await cdp.send('Memory.getDOMCounters');
      const docNodes = await tv.evaluate(() => document.getElementsByTagName('*').length);
      rows.push({ at: `after competition ${c}`, nodes: dom.nodes, docNodes, ...s });
      console.log(L.stamp(), `after competition ${c}: detached ${s.detached}, all nodes ${dom.nodes}, in the document ${docNodes}`);
      for (const [k, v] of s.top.slice(0, 12)) console.log('     ', v, k);
      // a new competition (the confirm dialog: Enter, then Enter again after its guard)
      await L.sleep(1700);
      await tv.keyboard.press('Enter');
      await L.sleep(1200);
      await tv.keyboard.press('Enter');
      await tv.waitForFunction(() => window.__host.state().phase === 'lobby' && window.__host.state().played.length === 0, null, { timeout: 20000 });
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (bots) {
      try {
        process.kill(-bots.pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    await browser.close();
    L.stopAll();
  }
  fs.writeFileSync(path.join(OUT, 'detached.json'), JSON.stringify(rows, null, 1));
  console.log('sweep-tv-detached: done');
})();
