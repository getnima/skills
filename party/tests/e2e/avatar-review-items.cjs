// Every catalog item alone on the head at 28/40/64/128/256 + the full doll, in batches of 6.
// node tests/e2e/avatar-review-items.cjs [idFrom idTo]
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, '../../client/src/avatar/catalog.ts'), 'utf8')
  + ['hats', 'face', 'extras'].map((f) => fs.readFileSync(path.join(__dirname, `../../client/src/avatar/catalog.${f}.ts`), 'utf8')).join('\n');
const items = [...src.matchAll(/id: (\d+), slot: '(\w+)', name: '([^']+)'/g)].map((m) => ({ id: +m[1], slot: m[2], name: m[3] }));
const [from = 0, to = 999] = process.argv.slice(2).map(Number);
const list = items.filter((i) => i.id >= from && i.id <= to);
const look = (i, bg) => {
  const f = { HEAD: 2, EYES: 3, EARS: 4, FACE: 5, NECK: 6 }[i.slot];
  const p = ['1', String(bg), '0', '0', '0', '0', '0'];
  p[f] = String(i.id);
  return p.join('.');
};
for (let b = 0; b < list.length; b += 6) {
  const rows = list.slice(b, b + 6).map((i) => ({ label: `${i.id} ${i.slot}`, look: look(i, [4, 0, 2, 7][i.id % 4]), full: 256 }));
  const name = `items-${list[b].id}-${list[Math.min(b + 5, list.length - 1)].id}`;
  console.log(execFileSync('node', [path.join(__dirname, 'avatar-review-sheet.cjs'), name, JSON.stringify(rows), '28,40,64,128,256', '2'], { encoding: 'utf8' }).trim());
}
