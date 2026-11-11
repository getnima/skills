/**
 * Cutscene video files: which ones exist and which source this browser plays.
 * A manifest entry names e.g. "tap_freeze.mp4"; the player tries that file,
 * then the same base name as .webm and .mp4, in the order the browser can
 * play them. Every probe runs once per page load (HEAD, ranged GET fallback).
 */
import { CUTSCENES } from '../../../shared/cutscenes';

import type { CutsceneDef } from '../../../shared/cutscenes';

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

/** A dev server answers a missing path with the html page: only a non-html 2xx counts. */
function isMediaResponse(res: Response): boolean {
  if (res.status !== 200 && res.status !== 206) return false;
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  return !type.startsWith('text/html');
}

const probes = new Map<string, Promise<boolean>>();

export function fileExists(file: string): Promise<boolean> {
  let p = probes.get(file);
  if (p === undefined) {
    const url = cutsceneUrl(file);
    p = (async (): Promise<boolean> => {
      try {
        const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (isMediaResponse(head)) return true;
        if (head.status !== 405 && head.status !== 501) return false;
        const ranged = await fetch(url, { headers: { Range: 'bytes=0-1' }, cache: 'no-store' });
        const ok = isMediaResponse(ranged);
        void ranged.body?.cancel();
        return ok;
      } catch {
        return false;
      }
    })();
    probes.set(file, p);
  }
  return p;
}

/** Existing files for this cutscene, playable ones first. Empty = show the placeholder card. */
export async function resolveSources(def: CutsceneDef): Promise<string[]> {
  const files = candidateFiles(def.file);
  const exists = await Promise.all(files.map((f) => fileExists(f)));
  const present = files.filter((_, i) => exists[i] === true);
  return [...present.filter((f) => canPlay(f)), ...present.filter((f) => !canPlay(f))];
}

export async function cutsceneStatus(def: CutsceneDef): Promise<FileStatus> {
  const files = await resolveSources(def);
  const first = files[0];
  if (first === undefined) return 'missing';
  return canPlay(first) ? 'ok' : 'unplayable';
}

/** Kick off every probe once, early, so the menu dots and the first cutscene are instant. */
export function prefetchCutsceneStatus(): void {
  for (const def of CUTSCENES) void resolveSources(def);
}
