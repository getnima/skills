/** A tiny confetti system on one canvas. Draws only while something is in the air. */

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  life: number;
  wobble: number;
}

export interface Confetti {
  /** Shoot from a point (0..1 of the canvas) toward `angle` (radians, 0 = right, -PI/2 = up). */
  shoot(x: number, y: number, count: number, angle?: number, spread?: number, power?: number): void;
  /** Gentle rain from the top edge. */
  rain(count: number): void;
  /** Two cannons from the bottom corners. */
  cannons(count?: number): void;
  readonly count: number;
  dispose(): void;
}

const MAX_PIECES = 420;
/** The party look's colours (client/public/assets/shimi/README.md): flat paper bits. */
const PARTY_COLORS = ['#f2361b', '#1e3fd8', '#ff7eb6', '#ffffff', '#4f6cff', '#ff9f0a', '#16120e'];
const GOLD = ['#ffd21f', '#ffe45a', '#ff9f0a', '#ffffff'];

export function createConfetti(canvas: HTMLCanvasElement, random: () => number): Confetti {
  const ctx = canvas.getContext('2d');
  const pieces: Piece[] = [];
  let raf = 0;
  let last = 0;
  let disposed = false;
  let w = 0;
  let h = 0;

  function fit(): void {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw === w && ch === h) return;
    w = cw;
    h = ch;
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
  }

  function add(p: Piece): void {
    if (pieces.length >= MAX_PIECES) pieces.shift();
    pieces.push(p);
  }

  function make(x: number, y: number, vx: number, vy: number, gold: boolean): Piece {
    const unit = Math.max(0.45, Math.min(w / 1920, 1.4));
    const size = (10 + random() * 14) * unit;
    const palette = gold ? GOLD : PARTY_COLORS;
    return {
      x,
      y,
      vx,
      vy,
      rot: random() * Math.PI * 2,
      vr: (random() - 0.5) * 14,
      w: size,
      h: size * (0.35 + random() * 0.5),
      color: palette[Math.floor(random() * palette.length)] ?? '#ffd23f',
      life: 2.6 + random() * 2.2,
      wobble: random() * Math.PI * 2,
    };
  }

  function frame(t: number): void {
    raf = 0;
    if (disposed || !ctx) return;
    const dt = Math.min(0.05, last === 0 ? 0.016 : (t - last) / 1000);
    last = t;
    fit();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = h * 1.5;
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      if (!p) continue;
      p.life -= dt;
      p.vy += g * dt;
      const drag = Math.pow(0.35, dt);
      p.vx *= drag;
      if (p.vy > h * 0.55) p.vy = h * 0.55; // flutter down, do not plummet
      p.wobble += dt * 6;
      p.x += (p.vx + Math.sin(p.wobble) * 40) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.life <= 0 || p.y > h + 40) {
        pieces.splice(i, 1);
        continue;
      }
      const cos = Math.cos(p.rot);
      const sin = Math.sin(p.rot);
      ctx.setTransform(cos, sin, -sin, cos, p.x, p.y);
      ctx.globalAlpha = Math.min(1, p.life * 1.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, (-p.h / 2) * Math.abs(Math.cos(p.wobble)), p.w, p.h * Math.abs(Math.cos(p.wobble)) + 1);
    }
    ctx.globalAlpha = 1;
    if (pieces.length > 0) raf = requestAnimationFrame(frame);
    else {
      last = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
    }
  }

  function kick(): void {
    if (raf === 0 && !disposed) raf = requestAnimationFrame(frame);
  }

  function shoot(x: number, y: number, count: number, angle = -Math.PI / 2, spread = Math.PI * 2, power = 1): void {
    fit();
    for (let i = 0; i < count; i++) {
      const a = angle + (random() - 0.5) * spread;
      const speed = h * (0.7 + random() * 1.1) * power;
      add(make(x * w, y * h, Math.cos(a) * speed, Math.sin(a) * speed, random() < 0.3));
    }
    kick();
  }

  return {
    shoot,
    rain(count: number): void {
      fit();
      for (let i = 0; i < count; i++) {
        const p = make(random() * w, -20 - random() * h * 0.5, (random() - 0.5) * 120, h * 0.1 + random() * h * 0.2, random() < 0.4);
        p.life += 2;
        add(p);
      }
      kick();
    },
    cannons(count = 90): void {
      shoot(0.02, 1.0, count, -Math.PI * 0.32, 0.7, 1.35);
      shoot(0.98, 1.0, count, -Math.PI * 0.68, 0.7, 1.35);
    },
    get count(): number {
      return pieces.length;
    },
    dispose(): void {
      disposed = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      pieces.length = 0;
    },
  };
}
