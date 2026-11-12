// sweep-tv-summary: reads tests/e2e/out/sweep-tv-/evening-<W>x<H>/report.json (written by
// sweep-tv-evening.cjs) and prints what the evening looked like: memory and DOM per minute and
// their trend, frame time of every race, the songs heard per phase (with every stretch longer than
// 1.2 s where the wrong song, or two songs, were audible), the smallest names / numbers per scene,
// the winners and podiums, the cutscenes, the console errors.
//
//   node tests/e2e/sweep-tv-summary.cjs [1920x1080|1280x720|<dir name>]
const fs = require('fs');
const path = require('path');

const arg = process.argv[2] || '1920x1080';
const dir = path.join(__dirname, 'out', 'sweep-tv-', arg.startsWith('evening') ? arg : `evening-${arg}`);
const r = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
const out = [];
const say = (...a) => out.push(a.join(' '));

say(`# evening ${r.tag}  ${r.startedAt} → ${r.endedAt}  checks ok ${r.passed}, failed ${r.failures.length}`);
say('\n## failures');
for (const f of r.failures) say(' -', typeof f === 'string' ? f : `${f.msg} ${JSON.stringify(f.extra || '').slice(0, 400)}`);

say('\n## memory / DOM (after a forced GC)');
say(' min   label           phase    game     heapMB  docNodes allNodes listeners intervals timeouts media blobImgs tracks');
for (const s of r.samples) {
  say(
    ` ${String(s.min).padStart(4)}  ${String(s.label).padEnd(15)} ${String(s.phase).padEnd(8)} ${String(s.game || '').padEnd(8)} ${String(s.heapMB).padStart(6)} ${String(s.docNodes).padStart(8)} ${String(s.allNodes).padStart(8)} ${String(s.listeners).padStart(9)} ${String(s.intervals).padStart(9)} ${String(s.timeouts).padStart(8)} ${String(s.media).padStart(5)} ${String(s.blobImgs).padStart(8)} ${String(s.tracks).padStart(6)}`,
  );
}
say(' trend per minute:', JSON.stringify(r.trend));
const lob = r.samples.filter((s) => s.phase === 'lobby' && s.label !== 'empty lobby');
if (lob.length >= 2) {
  const a = lob[0];
  const b = lob[lob.length - 1];
  say(` lobby vs lobby: min ${a.min} heap ${a.heapMB} MB, nodes ${a.allNodes}, listeners ${a.listeners}  →  min ${b.min} heap ${b.heapMB} MB, nodes ${b.allNodes}, listeners ${b.listeners}`);
}
const byPhase = {};
for (const s of r.samples) (byPhase[s.phase] = byPhase[s.phase] || []).push(s);
for (const [ph, list] of Object.entries(byPhase)) {
  if (list.length < 2) continue;
  say(`  ${ph}: allNodes ${list.map((s) => s.allNodes).join(' ')} | heap ${list.map((s) => s.heapMB).join(' ')}`);
}

say('\n## races: frame time (rAF deltas) with the live scoreboard');
for (const f of r.frames) say(` ${f.round.padEnd(12)} rows ${f.rows}  1x ${f.x1.fps} fps p50 ${f.x1.p50} p95 ${f.x1.p95} worst ${f.x1.worst} (>50ms: ${f.x1.long})  |  4x CPU ${f.x4.fps} fps p50 ${f.x4.p50} p95 ${f.x4.p95} worst ${f.x4.worst} (>50ms: ${f.x4.long})`);

