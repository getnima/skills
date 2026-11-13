import type { GameId } from './protocol';

/**
 * Cutscenes: short videos played on the TV while every phone is frozen with a
 * "watch the TV" screen. A running game stops for everyone and continues
 * exactly where it was (after a 3-2-1) when the video ends.
 *
 * To add one: drop the video into client/public/cutscenes/ and add an entry
 * below. mp4 (H.264 + AAC) plays everywhere; keep clips short (5-20s).
 * A missing file is not an error: the TV shows a short placeholder card.
 */
export type CutsceneTrigger =
  /** Only from the host's cutscene buttons. */
  | { readonly at: 'manual' }
  /** Right after the host starts this game, before its instructions. */
  | { readonly at: 'before'; readonly gameId: GameId }
  /**
   * In the middle of a game: freezes play when the round clock reaches `atMs`
   * (measured on the game's normal duration; scaled when rounds are shortened).
   * Without `gameId` it applies to every game.
   */
  | { readonly at: 'during'; readonly gameId?: GameId; readonly atMs: number }
  /** When this game's round ends, before the results are revealed. */
  | { readonly at: 'after'; readonly gameId?: GameId }
  /** Before the final podium. */
  | { readonly at: 'final' };

export interface CutsceneDef {
  readonly id: string;
  /** Hebrew label for the host's button and the placeholder card. */
  readonly title: string;
  /** File name inside client/public/cutscenes/. */
  readonly file: string;
  readonly when: CutsceneTrigger;
  /** Automatic triggers fire once per competition unless this is true. */
  readonly repeat?: boolean;
  /** Set false to keep the entry but never fire it automatically. */
  readonly enabled?: boolean;
  /** Line shown on the phones while it plays. Default: "👀 תסתכלו על הטלוויזיה!". */
  readonly phoneText?: string;
}

/**
 * The owner's call (13.11): no videos for now. Nothing plays by itself: not the clip in the middle
 * of שימי טאפ, not the ones before the ninja and before the podium (there are no real videos yet,
 * so the room saw a test clip and placeholder cards). The entries stay, and each one still plays
 * from the TV's video menu (C) or the remote. To bring the automatic ones back: set this to true.
 */
const AUTO = false;

export const CUTSCENES: readonly CutsceneDef[] = [
  { id: 'opening', title: 'פתיחה', file: 'opening.mp4', when: { at: 'manual' } },
  {
    id: 'tap_freeze',
    title: 'עצירה באמצע שימי טאפ',
    file: 'tap_freeze.mp4',
    // 8 s in: the moment the last sprints start by themselves (the start window is 8 s), so every
    // guest is in the middle of a sprint (a sprint is 20 s) and the round cannot have ended early yet
    when: { at: 'during', gameId: 'tap', atMs: 8_000 },
    phoneText: '✋ עוצרים הכל! תסתכלו על הטלוויזיה',
    enabled: AUTO,
  },
  { id: 'before_ninja', title: 'לפני הנינג׳ה', file: 'before_ninja.mp4', when: { at: 'before', gameId: 'ninja' }, enabled: AUTO },
  { id: 'before_podium', title: 'לפני הפודיום', file: 'before_podium.mp4', when: { at: 'final' }, enabled: AUTO },
  { id: 'joker_1', title: 'ג׳וקר 1', file: 'joker_1.mp4', when: { at: 'manual' } },
  { id: 'joker_2', title: 'ג׳וקר 2', file: 'joker_2.mp4', when: { at: 'manual' } },
];

export function findCutscene(id: string): CutsceneDef | undefined {
  return CUTSCENES.find((c) => c.id === id);
}
