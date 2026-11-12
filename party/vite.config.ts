import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// Dev: the client is served by vite and socket.io is proxied to the game server,
// so phones on the LAN only need the vite URL. Ports are overridable so several
// dev stacks can run side by side:
//   PARTY_SERVER_PORT (default 8787)  – game server
//   PARTY_CLIENT_PORT (default 5173)  – vite
// Prod: set VITE_SERVER_URL at build time when the client is hosted on another
// origin than the server (e.g. Firebase Hosting → GCE). Unset = same origin.
const serverPort = Number(process.env.PARTY_SERVER_PORT ?? 8787);
const clientPort = Number(process.env.PARTY_CLIENT_PORT ?? 5173);

export default defineConfig({
  root: resolve(import.meta.dirname, 'client'),
  plugins: [preact()],
  server: {
    host: true,
    port: clientPort,
    strictPort: true,
    proxy: {
      '/socket.io': { target: `http://localhost:${serverPort}`, ws: true, changeOrigin: true },
      // GET /api/info: the laptop's LAN address, for the QR of a TV page opened on localhost
      '/api': { target: `http://localhost:${serverPort}`, changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
    target: ['es2020', 'safari14'],
    rollupOptions: {
      input: {
        player: resolve(import.meta.dirname, 'client/index.html'),
        host: resolve(import.meta.dirname, 'client/host.html'),
        dev: resolve(import.meta.dirname, 'client/dev.html'),
        show: resolve(import.meta.dirname, 'client/show.html'),
        avatar: resolve(import.meta.dirname, 'client/avatar-lab.html'),
      },
    },
  },
});
