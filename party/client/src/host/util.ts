import { useEffect, useState } from 'preact/hooks';

import { getAudioContext, isMuted, onMuteChange } from '../kit/audio';
import { serverUrl } from '../net/connection';

import type { ServerClock } from '../net/connection';

/** Re-renders every animation frame while `active` and returns the server time. */
export function useServerNow(clock: ServerClock, active = true): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = (): void => {
      setTick((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return clock.now();
}

export interface JoinInfo {
  readonly base: string;
  readonly url: string;
  /** The URL points at this machine only: phones cannot reach it. */
  readonly local: boolean;
}

function isLocalHostname(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
}

/** ?join= on the TV page, then VITE_PUBLIC_URL at build time; null when neither is set. */
function forcedBase(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('join');
  if (fromQuery !== null && fromQuery.trim().length > 0) return fromQuery.trim();
  const fromEnv = import.meta.env.VITE_PUBLIC_URL as string | undefined;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return fromEnv.trim();
  return null;
}

let lanIpsOnce: Promise<readonly string[]> | null = null;

/** The server's LAN addresses (GET /api/info → { lanIps }); [] when the route is missing or fails. */
function fetchLanIps(): Promise<readonly string[]> {
  lanIpsOnce ??= (async (): Promise<readonly string[]> => {
    try {
      const res = await fetch(`${serverUrl().replace(/\/+$/, '')}/api/info`, { cache: 'no-store' });
      if (!res.ok) return [];
      const body: unknown = await res.json();
      if (typeof body !== 'object' || body === null) return [];
      const ips = (body as { lanIps?: unknown }).lanIps;
      return Array.isArray(ips) ? ips.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
    } catch {
      return [];
    }
  })();
  return lanIpsOnce;
}

/** How often a TV asks where the short link leads (lobby only; one tiny request). */
const SHORT_LINK_POLL_MS = 4_000;

/**
 * True while the server says the short link (/j) opens THIS room. False until the first answer,
 * on any failure, and while `on` is false (nothing is asked then).
 */
export function useShortLinkIsMine(code: string, on: boolean): boolean {
  const [mine, setMine] = useState(false);
  useEffect(() => {
    if (!on) {
      setMine(false);
      return undefined;
    }
    let alive = true;
    const ask = async (): Promise<void> => {
      let answer = false;
      try {
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const giveUp = setTimeout(() => ctrl?.abort(), 3_000);
        const res = await fetch(`${serverUrl().replace(/\/+$/, '')}/api/short-link`, { cache: 'no-store', signal: ctrl?.signal ?? null });
        clearTimeout(giveUp);
        if (res.ok) {
          const body: unknown = await res.json();
          answer = typeof body === 'object' && body !== null && (body as { code?: unknown }).code === code;
        }
      } catch {
        answer = false;
      }
      if (alive) setMine(answer);
    };
    void ask();
    const timer = setInterval(() => void ask(), SHORT_LINK_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [code, on]);
  return mine;
}

function buildJoinInfo(rawBase: string, code: string): JoinInfo {
  const base = rawBase.replace(/\/+$/, '');
  let local = false;
  try {
    local = isLocalHostname(new URL(base).hostname);
  } catch {
    local = false;
  }
  return { base, url: `${base}/?room=${encodeURIComponent(code)}`, local };
}

/** True when the TV page itself was opened on this machine's loopback address. */
function pageIsLocal(): boolean {
  return isLocalHostname(window.location.hostname);
}

/**
 * The address the QR points at: ?join=, then VITE_PUBLIC_URL, then (a TV page
 * opened on localhost) the laptop's first LAN address from the server with the
 * page's port, else the page's own origin. `pending` while the LAN lookup runs.
 */
export function useJoinInfo(code: string): JoinInfo & { readonly pending: boolean } {
  const forced = forcedBase();
  const needLan = forced === null && pageIsLocal();
  const [lan, setLan] = useState<readonly string[] | null>(null);
  useEffect(() => {
    if (!needLan) return undefined;
    let alive = true;
    void fetchLanIps().then((ips) => {
      if (alive) setLan(ips);
    });
    return () => {
      alive = false;
    };
  }, [needLan]);
  if (forced !== null) return { ...buildJoinInfo(forced, code), pending: false };
  if (!needLan) return { ...buildJoinInfo(window.location.origin, code), pending: false };
  const ip = lan?.[0];
  if (ip !== undefined) {
    const host = ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip;
    const port = window.location.port;
    return { ...buildJoinInfo(`http://${host}${port !== '' ? `:${port}` : ''}`, code), pending: false };
  }
  return { ...buildJoinInfo(window.location.origin, code), pending: lan === null };
}

/** The URL without the scheme, for display. */
export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export function useMuted(): boolean {
  const [muted, setMutedState] = useState(isMuted());
  useEffect(() => onMuteChange(setMutedState), []);
  return muted;
}

/** True until the browser lets us make sound (the first click / key unlocks it). */
export function useAudioLocked(): boolean {
  const read = (): boolean => {
    const ctx = getAudioContext();
    return ctx === null || ctx.state !== 'running';
  };
  const [locked, setLocked] = useState(read);
  useEffect(() => {
    const ctx = getAudioContext();
    const update = (): void => setLocked(read());
    ctx?.addEventListener('statechange', update);
    const timer = setInterval(update, 1_000);
    return () => {
      ctx?.removeEventListener('statechange', update);
      clearInterval(timer);
    };
  }, []);
  return locked;
}
