/**
 * Dressing room thumbnails: small cut-out pictures (no plate) made by the same compositor as the
 * icons, composed lazily (only for tiles that were on screen), one at a time, and cached for the
 * life of the page. Also the plate swatches (drawPlate) as data URLs.
 * Nothing here throws or rejects.
 */
import { encodeLook } from '../../../shared/avatar';
import { avatarCanvas, drawPlate } from './compose';

import type { AvatarLook } from '../../../shared/avatar';
import type { AvatarCrop } from './layout';

const done = new Map<string, string>();
const running = new Map<string, Promise<string | null>>();
/** Files that failed to load and when (retried after RETRY_MS). */
const failed = new Map<string, number>();
const RETRY_MS = 8000;
/** Cut-outs of whole looks (the plate tab) are kept to this many; item thumbnails are never dropped. */
const LOOK_MAX = 24;
const lookKeys: string[] = [];

interface Job {
  key: string;
  run: () => Promise<string | null>;
  resolve: (url: string | null) => void;
}
const queue: Job[] = [];
let busy = 0;
const PARALLEL = 2;

function pump(): void {
  while (busy < PARALLEL && queue.length > 0) {
    // newest first: the tiles the guest is looking at now win over ones scrolled past
    const job = queue.pop() as Job;
    busy++;
    void job
      .run()
      .catch(() => null)
      .then((url) => {
        busy--;
        job.resolve(url);
        // yield to the page between pictures, so a tap is never stuck behind a row of thumbnails
        setTimeout(pump, 0);
      });
  }
}

function enqueue(key: string, run: () => Promise<string | null>): Promise<string | null> {
  const p = new Promise<string | null>((resolve) => queue.push({ key, run, resolve }));
  pump();
  return p;
}

/** True when the file can be loaded (the browser keeps it, so the compositor gets it from cache). */
function probe(url: string): Promise<boolean> {
  const t = failed.get(url);
  if (t !== undefined && Date.now() - t < RETRY_MS) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        failed.delete(url);
        resolve(img.naturalWidth > 0);
      };
      img.onerror = () => {
        failed.set(url, Date.now());
        resolve(false);
      };
      img.src = url;
    } catch {
      resolve(false);
    }
  });
}

function canvasUrl(c: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof c.toBlob === 'function') {
        c.toBlob((b) => {
          if (b !== null) resolve(URL.createObjectURL(b));
          else {
            try {
              resolve(c.toDataURL('image/png'));
            } catch {
              resolve(null);
            }
          }
        }, 'image/png');
      } else resolve(c.toDataURL('image/png'));
    } catch {
      resolve(null);
    }
  });
}

function thumbKey(look: AvatarLook, crop: AvatarCrop, px: number): string {
  return `${encodeLook(look)}|${crop}|${px}`;
}

/** The thumbnail right now, or null. */
export function peekThumb(look: AvatarLook, crop: AvatarCrop, px: number): string | null {
  return done.get(thumbKey(look, crop, px)) ?? null;
}

/**
 * A cut-out picture of `look` (`px` device pixels square), or null when a picture it needs cannot
 * be loaded right now (asking again after a while retries). `files` = the pictures to check first.
 */
export function requestThumb(
  look: AvatarLook,
  crop: AvatarCrop,
  px: number,
  files: readonly string[],
  kind: 'item' | 'look',
): Promise<string | null> {
  const key = thumbKey(look, crop, px);
  const have = done.get(key);
  if (have !== undefined) return Promise.resolve(have);
  const run = running.get(key);
  if (run !== undefined) return run;
  const p = enqueue(key, async () => {
    const ok = await Promise.all(files.map(probe));
    if (ok.some((v) => !v)) return null;
    const canvas = await avatarCanvas(look, px, { crop, plate: false });
    return canvasUrl(canvas);
  })
    .then((url) => {
      if (url !== null) {
        done.set(key, url);
        if (kind === 'look') {
          lookKeys.push(key);
          while (lookKeys.length > LOOK_MAX) {
            const old = lookKeys.shift();
            if (old === undefined) break;
            const u = done.get(old);
            done.delete(old);
            if (u !== undefined && u.startsWith('blob:')) URL.revokeObjectURL(u);
          }
        }
      }
      return url;
    })
    .finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

const plates = new Map<string, string>();

/** A plate as a data URL (`px` device pixels square). */
export function plateUrl(bg: number, px: number): string {
  const key = `${bg}|${px}`;
  const have = plates.get(key);
  if (have !== undefined) return have;
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const g = c.getContext('2d');
    if (g !== null) {
      drawPlate(g, bg, px);
      url = c.toDataURL('image/png');
    }
  } catch {
    url = '';
  }
  if (url !== '') plates.set(key, url);
  return url;
}

/** For tests: how many thumbnails are made / waiting. */
export function thumbStats(): {
  made: number;
  waiting: number;
  running: number;
} {
  return { made: done.size, waiting: queue.length, running: busy };
}
