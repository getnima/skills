/** Shared color tokens for canvas code. Same values as the CSS variables in base.css. */
export const COLORS = {
  bg: '#150a33',
  bg2: '#2a1263',
  panel: '#24134f',
  ink: '#ffffff',
  dim: '#b9aee0',
  pink: '#ff3d8b',
  yellow: '#ffd23f',
  cyan: '#2de2e6',
  green: '#3ddc84',
  red: '#ff4d5e',
  purple: '#8b5cf6',
  orange: '#ff8a3d',
  blue: '#4d8dff',
} as const satisfies Record<string, string>;

/** Bright colors that look good together (confetti, avatars, placeholder faces). */
export const PARTY_COLORS: readonly string[] = [
  COLORS.pink,
  COLORS.yellow,
  COLORS.cyan,
  COLORS.green,
  COLORS.purple,
  COLORS.orange,
  COLORS.blue,
];

/** Font stack with good Hebrew glyphs on iOS / Android / desktop. Use in ctx.font. */
export const FONT = 'system-ui, -apple-system, "Segoe UI", "Arial Hebrew", "Noto Sans Hebrew", Rubik, Heebo, Arial, sans-serif';

/** ctx.font string, e.g. font(28) → '800 28px system-ui, …'. */
export function font(px: number, weight = 800): string {
  return `${weight} ${px}px ${FONT}`;
}
