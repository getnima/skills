/**
 * Which drop-in files exist under client/public/assets and client/public/audio.
 *
 * The list is taken at dev-server / build time (import.meta.glob keys only, the
 * files themselves are never imported), so asking for a missing slot costs no
 * request and logs no 404. Vite's dev server picks up a newly dropped file on
 * reload; a production build must be re-run after files are added.
 */
const assetKeys = Object.keys(import.meta.glob('../../public/assets/**/*.{png,webp,jpg,jpeg,svg,gif,json,PNG,JPG,JPEG,WEBP,JSON}'));
const audioKeys = Object.keys(import.meta.glob('../../public/audio/**/*.{mp3,m4a,ogg,wav,webm,MP3,M4A}'));

/** lower-cased public URL → real public URL */
const known = new Map<string, string>();
for (const key of [...assetKeys, ...audioKeys]) {
  const i = key.indexOf('/public/');
  if (i < 0) continue;
  const url = key.slice(i + '/public'.length);
  known.set(url.toLowerCase(), url);
}

/** Every indexed public file as its public path ('/assets/tap/face.webp'): what kit/preload.ts loads ahead. */
export function publicFilePaths(): string[] {
  return [...known.values()];
}

/** The URL of a public path, with the Vite base applied. */
export function publicUrl(path: string): string {
  const prefix = import.meta.env.BASE_URL.replace(/\/$/, '');
  return prefix + encodeURI(path);
}

function stripExt(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(0, dot) : path;
}

/**
 * Find a dropped-in public file. `path` is a public URL such as
 * '/assets/tap/face.png'; the exact name is tried first, then the same base
 * name with each of `exts` (case-insensitive). Returns a URL (with the Vite
 * base applied) or null when no such file exists.
 */
export function findPublicFile(path: string, exts: readonly string[]): string | null {
  const exact = known.get(path.toLowerCase());
  const base = stripExt(path).toLowerCase();
  let hit = exact ?? null;
  for (let i = 0; i < exts.length && hit === null; i++) hit = known.get(`${base}.${exts[i]}`) ?? null;
  if (hit === null) return null;
  return publicUrl(hit);
}
