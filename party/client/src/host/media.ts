/**
 * Cutscene video files: which ones exist and which source this browser plays.
 * A manifest entry names e.g. "tap_freeze.mp4"; the player tries that file,
 * then the same base name as .webm and .mp4, in the order the browser can
 * play them.
 *
 * Which files exist is taken at dev-server / build time (import.meta.glob keys
 * only, like kit/files.ts: nothing is bundled and nothing is fetched), so a
 * missing video costs no request and logs no 404. Dev: reload the page after
 * dropping a file. Production: re-run the build.
 */
import { CUTSCENES } from '../../../shared/cutscenes';

import type { CutsceneDef } from '../../../shared/cutscenes';

const videoKeys = Object.keys(import.meta.glob('../../public/cutscenes/*.{mp4,m4v,webm,mov,ogv,MP4,M4V,WEBM,MOV,OGV}'));

/** lower-cased file name → real file name in client/public/cutscenes/ */
const present = new Map<string, string>();
for (const key of videoKeys) {
  const name = key.slice(key.lastIndexOf('/') + 1);
  if (name.length > 0) present.set(name.toLowerCase(), name);
}
/** The files that are really in the build: `present` before a browser test adds its own names below. */
const built = new Map(present);
// Browser tests: ?testCutscenes=joker_1.webm,joker_2.webm declares extra files (the test serves them).
try {
  const extra = new URLSearchParams(window.location.search).get('testCutscenes');
  for (const name of (extra ?? '').split(',')) if (/^[\w.-]+$/.test(name)) present.set(name.toLowerCase(), name);
} catch {
  // no window: nothing to add
}

export type FileStatus = 'checking' | 'ok' | 'unplayable' | 'missing';

const MIME: Readonly<Record<string, string>> = {
  mp4: 'video/mp4; codecs="avc1.4D401F, mp4a.40.2"',
  m4v: 'video/mp4; codecs="avc1.4D401F, mp4a.40.2"',
  webm: 'video/webm; codecs="vp9, opus"',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
};

export function cutsceneUrl(file: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/cutscenes/${encodeURIComponent(file)}`;
}

function extOf(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot < 0 ? '' : file.slice(dot + 1).toLowerCase();
}

function baseOf(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot < 0 ? file : file.slice(0, dot);
}

/** The manifest file first, then the same base name as .webm / .mp4. */
export function candidateFiles(file: string): string[] {
  const base = baseOf(file);
  const out: string[] = [];
  for (const f of [file, `${base}.webm`, `${base}.mp4`]) if (!out.includes(f)) out.push(f);
  return out;
}

let probeVideo: HTMLVideoElement | null = null;

export function canPlay(file: string): boolean {
  const mime = MIME[extOf(file)];
  if (mime === undefined) return false;
  try {
    probeVideo ??= document.createElement('video');
    return probeVideo.canPlayType(mime) !== '';
  } catch {
    return false;
  }
}

/** The real file name of a dropped-in video (case-insensitive), or null when it is not there. */
export function findCutsceneFile(file: string): string | null {
  return present.get(file.toLowerCase()) ?? null;
}

/** Existing files for this cutscene, playable ones first. Empty = show the placeholder card. */
export function resolveSources(def: CutsceneDef): string[] {
  const found: string[] = [];
  for (const f of candidateFiles(def.file)) {
    const real = findCutsceneFile(f);
    if (real !== null && !found.includes(real)) found.push(real);
  }
  return [...found.filter((f) => canPlay(f)), ...found.filter((f) => !canPlay(f))];
}

/**
 * The one file to load ahead for a cutscene (boot-preload.ts): the source the player starts with,
 * when this browser plays it and it is a real file of the build. Null: nothing to load (no file
 * yet, a format this browser refuses, or a ?testCutscenes name, which only that test's own
 * server has: asking for it anywhere else would be a 404).
 */
export function preloadSource(def: CutsceneDef): string | null {
  const first = resolveSources(def)[0];
  if (first === undefined || !canPlay(first) || built.get(first.toLowerCase()) !== first) return null;
  return first;
}

export function cutsceneStatus(def: CutsceneDef): FileStatus {
  const files = resolveSources(def);
  const first = files[0];
  if (first === undefined) return 'missing';
  return canPlay(first) ? 'ok' : 'unplayable';
}

/** Every cutscene's file status (sync: the list of files is known at build time). */
export function allCutsceneStatuses(): Readonly<Record<string, FileStatus>> {
  return Object.fromEntries(CUTSCENES.map((c) => [c.id, cutsceneStatus(c)]));
}
