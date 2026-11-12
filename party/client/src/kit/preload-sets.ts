/**
 * Which public files each screen loads ahead in the background (kit/preload.ts), and in what
 * order, decided by path. Pure (no DOM, no import.meta): tests/unit/assets.test.ts checks every
 * file under client/public against these rules, so a new folder of art cannot be forgotten, and
 * tests/unit/preload.test.ts checks the lists the engine builds from them.
 *
 *   tv     everything the TV shows: the hosts, the show's stickers, prize and finale, the games'
 *          key art, the doll and every accessory (each guest's look is drawn on the TV), the
 *          sound files (today the air horn and the gong) and the fonts. The cutscene videos are
 *          in the set too, but not in the build-time file list: the TV page adds the one format
 *          its browser plays.
 *   phone  what a phone shows: the dressing room (the doll and every accessory), every game's art,
 *          the key art, the prize, the fonts. Never the hosts, the finale, the sound or the videos:
 *          a phone shows "watch the TV" while a video plays, and the one sound file a phone can
 *          play, the victory song on the winner's phone, is NOT loaded ahead on purpose (one
 *          guest hears it once a night; every phone would fetch a whole song for it).
 *
 * The order is per screen, by what it shows first: the TV opens on the lobby (the show art, the
 * hosts, the key art, the prize), a phone on the dressing room (the doll and the accessories).
 *
 * A rule with no set is a file that is excluded on purpose, with the reason.
 */
import { GAME_IDS } from '../../../shared/protocol';

export type PreloadTarget = 'tv' | 'phone';
export type PreloadKind = 'image' | 'audio' | 'video' | 'font' | 'data';

export interface PreloadRule {
  readonly match: RegExp;
  /** The sets that load the file; empty: never preloaded (see `why`). */
  readonly sets: readonly PreloadTarget[];
  /** Loading order inside each set that has the file: lower first (what that screen shows first). */
  readonly rank?: Partial<Readonly<Record<PreloadTarget, number>>>;
  readonly why: string;
}

const BOTH: readonly PreloadTarget[] = ['tv', 'phone'];
const NONE: readonly PreloadTarget[] = [];
/** The rank of a file no rule ranks (and of an item given without one): after everything ranked. */
export const DEFAULT_RANK = 5;

/** The first rule that matches a public path decides. */
export const PRELOAD_RULES: readonly PreloadRule[] = [
  // ── on purpose: never loaded ahead ──
  { match: /\.md$/i, sets: NONE, why: 'notes for the people who drop files in' },
  { match: /^\/icons\//, sets: NONE, why: 'the browser loads the icons itself (manifest, <link rel=icon>)' },
  { match: /^\/manifest\.webmanifest$/, sets: NONE, why: 'the browser loads the web manifest itself' },
  { match: /^\/assets\/shimi\/faces(_round)?\//, sets: NONE, why: "the owner's face pictures: no screen shows them" },
  {
    match: /^\/assets\/shimi\/prop_\d+_\w+\.\w+$/,
    sets: NONE,
    why: 'the originals of shimi/props/*.webp (what the dressing room shows); the ninja falls back to three of them only while food/gold_falafel is missing',
  },
  {
    match: /^\/assets\/shimi\/(head|body)\.\w+$/,
    sets: NONE,
    why: 'head: the icy / plotzel face only while their own face file is missing; body: no screen shows it',
  },
  { match: /^\/assets\/host\/prize\.jpe?g$/, sets: NONE, why: 'the photo of the prize: the transparent prize picture wins (show/art.ts prizeArt)' },
  // ── the sets ──
  // Ranks, TV: 0 fonts, 1 the lobby (show art, hosts, key art, prize), 2 the guests' dolls, 3 sound, 4 videos.
  // Ranks, phone: 0 fonts, 1 the dressing room (it comes right after the name), 2 key art and prize, 3 the games.
  { match: /^\/fonts\//, sets: BOTH, rank: { tv: 0, phone: 0 }, why: 'every screen' },
  { match: /^\/assets\/host\/prize\.\w+$/, sets: BOTH, rank: { tv: 1, phone: 2 }, why: 'the round prize: on the TV and on the winner phone' },
  { match: /^\/assets\/shimi\/(doll\.\w+|props\/)/, sets: BOTH, rank: { tv: 2, phone: 1 }, why: 'the dressing room on the phone, every guest on the TV' },
  { match: /^\/assets\/intro\//, sets: BOTH, rank: { tv: 1, phone: 2 }, why: 'the key art of each game, on the TV and on the phones' },
  { match: /^\/assets\/hosts?\//, sets: ['tv'], rank: { tv: 1 }, why: "the show: hosts, stickers, finale" },
  { match: new RegExp(`^/assets/(${GAME_IDS.join('|')})/`), sets: ['phone'], rank: { phone: 3 }, why: 'the games run on the phones' },
  { match: /^\/audio\//, sets: ['tv'], rank: { tv: 3 }, why: 'only the TV loads sound files ahead (the winner phone fetches its victory song when it plays it)' },
  { match: /^\/cutscenes\//, sets: ['tv'], rank: { tv: 4 }, why: 'only the TV plays the videos' },
];

/** The rule for a public path ('/assets/tap/fist.webp'), or null when no rule knows the file. */
export function preloadRule(path: string): PreloadRule | null {
  return PRELOAD_RULES.find((r) => r.match.test(path)) ?? null;
}

export function inPreloadSet(path: string, target: PreloadTarget): boolean {
  return preloadRule(path)?.sets.includes(target) ?? false;
}

/** Where a public path stands in a screen's loading order: lower loads first. */
export function preloadRank(path: string, target: PreloadTarget): number {
  return preloadRule(path)?.rank?.[target] ?? DEFAULT_RANK;
}

const IMAGE = /\.(png|webp|jpe?g|svg|gif|avif)$/i;
const AUDIO = /\.(mp3|m4a|ogg|wav|aac|flac)$/i;
const VIDEO = /\.(mp4|m4v|mov|ogv)$/i;
const FONT = /\.(woff2?|ttf|otf)$/i;

export function preloadKind(path: string): PreloadKind {
  if (IMAGE.test(path)) return 'image';
  if (AUDIO.test(path)) return 'audio';
  if (/\.webm$/i.test(path)) return path.startsWith('/audio/') ? 'audio' : 'video';
  if (VIDEO.test(path)) return 'video';
  if (FONT.test(path)) return 'font';
  return 'data';
}

/** A file's expected size before its response says (the progress bar weighs files by bytes). */
export const ESTIMATED_BYTES: Readonly<Record<PreloadKind, number>> = {
  image: 30_000,
  audio: 80_000,
  video: 1_200_000,
  font: 20_000,
  data: 2_000,
};
