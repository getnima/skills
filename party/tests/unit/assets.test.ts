/**
 * The public files after the WebP conversion (tools/assets/optimize.py) and the preload sets
 * (client/src/kit/preload-sets.ts): every file the code names exists, every public file is in a
 * set or excluded on purpose, and the server sends the build's compressed bundles.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { acceptsEncoding, createPartyApp } from '../../server/app';
import { DEFAULT_TIMING } from '../../server/config';
import { PRELOAD_RULES, preloadKind, preloadRule } from '../../client/src/kit/preload-sets';

import type { PartyApp } from '../../server/app';

const ROOT = resolve(import.meta.dirname, '../..');
const PUBLIC = resolve(ROOT, 'client/public');
const IMAGE_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'svg'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Every public file as its public path ('/assets/tap/face.webp'). */
const PUBLIC_PATHS = walk(PUBLIC).map((p) => '/' + relative(PUBLIC, p).split('\\').join('/'));
const KNOWN = new Set(PUBLIC_PATHS);

/** The client's own files that can name a public file. */
const SOURCES = [
  ...walk(resolve(ROOT, 'client/src')).filter((p) => /\.(tsx?|css|html)$/.test(p)),
  ...readdirSync(resolve(ROOT, 'client')).filter((n) => n.endsWith('.html')).map((n) => resolve(ROOT, 'client', n)),
  resolve(PUBLIC, 'manifest.webmanifest'),
];

/** Named although missing, on purpose: a test of the missing-file path, and optional slots probed for. */
const MISSING_ON_PURPOSE = new Set([
  '/assets/shimi/__missing__.png',
  // the designed QR (tools/qr): the lobby probes for it and shows the plain QR without it
  '/assets/host/qr.json',
]);

