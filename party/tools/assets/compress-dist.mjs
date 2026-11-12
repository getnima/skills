// Brotli + gzip copies of the built bundles (dist/client/assets/*.js / *.css -> *.js.br, *.js.gz),
// written by `npm run build:client` right after vite. The server sends a copy instead of the plain
// file to a browser that accepts it (server/app.ts serveCompressedBundles): the same bytes once
// decoded, about a third on the wire. A copy that saves under 10 % is not written.
//
//   node tools/assets/compress-dist.mjs [dist/client]
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = resolve(process.argv[2] ?? 'dist/client');
const dir = join(root, 'assets');
let before = 0;
let br = 0;
let gz = 0;
let files = 0;
let names;
try {
  names = readdirSync(dir);
} catch {
  console.log(`[compress] no ${dir}: nothing to do`);
  process.exit(0);
}
// stale copies from an earlier build into the same folder
for (const name of names) if (name.endsWith('.br') || name.endsWith('.gz')) rmSync(join(dir, name), { force: true });
for (const name of names) {
  const path = join(dir, name);
  if (!/\.(js|css)$/.test(name) || !statSync(path).isFile()) continue;
  const raw = readFileSync(path);
  if (raw.length < 1024) continue;
  const b = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
  });
  const g = gzipSync(raw, { level: 9 });
  files += 1;
  before += raw.length;
  if (b.length < raw.length * 0.9) {
    writeFileSync(`${path}.br`, b);
    br += b.length;
  } else br += raw.length;
  if (g.length < raw.length * 0.9) {
    writeFileSync(`${path}.gz`, g);
    gz += g.length;
  } else gz += raw.length;
}
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`[compress] ${files} bundles, ${kb(before)}: brotli ${kb(br)}, gzip ${kb(gz)}`);
