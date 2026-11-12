// The games' "how to play": ultra concise steps, the same on the TV and every phone, and the 30 s intro.
import { describe, expect, it } from 'vitest';

import { COUNTDOWN_MS, GAME_IDS, GAMES, INTRO_MS } from '../../shared/protocol';

describe('how to play', () => {
  it('gives every game two or three steps, each an emoji and a few words', () => {
    for (const id of GAME_IDS) {
      const steps = GAMES[id].howTo;
      expect(steps.length, id).toBeGreaterThanOrEqual(2);
      expect(steps.length, id).toBeLessThanOrEqual(3);
      for (const [icon, text] of steps) {
        expect(icon.trim().length, `${id}: ${text}`).toBeGreaterThan(0);
        // ultra concise: read from across the room in one glance
        expect(Array.from(text).length, `${id}: ${text}`).toBeLessThanOrEqual(26);
        expect(text.split(/\s+/).length, `${id}: ${text}`).toBeLessThanOrEqual(5);
        // the icon is a picture, not words
        expect(icon, id).not.toMatch(/[א-תA-Za-z]/);
      }
    }
  });

  it('opens the game 30 s after the intro appears: the instructions, then the 3-2-1', () => {
    expect(INTRO_MS + COUNTDOWN_MS).toBe(30_000);
    expect(COUNTDOWN_MS).toBe(3_000);
  });
});
