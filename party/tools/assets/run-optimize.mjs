// `npm run assets` (the first step of `npm run build`): runs tools/assets/optimize.py, which turns
// new PNG art in client/public/assets into visually lossless WebP. Art is never a reason to fail a
// build: without python3 or Pillow (e.g. the Docker image), or when the optimizer itself fails, it
// says so and the build goes on with the art as it is (every slot also takes a PNG).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'optimize.py');
const run = spawnSync('python3', ['-I', script, ...process.argv.slice(2)], { stdio: 'inherit' });
if (run.error !== undefined) {
  console.warn('[assets] python3 not found: PNG art ships as it is (install python3 + Pillow to convert it to WebP)');
} else if (run.status === 3) {
  console.warn('[assets] skipped: PNG art ships as it is');
} else if (run.status !== 0 && !process.argv.includes('--check')) {
  console.warn(`[assets] the optimizer failed (exit ${run.status}): the build goes on with the art as it is`);
}
process.exit(process.argv.includes('--check') ? (run.status ?? 0) : 0);
