/**
 * Body physics of "אייסי שימי", pure and screen-independent: world units,
 * one call = one fixed kit step (1/60 s). The game (index.ts) calls stepBody
 * once per step and turns the returned events into sound / particles / score;
 * the QA bots call the same function (window.__icy.predict) to plan moves, so
 * what they test is exactly what the guests play.
 */
import { clamp } from '../../kit/fx';
import { INNER_L, INNER_R, floorAtOrBelow } from './level';

import type { Level } from './level';

/** Radius of the head. */
export const R = 22;
export const GRAVITY = 2400;
export const JUMP_V0 = 820;
export const JUMP_K1 = 0.5;
export const JUMP_K2 = 0.0006;
export const ACC_GROUND = 1800;
export const ACC_AIR = 1000;
/** Pushing against the current direction turns around faster. */
export const TURN_MULT = 2.2;
export const MAX_VX = 780;
/** Ice: very little friction once the side is released. */
export const FRICTION = 360;
export const AIR_DRAG = 0.08;
export const MAX_FALL = 1750;
/** Share of the speed a wall gives back. */
export const WALL_KEEP = 0.97;
export const WALL_KICK_MIN_VX = 360;
export const WALL_KICK_VY = 130;
/** How far past a floor's end the face still stands on / lands on it (share of R). */
export const EDGE = 0.5;
/** Coyote time: steps after sliding off a floor's end in which a jump still works. */
export const COYOTE_STEPS = 6;

export interface Body {
  x: number;
  /** Altitude of the feet. */
  py: number;
  vx: number;
  vy: number;
  /** Floor index the body stands on, -1 = in the air. */
  grounded: number;
  /** Floor of the last take-off / landing. */
  lastFloor: number;
  /** Steps of coyote time left after sliding off a floor (0 = none). */
  coyote: number;
}

export interface StepEvents {
  /** Jumped this step (from the ground, after a landing, or in coyote time). */
  jumped: boolean;
  /** |vx| at the take-off (jump power). */
  jumpPower: number;
  /** Floor landed on this step, -1 = none. */
  landed: number;
  /** Floors climbed by that landing (landed - floor of the take-off). */
  landedDelta: number;
  /** Downward speed at the landing. */
  impact: number;
  /** -1 / 1 = bounced off the left / right wall this step, 0 = no. */
  wall: number;
  /** |vx| when the wall was hit. */
  wallSpeed: number;
  /** The wall bounce was in the air and fast enough to kick upwards. */
  wallKick: boolean;
}

export function createBody(): Body {
  return { x: (INNER_L + INNER_R) / 2, py: 0, vx: 0, vy: 0, grounded: 0, lastFloor: 0, coyote: 0 };
}

export function copyBody(from: Body, to: Body): Body {
  to.x = from.x;
  to.py = from.py;
  to.vx = from.vx;
  to.vy = from.vy;
  to.grounded = from.grounded;
  to.lastFloor = from.lastFloor;
  to.coyote = from.coyote;
  return to;
}

export function createEvents(): StepEvents {
  return { jumped: false, jumpPower: 0, landed: -1, landedDelta: 0, impact: 0, wall: 0, wallSpeed: 0, wallKick: false };
}

/** Take-off speed for a horizontal speed |vx|. */
export function jumpSpeed(power: number): number {
  return JUMP_V0 + JUMP_K1 * power + JUMP_K2 * power * power;
}

function takeOff(b: Body, ev: StepEvents): void {
  const power = Math.abs(b.vx);
  b.vy = jumpSpeed(power);
  if (b.grounded >= 0) b.lastFloor = b.grounded;
  b.grounded = -1;
  b.coyote = 0;
  ev.jumped = true;
  ev.jumpPower = power;
}

/**
 * One fixed step. `dir` = side pushed (-1 left, 0 none, 1 right); `held` = a
 * side is held (auto-jump on every landing); `wantJump` = held or a buffered
 * tap. Mutates `b`, fills and returns `ev`.
 */
export function stepBody(b: Body, dir: number, held: boolean, wantJump: boolean, level: Level, dt: number, ev: StepEvents): StepEvents {
  ev.jumped = false;
  ev.jumpPower = 0;
  ev.landed = -1;
  ev.landedDelta = 0;
  ev.impact = 0;
  ev.wall = 0;
  ev.wallSpeed = 0;
  ev.wallKick = false;

  // horizontal: icy inertia
  if (dir !== 0) {
    let acc = b.grounded >= 0 ? ACC_GROUND : ACC_AIR;
    if (b.vx !== 0 && Math.sign(b.vx) !== dir) acc *= TURN_MULT;
    b.vx = clamp(b.vx + dir * acc * dt, -MAX_VX, MAX_VX);
  } else if (b.grounded >= 0) {
    const f = FRICTION * dt;
    b.vx = Math.abs(b.vx) <= f ? 0 : b.vx - Math.sign(b.vx) * f;
  } else {
    b.vx *= 1 - AIR_DRAG * dt;
  }

  // jump: from the ground, or just after sliding off a floor's end (coyote time)
  if (wantJump && (b.grounded >= 0 || b.coyote > 0)) {
    if (b.grounded < 0) b.py = level.alt[b.lastFloor] ?? b.py;
    takeOff(b, ev);
  }
  if (b.coyote > 0) b.coyote--;

  const fromPy = b.py;
  if (b.grounded < 0) {
    b.vy = Math.max(-MAX_FALL, b.vy - GRAVITY * dt);
    b.py += b.vy * dt;
  }
  b.x += b.vx * dt;

  // side walls bounce back, keeping the speed (wall kicks)
  const minX = INNER_L + R;
  const maxX = INNER_R - R;
  if (b.x < minX || b.x > maxX) {
    const hitLeft = b.x < minX;
    b.x = hitLeft ? minX + (minX - b.x) : maxX - (b.x - maxX);
    const speed = Math.abs(b.vx);
    b.vx = (hitLeft ? 1 : -1) * speed * WALL_KEEP;
    ev.wall = hitLeft ? -1 : 1;
    ev.wallSpeed = speed;
    if (b.grounded < 0 && speed >= WALL_KICK_MIN_VX) {
      b.vy = Math.min(b.vy + WALL_KICK_VY, Math.max(b.vy, JUMP_V0));
      ev.wallKick = true;
    }
  }

  // slid off the end of a floor
  if (b.grounded >= 0) {
    const fx0 = level.x[b.grounded] ?? 0;
    const fh = level.half[b.grounded] ?? 0;
    if (Math.abs(b.x - fx0) > fh + R * EDGE) {
      b.lastFloor = b.grounded;
      b.grounded = -1;
      b.vy = 0;
      b.coyote = COYOTE_STEPS;
    }
  }

  // one-way floors: land when the feet cross a floor top on the way down
  if (b.grounded < 0 && b.vy <= 0) {
    let j = floorAtOrBelow(level, fromPy);
    while (j >= 0) {
      const a = level.alt[j] ?? 0;
      if (a < b.py) break;
      if (Math.abs(b.x - (level.x[j] ?? 0)) <= (level.half[j] ?? 0) + R * EDGE) {
        ev.landed = j;
        ev.landedDelta = j - b.lastFloor;
        ev.impact = -b.vy;
        b.py = a;
        b.vy = 0;
        b.grounded = j;
        b.lastFloor = j;
        b.coyote = 0;
        if (held) takeOff(b, ev);
        break;
      }
      j--;
    }
  }
  return ev;
}
