import { useEffect, useRef, useState } from 'preact/hooks';

import { getAudioContext, isMuted, onMuteChange } from '../kit/audio';
import { playTrack, stopTrack } from '../kit/music';

import type { Phase } from '../../../shared/protocol';
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

function publicBase(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('join');
  if (fromQuery !== null && fromQuery.trim().length > 0) return fromQuery.trim();
  const fromEnv = import.meta.env.VITE_PUBLIC_URL as string | undefined;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return fromEnv.trim();
  return window.location.origin;
}

export function joinInfo(code: string): JoinInfo {
  const base = publicBase().replace(/\/+$/, '');
  let local = false;
  try {
    const host = new URL(base).hostname;
    local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost');
  } catch {
    local = false;
  }
  return { base, url: `${base}/?room=${encodeURIComponent(code)}`, local };
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

type BedTrack = 'lobby' | 'round';

/**
 * Background songs of the host: lobby.mp3 in the lobby, round.mp3 from the
 * intro to the end of play. Quiet, looped, silent when the file is absent,
 * faded on every change, and off during cutscenes and the results / podium
 * (the show scenes play the victory and final songs themselves).
 */
export function useBedMusic(phase: Phase | null, cutscene: boolean): void {
  const current = useRef<BedTrack | null>(null);
  let want: BedTrack | null = null;
  if (!cutscene && phase !== null) {
    if (phase === 'lobby') want = 'lobby';
    else if (phase === 'intro' || phase === 'countdown' || phase === 'playing') want = 'round';
  }
  useEffect(() => {
    if (current.current === want) return;
    if (current.current !== null) stopTrack(current.current, 900);
    current.current = want;
    if (want !== null) playTrack(want, { loop: true, volume: want === 'lobby' ? 0.4 : 0.3, fallback: 'none' });
  }, [want]);
  useEffect(
    () => () => {
      if (current.current !== null) stopTrack(current.current, 300);
    },
    [],
  );
}