say('\n## songs heard (250 ms samples)');
const tl = r.audTimeline || [];
const want = (phase, cut, game) => {
  if (cut) return [[]];
  if (phase === 'lobby') return [['lobby']];
  if (phase === 'intro' || phase === 'countdown' || phase === 'playing') return [[game]];
  if (phase === 'results') return [[], ['victory']];
  if (phase === 'final') return [[], ['final']];
  return [[]];
};
const counts = {};
let bad = null;
const stretches = [];
for (const [t, phase, cut, game, aud] of tl) {
  const names = aud.map((x) => x.split(':')[0]).sort();
  const key = `${cut ? 'cutscene' : phase}${game && phase !== 'lobby' && phase !== 'final' ? ':' + game : ''}`;
  counts[key] = counts[key] || {};
  const nk = names.join('+') || '(silence)';
  counts[key][nk] = (counts[key][nk] || 0) + 1;
  const ok = want(phase, cut, game).some((w) => w.join('+') === names.join('+'));
  if (!ok) {
    if (bad === null) bad = { from: t, to: t, key, names: nk, n: 0 };
    bad.to = t;
    bad.n++;
  } else if (bad !== null) {
    if (bad.to - bad.from >= 1200) stretches.push(bad);
    bad = null;
  }
}
if (bad !== null && bad.to - bad.from >= 1200) stretches.push(bad);
for (const [k, v] of Object.entries(counts)) say(`  ${k.padEnd(18)} ${Object.entries(v).map(([n, c]) => `${n} ×${c}`).join(', ')}`);
say(' unexpected stretches ≥ 1.2 s:');
for (const s of stretches) say(`  ${new Date(s.from).toISOString()} +${s.to - s.from} ms  in ${s.key}: heard ${s.names}`);
if (stretches.length === 0) say('  none');

say('\n## readability: smallest name / number per scene (px at 1080p); everything under 28 px');
const scenes = {};
for (const s of r.scans) {
  const e = (scenes[s.scene] = scenes[s.scene] || { minName: null, minNum: null, small: new Map(), n: 0 });
  e.n++;
  if (s.minName && (!e.minName || s.minName.px < e.minName.px)) e.minName = s.minName;
  if (s.minNum && (!e.minNum || s.minNum.px < e.minNum.px)) e.minNum = s.minNum;
  for (const x of s.small) {
    const k = `${x.kind} ${x.where}`;
    const p = e.small.get(k);
    if (!p || x.px < p.px) e.small.set(k, { ...x, rounds: (p ? p.rounds : 0) + 1 });
    else p.rounds++;
  }
}
for (const [name, e] of Object.entries(scenes)) {
  say(` ${name} (${e.n} scans): smallest name ${e.minName ? `${e.minName.px} px "${e.minName.text}" .${e.minName.where}` : '-'}; smallest number ${e.minNum ? `${e.minNum.px} px "${e.minNum.text}" .${e.minNum.where}` : '-'}`);
  for (const x of [...e.small.values()].sort((a, b) => a.px - b.px)) say(`     < 28: ${x.kind} ${x.px} px "${x.text}" in .${x.where} (in ${x.rounds} scans)`);
}

say('\n## winners');
for (const g of r.rounds) say(`  ${g.label.padEnd(11)} server ${g.winner} | ceremony ${g.ceremonyName} | banner ${(g.banner || '').trim().slice(0, 40)}${g.error ? ' | ERROR ' + g.error : ''}`);
say('\n## podiums');
for (const f of r.finals) say(`  competition ${f.comp}: TV ${JSON.stringify(f.pod)} | server ${JSON.stringify(f.want)} | top ${f.top.map((p) => `${p.rank}.${p.name} ${p.total}`).join(', ')}`);
say('\n## cutscenes');
for (const c of r.cutscenes) say(`  ${c.at} ${c.round} ${c.id} ${c.why || ''} mode=${c.mode || ''} src=${c.vsrc || ''} ${c.playedMs ? c.playedMs + ' ms' : ''}`);
say('\n## console / page errors');
const errs = r.errors.filter((e) => e.kind !== 'warning');
const groups = new Map();
for (const e of r.errors) {
  const k = `${e.label.replace(/ .*/, '')} ${e.kind} ${e.text.replace(/\d+/g, '#').slice(0, 160)}`;
  const g = groups.get(k) || { n: 0, first: e.at, e };
  g.n++;
  groups.set(k, g);
}
for (const [k, g] of groups) say(`  ×${g.n} first ${g.first}: ${k}`);
if (groups.size === 0) say('  none');
say(`  (${errs.length} errors, ${r.errors.length - errs.length} warnings)`);
say('\n## notes');
for (const n of r.notes) say('  ' + n);
console.log(out.join('\n'));
