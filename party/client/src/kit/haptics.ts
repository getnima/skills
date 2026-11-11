/** Vibration helpers. No-ops where unsupported (every iPhone) and never throw. */

let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function vibrate(pattern: number | number[]): void {
  if (!enabled) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    // unsupported or blocked: ignore
  }
}

export const haptic = {
  /** Barely-there tick for a tap. */
  tap: (): void => vibrate(8),
  /** A solid bump (hit, slice, landing). */
  bump: (): void => vibrate(22),
  /** Heavy thud (bomb, death). */
  heavy: (): void => vibrate([60, 30, 90]),
  success: (): void => vibrate([18, 40, 18, 40, 40]),
  fail: (): void => vibrate([90, 50, 90]),
} as const;
