import { io } from 'socket.io-client';

import { tapRoundFeed } from './round-feed';

import type { Socket } from 'socket.io-client';
import type { C2S, S2C } from '../../../shared/protocol';

export type PartySocket = Socket<S2C, C2S>;

/**
 * Same origin by default (vite proxies /socket.io in dev; the server serves the
 * client in single-origin prod). Set VITE_SERVER_URL at build time when the
 * client is hosted elsewhere (e.g. Firebase Hosting → GCE).
 */
export function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  return fromEnv && fromEnv.length > 0 ? fromEnv : window.location.origin;
}

export function connect(): PartySocket {
  const socket: PartySocket = io(serverUrl(), {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 300,
    reconnectionDelayMax: 2_000,
    timeout: 8_000,
  });
  tapRoundFeed(socket);
  return socket;
}

/**
 * Server clock estimate. `now()` returns server epoch ms; all round timing
 * (`startAt` / `endAt`) is compared against it, never against Date.now().
 */
export interface ServerClock {
  now(): number;
  /** Take a few ping samples and keep the one with the lowest round trip. */
  sync(samples?: number): Promise<void>;
  /**
   * A server timestamp that just arrived (e.g. RoomState.serverNow). Used only
   * until the first ping answered, so a phone whose own clock is hours off never
   * reads a round with its raw clock.
   */
  hint(serverNow: number): void;
  /** True once at least one ping sample was taken. */
  readonly synced: boolean;
}

export function createServerClock(socket: PartySocket): ServerClock {
  let offset = 0;
  let bestRtt = Number.POSITIVE_INFINITY;
  let sampled = false;

  function sample(): Promise<void> {
    return new Promise((resolve) => {
      const sentAt = Date.now();
      const timer = setTimeout(resolve, 2_000);
      socket.emit('time:ping', sentAt, (res) => {
        clearTimeout(timer);
        const rtt = Date.now() - sentAt;
        if (rtt < bestRtt) {
          bestRtt = rtt;
          offset = res.serverNow + rtt / 2 - Date.now();
          sampled = true;
        }
        resolve();
      });
    });
  }

  return {
    now: (): number => Date.now() + offset,
    async sync(samples = 5): Promise<void> {
      // A reconnect (or a long sleep) can land on a different network path: start over.
      bestRtt = Number.POSITIVE_INFINITY;
      for (let i = 0; i < samples; i++) await sample();
    },
    hint(serverNow: number): void {
      if (sampled || !Number.isFinite(serverNow)) return;
      offset = serverNow - Date.now();
    },
    get synced(): boolean {
      return sampled;
    },
  };
}
