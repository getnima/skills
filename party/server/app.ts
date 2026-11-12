import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import express from 'express';
import { Server } from 'socket.io';

import { remoteFromEnv } from './config';
import { attachSocketHandlers, createRegistry } from './sockets';

import type { Server as HttpServer, ServerResponse } from 'node:http';
import type { Express } from 'express';
import type { ServerConfig } from './config';
import type { RoomRegistry } from './rooms';
import type { PartyServer } from './sockets';

export interface PartyApp {
  readonly http: HttpServer;
  readonly io: PartyServer;
  readonly registry: RoomRegistry;
  /** Directory of the built client being served, or null. */
  readonly clientDir: string | null;
  listen(): Promise<number>;
  close(): Promise<void>;
}

/** dist/client next to the bundle (dist/server/index.mjs), else ./dist/client from the cwd. */
export function findClientDir(): string | null {
  // Under tsx this file sits in server/, where ../client is the SOURCE tree: only trust
  // the sibling when we really are the bundle inside dist/.
  const besideBundle = basename(resolve(import.meta.dirname, '..')) === 'dist' ? resolve(import.meta.dirname, '../client') : undefined;
  const candidates = [process.env.PARTY_CLIENT_DIR, besideBundle, resolve(process.cwd(), 'dist/client')];
  for (const dir of candidates) {
    if (dir !== undefined && dir.length > 0 && existsSync(join(dir, 'index.html'))) return resolve(dir);
  }
  return null;
}

/** Non-internal IPv4 addresses of this machine: what a phone on the same Wi-Fi can reach. */
export function lanIps(): string[] {
  const out: string[] = [];
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const info of list ?? []) {
        if (info.family === 'IPv4' && !info.internal && !out.includes(info.address)) out.push(info.address);
      }
    }
  } catch (err) {
    console.error('[http] could not list network interfaces', err);
  }
  return out;
}

/** True when an Accept-Encoding header allows `coding` (a `q=0` refuses it). */
export function acceptsEncoding(header: string | undefined, coding: string): boolean {
  if (header === undefined) return false;
  for (const part of header.split(',')) {
    const [name, ...params] = part.split(';');
    if (name === undefined || name.trim().toLowerCase() !== coding) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  }
  return false;
}

/**
 * The bundles' compressed copies that the build wrote (tools/assets/compress-dist.mjs:
 * dist/client/assets/<bundle>.js.br / .gz): sent instead of the plain file to a browser
 * that accepts them. Same content, a third of the bytes. Only the hashed top-level
 * bundles (never media: they are compressed already, and video needs byte ranges).
 */
function serveCompressedBundles(app: Express, dir: string): void {
  let encoded: ReadonlySet<string>;
  try {
    encoded = new Set(readdirSync(join(dir, 'assets')).filter((f) => f.endsWith('.br') || f.endsWith('.gz')));
  } catch {
    encoded = new Set();
  }
  if (encoded.size === 0) return;
  const codings = [
    ['br', '.br'],
    ['gzip', '.gz'],
  ] as const;
  app.use('/assets', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const m = /^\/([\w.-]+\.(js|css))$/.exec(req.path);
    if (m === null || m[1] === undefined || m[2] === undefined) return next();
    const name = m[1];
    const type = m[2];
    res.setHeader('Vary', 'Accept-Encoding');
    const accept = req.headers['accept-encoding'];
    const pick = codings.find(([coding, ext]) => encoded.has(name + ext) && acceptsEncoding(typeof accept === 'string' ? accept : undefined, coding));
    if (pick === undefined) return next();
    res.setHeader('Content-Encoding', pick[0]);
    res.type(type);
    res.sendFile(join(dir, 'assets', name + pick[1]), { immutable: true, maxAge: '365d', acceptRanges: false }, (err) => {
      if (err === undefined || res.headersSent) return;
      // the copy is gone: the plain file
      res.removeHeader('Content-Encoding');
      res.removeHeader('Content-Type');
      next();
    });
  });
}

