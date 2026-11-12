// Build of the single-page preview (client/preview.html) for tools/preview/make.sh:
// relative base (the page is served from any path), one JS file, one CSS file.
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const root = process.env.PREVIEW_SRC;
const out = process.env.PREVIEW_OUT;
if (!root || !out) throw new Error('PREVIEW_SRC and PREVIEW_OUT must be set (see tools/preview/make.sh)');

export default defineConfig({
  root: resolve(root, 'client'),
  base: './',
  plugins: [preact()],
  build: {
    outDir: out,
    emptyOutDir: true,
    target: ['es2020', 'safari14'],
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { preview: resolve(root, 'client/preview.html') },
      output: { inlineDynamicImports: true },
    },
  },
});