describe('public files', () => {
  it('every public file the client names by its full path exists (findPublicFile also takes the same base name)', () => {
    const ref = /(findPublicFile\(\s*)?(?:['"`]|url\(\s*['"]?)(\/(?:assets|audio|cutscenes|fonts|icons)\/[\w./-]+\.[A-Za-z0-9]+)(?=['"`)?#])/g;
    let checked = 0;
    for (const file of SOURCES) {
      // code only: an example path in a comment is not a reference
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const m of text.matchAll(ref)) {
        const path = m[2] ?? '';
        if (MISSING_ON_PURPOSE.has(path)) continue;
        checked += 1;
        if (m[1] !== undefined) {
          const base = path.replace(/\.[^./]+$/, '');
          const hit = KNOWN.has(path) || IMAGE_EXTS.some((ext) => KNOWN.has(`${base}.${ext}`));
          expect(hit, `${path} (findPublicFile in ${relative(ROOT, file)})`).toBe(true);
        } else {
          expect(KNOWN.has(path), `${path} named in ${relative(ROOT, file)}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('the art ships as WebP: no PNG left outside the PWA icons', () => {
    const png = PUBLIC_PATHS.filter((p) => /\.png$/i.test(p) && !p.startsWith('/icons/'));
    expect(png).toEqual([]);
  });

  it('every public file is in a preload set or excluded on purpose', () => {
    const unknown = PUBLIC_PATHS.filter((p) => preloadRule(p) === null);
    expect(unknown).toEqual([]);
    for (const rule of PRELOAD_RULES) expect(rule.why.length, String(rule.match)).toBeGreaterThan(5);
  });

  it('the sets: the TV shows the hosts, videos and sound; the phones the games; both the dolls and the fonts', () => {
    const sets = (p: string): readonly string[] => preloadRule(p)?.sets ?? ['?'];
    expect(sets('/assets/hosts/host_a.webp')).toEqual(['tv']);
    expect(sets('/cutscenes/opening.webm')).toEqual(['tv']);
    expect(sets('/audio/gong.mp3')).toEqual(['tv']);
    expect(sets('/assets/tap/pick_00.webp')).toEqual(['phone']);
    expect(sets('/assets/shimi/doll.webp')).toEqual(['tv', 'phone']);
    expect(sets('/assets/shimi/props/08_crown.webp')).toEqual(['tv', 'phone']);
    expect(sets('/assets/host/prize.webp')).toEqual(['tv', 'phone']);
    expect(sets('/fonts/motaleh.woff2')).toEqual(['tv', 'phone']);
    expect(sets('/assets/host/prize.jpg')).toEqual([]);
    expect(sets('/assets/shimi/prop_08_crown.webp')).toEqual([]);
    expect(preloadKind('/cutscenes/opening.webm')).toBe('video');
    expect(preloadKind('/audio/lobby.webm')).toBe('audio');
    expect(preloadKind('/assets/tap/face.webp')).toBe('image');
    expect(preloadKind('/fonts/rubik-latin.woff2')).toBe('font');
  });
});

describe('compressed bundles', () => {
  let app: PartyApp;
  let url = '';
  let dir = '';
  const js = `console.log(${JSON.stringify('x'.repeat(4000))});\n`;
  const art = Buffer.from('RIFF....WEBPVP8 fake picture');
  const prevDir = process.env.PARTY_CLIENT_DIR;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'party-client-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(dir, 'assets', 'main-abc.js'), js);
    writeFileSync(join(dir, 'assets', 'main-abc.js.br'), brotliCompressSync(js));
    writeFileSync(join(dir, 'assets', 'main-abc.js.gz'), gzipSync(js));
    writeFileSync(join(dir, 'assets', 'plain-abc.css'), 'body{color:red}');
    mkdirSync(join(dir, 'assets', 'tap'));
    writeFileSync(join(dir, 'assets', 'tap', 'x.webp'), art);
    process.env.PARTY_CLIENT_DIR = dir;
    app = createPartyApp({ port: 0, origins: null, timing: DEFAULT_TIMING });
    const port = await new Promise<number>((resolve, reject) => {
      app.http.once('error', reject);
      app.http.listen(0, '127.0.0.1', () => {
        const a = app.http.address();
        resolve(typeof a === 'object' && a !== null ? a.port : 0);
      });
    });
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
    if (prevDir === undefined) delete process.env.PARTY_CLIENT_DIR;
    else process.env.PARTY_CLIENT_DIR = prevDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads Accept-Encoding', () => {
    expect(acceptsEncoding('gzip, deflate, br', 'br')).toBe(true);
    expect(acceptsEncoding('gzip;q=1.0, br;q=0', 'br')).toBe(false);
    expect(acceptsEncoding('gzip', 'br')).toBe(false);
    expect(acceptsEncoding(undefined, 'gzip')).toBe(false);
  });

  it('sends the brotli copy, the gzip copy or the plain file, with the same content and a year of cache', async () => {
    for (const [accept, coding] of [
      ['br, gzip', 'br'],
      ['gzip', 'gzip'],
      ['identity', null],
    ] as const) {
      const res = await fetch(`${url}/assets/main-abc.js`, { headers: { 'accept-encoding': accept } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-encoding')).toBe(coding);
      expect(res.headers.get('content-type')).toMatch(/javascript/);
      expect(res.headers.get('vary')).toMatch(/Accept-Encoding/i);
      expect(res.headers.get('cache-control')).toMatch(/immutable/);
      expect(await res.text()).toBe(js);
    }
    const css = await fetch(`${url}/assets/plain-abc.css`, { headers: { 'accept-encoding': 'br' } });
    expect(css.headers.get('content-encoding')).toBeNull();
    expect(await css.text()).toBe('body{color:red}');
    expect((await fetch(`${url}/assets/nope.js`, { headers: { 'accept-encoding': 'br' } })).status).toBe(404);
  });

  it('sends drop-in art for five minutes, then revalidates it; hashed bundles stay immutable', async () => {
    const res = await fetch(`${url}/assets/tap/x.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('last-modified')).not.toBeNull();
    const etag = res.headers.get('etag');
    expect(etag).not.toBeNull();
    expect(Buffer.from(await res.arrayBuffer()).equals(art)).toBe(true);
    // fetch() adds Cache-Control: no-cache to a conditional request unless one is given;
    // a browser revalidating a stale picture sends max-age=0.
    const again = await fetch(`${url}/assets/tap/x.webp`, { headers: { 'if-none-match': etag ?? '', 'cache-control': 'max-age=0' } });
    expect(again.status).toBe(304);
    expect(again.headers.get('cache-control')).toBe('public, max-age=300');
    const head = await fetch(`${url}/assets/tap/x.webp`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe('public, max-age=300');
    expect(head.headers.get('content-length')).toBe(String(art.length));
    const range = await fetch(`${url}/assets/tap/x.webp`, { headers: { range: 'bytes=0-3' } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe('RIFF');
    expect((await fetch(`${url}/assets/tap/nope.webp`)).status).toBe(404);
    for (const name of ['main-abc.js', 'plain-abc.css']) {
      const bundle = await fetch(`${url}/assets/${name}`, { headers: { 'accept-encoding': 'identity' } });
      expect(bundle.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    }
  });
});