function mountClient(app: Express, dir: string): void {
  const html = (file: string) => (_req: express.Request, res: express.Response): void => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(dir, file));
  };
  // Pretty URLs for the QR code and the TV.
  for (const [route, file] of [
    ['/host', 'host.html'],
    ['/remote', 'remote.html'],
    ['/show', 'show.html'],
    ['/dev', 'dev.html'],
  ] as const) {
    if (existsSync(join(dir, file))) app.get(route, html(file));
  }
  serveCompressedBundles(app, dir);
  // Vite puts its hashed bundles straight in assets/ and copies the public art into
  // sub-folders of the same assets/ (assets/tap/face.webp). A bundle never changes under
  // its name, so it keeps a year of immutable. The art is not hashed and a picture is
  // replaced in place, so it gets five minutes: a reload within them costs no round
  // trips (a phone preloads ~160 pictures), after them the browser revalidates with
  // the ETag / Last-Modified and gets a 304, or the new picture.
  const bundles = resolve(dir, 'assets');
  app.use(
    '/assets',
    express.static(bundles, {
      immutable: true,
      maxAge: '365d',
      index: false,
      fallthrough: false,
      setHeaders: (res: ServerResponse, path: string): void => {
        if (dirname(path) !== bundles) res.setHeader('Cache-Control', 'public, max-age=300');
      },
    }),
  );
  // Everything else (html, audio, fonts, cutscene videos) is replaced in place under
  // the same file name, so it is revalidated on every load. express.static answers
  // Range requests, which video seeking on iOS / Apple TV needs.
  app.use(
    express.static(dir, {
      index: 'index.html',
      acceptRanges: true,
      setHeaders: (res: ServerResponse): void => {
        res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
}

export function createPartyApp(config: ServerConfig): PartyApp {
  const app = express();
  app.disable('x-powered-by');
  const http = createServer(app);
  const io: PartyServer = new Server(http, {
    cors: { origin: config.origins === null ? true : [...config.origins] },
    // Living-room Wi-Fi: straight to websocket, notice a dead phone within ~14s,
    // no per-message compression (tiny payloads; it only costs CPU and latency).
    transports: ['websocket', 'polling'],
    pingInterval: 8_000,
    pingTimeout: 6_000,
    perMessageDeflate: false,
    httpCompression: false,
    maxHttpBufferSize: 64 * 1024,
    serveClient: false,
  });
  const registry = createRegistry(io, { timing: config.timing });
  const defaults = remoteFromEnv({});
  attachSocketHandlers(io, registry, {
    password: config.remotePassword ?? defaults.remotePassword,
    throttle: config.remoteThrottle ?? defaults.remoteThrottle,
  });

  const startedAt = Date.now();
  app.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...registry.stats(), uptime: Math.round((Date.now() - startedAt) / 1000) });
  });

  // The TV page opened on localhost asks for the laptop's LAN address to build a QR phones can open.
  app.get('/api/info', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // Readable from the vite dev origin and from a client hosted on another origin.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ lanIps: lanIps() });
  });

  // Short join link for a designed or printed QR code (tools/qr): it never changes, and it always
  // opens the party's room on a TV (the one with guests in it: a second /host page opened by mistake
  // does not take it). With no TV connected it opens the join page, which asks for the room code.
  // It gives away nothing the TV does not already show.
  app.get('/j', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const code = registry.shortLinkRoom();
    res.redirect(302, code !== null ? `/?room=${encodeURIComponent(code)}` : '/');
  });

  const clientDir = findClientDir();
  if (clientDir !== null) mountClient(app, clientDir);

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) console.error('[http] request failed', err);
    if (res.headersSent) return;
    res.status(status).type('text/plain').send(status === 404 ? 'Not found' : 'Error');
  });

  const sweeper = setInterval(() => {
    try {
      registry.sweep();
    } catch (err) {
      console.error('[rooms] sweep failed', err);
    }
  }, 10 * 60 * 1000);
  sweeper.unref();

  return {
    http,
    io,
    registry,
    clientDir,
    listen: (): Promise<number> =>
      new Promise((resolveListen, reject) => {
        http.once('error', reject);
        http.listen(config.port, '0.0.0.0', () => {
          http.off('error', reject);
          const address = http.address();
          resolveListen(typeof address === 'object' && address !== null ? address.port : config.port);
        });
      }),
    close: async (): Promise<void> => {
      clearInterval(sweeper);
      registry.destroyAll();
      await io.close();
    },
  };
}
