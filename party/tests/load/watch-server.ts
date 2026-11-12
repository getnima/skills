/**
 * Watch a running Party Arena server while a load runs: its CPU and memory (from /proc, Linux),
 * and how fast it answers (a socket that pings every 100 ms: the round trip is the event loop's
 * delay plus the network, so on the same machine it is the server's responsiveness).
 *
 *   npx tsx tests/load/watch-server.ts --pid <server pid> [--url http://localhost:8787] [--seconds 600]
 *
 * Prints one line every 10 s and a summary at the end (or on Ctrl-C).
 */
import { readFileSync } from 'node:fs';

import { io } from 'socket.io-client';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : fallback;
};
const pid = Number(arg('--pid', '0'));
const url = arg('--url', 'http://localhost:8787');
const seconds = Number(arg('--seconds', '600'));
if (!Number.isInteger(pid) || pid <= 0) throw new Error('--pid <server pid> is required');

const TICKS = 100; // USER_HZ on Linux
function cpuTicks(): number {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return Number(f[11]) + Number(f[12]); // utime + stime
}
function rssMb(): number {
  const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
  return m ? Number(m[1]) / 1024 : 0;
}

const cpu: number[] = [];
const rss: number[] = [];
const rtt: number[] = [];
let lost = 0;
const q = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};

const socket = io(url, { transports: ['websocket'], forceNew: true });
const pinger = setInterval(() => {
  if (!socket.connected) return;
  const t0 = performance.now();
  let done = false;
  const timer = setTimeout(() => {
    if (!done) lost++;
  }, 2_000);
  socket.emit('time:ping', Date.now(), () => {
    done = true;
    clearTimeout(timer);
    rtt.push(performance.now() - t0);
  });
}, 100);

let lastTicks = cpuTicks();
let lastAt = performance.now();
const started = Date.now();
let window: number[] = [];
const sampler = setInterval(() => {
  try {
    const t = cpuTicks();
    const at = performance.now();
    const pct = ((t - lastTicks) / TICKS / ((at - lastAt) / 1000)) * 100;
    lastTicks = t;
    lastAt = at;
    cpu.push(pct);
    rss.push(rssMb());
    window.push(pct);
    if (window.length >= 10) {
      const recent = rtt.slice(-100);
      console.log(
        `[${Math.round((Date.now() - started) / 1000)}s] cpu avg ${(window.reduce((a, b) => a + b, 0) / window.length).toFixed(1)}% max ${Math.max(...window).toFixed(1)}%  rss ${rssMb().toFixed(0)} MB  ping p50 ${q(recent, 0.5).toFixed(1)} p99 ${q(recent, 0.99).toFixed(1)} max ${Math.max(0, ...recent).toFixed(1)} ms`,
      );
      window = [];
    }
  } catch {
    finish('the server process is gone');
  }
}, 1_000);

function finish(why: string): void {
  clearInterval(pinger);
  clearInterval(sampler);
  socket.disconnect();
  const avg = cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : 0;
  console.log(`\n${why}. ${cpu.length} s watched.`);
  console.log(`server cpu (% of one core): avg ${avg.toFixed(1)}  p95 ${q(cpu, 0.95).toFixed(1)}  max ${Math.max(0, ...cpu).toFixed(1)}`);
  console.log(`server memory (RSS): start ${(rss[0] ?? 0).toFixed(0)} MB, max ${Math.max(0, ...rss).toFixed(0)} MB, end ${(rss[rss.length - 1] ?? 0).toFixed(0)} MB`);
  console.log(`ping round trip: n=${rtt.length} p50 ${q(rtt, 0.5).toFixed(1)}  p95 ${q(rtt, 0.95).toFixed(1)}  p99 ${q(rtt, 0.99).toFixed(1)}  max ${Math.max(0, ...rtt).toFixed(1)} ms; unanswered ${lost}`);
  process.exit(0);
}
setTimeout(() => finish('time is up'), seconds * 1000);
process.on('SIGINT', () => finish('stopped'));
process.on('SIGTERM', () => finish('stopped'));
