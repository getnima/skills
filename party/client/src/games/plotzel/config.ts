/**
 * The one switch of the Plotzel slot.
 *
 *   mode      'embed'   = the owner's live game (https://plotzel.netlify.app) in an iframe
 *             'builtin' = our own Hebrew word game (the safety net)
 *   embedUrl  the page the iframe loads
 *
 * Priority (highest first):
 *   1. this page load:  ?plotzel=builtin | embed   and   ?plotzelUrl=https://…
 *   2. build time:      VITE_PLOTZEL_MODE=builtin | embed   and   VITE_PLOTZEL_URL=https://…
 *   3. defaults:        embed, https://plotzel.netlify.app
 */
export type PlotzelMode = 'embed' | 'builtin';

export interface PlotzelConfig {
  readonly mode: PlotzelMode;
  /** Absolute http(s) URL, without our query params. */
  readonly embedUrl: string;
}

export const DEFAULT_MODE: PlotzelMode = 'embed';
export const DEFAULT_EMBED_URL = 'https://plotzel.netlify.app';

function parseMode(raw: string | null | undefined): PlotzelMode | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'embed' || v === 'builtin') return v;
  return null;
}

/** Absolute http(s) URL (relative ones resolve against `base`), or null. */
function parseUrl(raw: string | null | undefined, base: string): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  try {
    const url = new URL(v, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function envString(name: 'VITE_PLOTZEL_MODE' | 'VITE_PLOTZEL_URL'): string | undefined {
  const value: unknown = import.meta.env[name];
  return typeof value === 'string' ? value : undefined;
}

/** Resolve the switch for this page load. */
export function resolvePlotzelConfig(search: string = window.location.search, base: string = window.location.href): PlotzelConfig {
  const q = new URLSearchParams(search);
  const mode = parseMode(q.get('plotzel')) ?? parseMode(envString('VITE_PLOTZEL_MODE')) ?? DEFAULT_MODE;
  const embedUrl =
    parseUrl(q.get('plotzelUrl'), base) ?? parseUrl(envString('VITE_PLOTZEL_URL'), base) ?? DEFAULT_EMBED_URL;
  return { mode, embedUrl };
}

/** The iframe URL: embedUrl + seed, embed=1, lang=he and our origin (the bridge's postMessage target). */
export function buildEmbedSrc(embedUrl: string, seed: number, parentOrigin: string = window.location.origin): string {
  const url = new URL(embedUrl);
  url.searchParams.set('seed', String(Math.floor(seed)));
  url.searchParams.set('embed', '1');
  url.searchParams.set('lang', 'he');
  url.searchParams.set('parentOrigin', parentOrigin);
  return url.toString();
}
