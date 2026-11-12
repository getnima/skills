/**
 * Picture slots of the TV show: client/public/assets/host/<slot>.<png|webp|jpg|jpeg|svg>.
 * A dropped-in file replaces the placeholder with no code change (see the
 * README in that folder). Everything here is sync and cached: a missing file
 * costs no request.
 */
import { assetFileUrl, crownPainter, drawFace, paintDrawable } from '../../kit/assets';

import type { GameId } from '../../../../shared/protocol';
import type { FaceExpression, Painter } from '../../kit/assets';

const GROUP = 'host';

export const MASCOT_MOODS = ['normal', 'happy', 'shocked', 'laugh', 'angry'] as const;
export type MascotMood = (typeof MASCOT_MOODS)[number];

export const STICKER_COUNT = 8;

/** A picture (real file or painted placeholder) or a built-in emoji. */
export type StickerArt = { readonly kind: 'img'; readonly url: string } | { readonly kind: 'emoji'; readonly char: string };

const cache = new Map<string, string>();

function painted(key: string, painter: Painter, w: number, h: number = w): string {
  let url = cache.get(key);
  if (url === undefined) {
    url = paintDrawable(key, painter, w, h).url;
    cache.set(key, url);
  }
  return url;
}

const MOOD_FACE: Readonly<Record<MascotMood, FaceExpression>> = {
  normal: 'normal',
  happy: 'happy',
  shocked: 'shocked',
  laugh: 'laughing',
  angry: 'angry',
};

/** Placeholder commentator: a generic cartoon face with a headset and a microphone. */
function mascotPainter(mood: MascotMood): Painter {
  return (ctx, w, h) => {
    const cx = w / 2;
    const cy = h * 0.54;
    const r = w * 0.36;
    // headband
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2b1436';
    ctx.lineWidth = w * 0.075;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.12, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.strokeStyle = '#ff3d8b';
    ctx.lineWidth = w * 0.045;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.12, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    drawFace(ctx, cx, cy, r, MOOD_FACE[mood], mood === 'angry' ? '#ff8a5c' : '#ffc93c');

    // ear cups
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#2b1436';
      ctx.beginPath();
      ctx.ellipse(cx + side * r * 1.06, cy + r * 0.05, r * 0.2, r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff3d8b';
      ctx.beginPath();
      ctx.ellipse(cx + side * r * 1.08, cy + r * 0.05, r * 0.11, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // microphone boom
    ctx.strokeStyle = '#2b1436';
    ctx.lineWidth = w * 0.028;
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.06, cy + r * 0.3);
    ctx.quadraticCurveTo(cx - r * 1.0, cy + r * 1.02, cx - r * 0.42, cy + r * 0.96);
    ctx.stroke();
    ctx.fillStyle = '#2b1436';
    ctx.beginPath();
    ctx.arc(cx - r * 0.36, cy + r * 0.95, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2de2e6';
    ctx.beginPath();
    ctx.arc(cx - r * 0.39, cy + r * 0.92, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
  };
}

/** Placeholder prize: a generic cartoon angel figurine (used only when no prize file exists at all). */
const angelPainter: Painter = (ctx, w, h) => {
  const cx = w / 2;
  // wings
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#c9c2e8';
  ctx.lineWidth = w * 0.012;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * w * 0.08, h * 0.52);
    ctx.bezierCurveTo(cx + side * w * 0.5, h * 0.3, cx + side * w * 0.52, h * 0.62, cx + side * w * 0.12, h * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // base
  ctx.fillStyle = '#f4f1ff';
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.93, w * 0.26, h * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // body
  ctx.fillStyle = '#ffd0b0';
  ctx.strokeStyle = '#2b1436';
  ctx.lineWidth = w * 0.014;
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.72, w * 0.13, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // head
  drawFace(ctx, cx, h * 0.38, w * 0.24, 'happy', '#ffc93c');
  // halo
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = w * 0.03;
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.1, w * 0.17, h * 0.03, 0, 0, Math.PI * 2);
  ctx.stroke();
};

export function mascotUrl(mood: MascotMood): string {
  return assetFileUrl(GROUP, `mascot_${mood}.png`) ?? painted(`mascot_${mood}`, mascotPainter(mood), 256);
}

export type HostDoll = 'a' | 'b';

/** The two party hosts as dolls (client/public/assets/hosts): the whole figure. Null when the file is missing. */
export function hostDollUrl(who: HostDoll): string | null {
  return assetFileUrl('hosts', `host_${who}.png`);
}

/** The host's head only (a square, cut at the chin). Null when the file is missing. */
export function hostHeadUrl(who: HostDoll): string | null {
  return assetFileUrl('hosts', `host_${who}_head.png`);
}

/**
 * A host in a narrating pose (client/public/assets/hosts/poses/<a|b>_<pose>.webp): the whole
 * figure, transparent. Null when that file is missing (the narrator then shows the head).
 */
export function hostPoseUrl(who: HostDoll, pose: string): string | null {
  return assetFileUrl('hosts/poses', `${who}_${pose}.webp`);
}

/**
 * The commentator's picture for a line. A dropped-in mascot_<mood> file wins; without one the
 * two hosts take turns at the microphone (`turn` counts the lines); with no host pictures
 * either, the painted face.
 */
export function commentatorUrl(mood: MascotMood, turn: number): string {
  const file = assetFileUrl(GROUP, `mascot_${mood}.png`);
  if (file !== null) return file;
  const head = hostHeadUrl(turn % 2 === 0 ? 'a' : 'b') ?? hostHeadUrl('a') ?? hostHeadUrl('b');
  return head ?? mascotUrl(mood);
}

/** Every commentator picture that may be shown, to warm the cache. */
export function commentatorUrls(): string[] {
  const urls = new Set<string>();
  for (const mood of MASCOT_MOODS) for (const turn of [0, 1]) urls.add(commentatorUrl(mood, turn));
  return [...urls];
}

const STICKER_EMOJI: readonly string[] = ['🤣', '🔥', '🚀', '🐔', '💥', '🤯', '👑', '🦄'];

/** sticker_1 .. sticker_8: the real picture when it exists, else a built-in emoji. */
export function stickerArt(index: number): StickerArt {
  const i = ((Math.floor(index) % STICKER_COUNT) + STICKER_COUNT) % STICKER_COUNT;
  const url = assetFileUrl(GROUP, `sticker_${i + 1}.png`);
  if (url !== null) return { kind: 'img', url };
  return { kind: 'emoji', char: STICKER_EMOJI[i] ?? '🎉' };
}

export function crownUrl(): string {
  return assetFileUrl(GROUP, 'crown.png') ?? painted('crown', crownPainter, 128);
}

export function lastPlaceArt(): StickerArt {
  const url = assetFileUrl(GROUP, 'last_place.png');
  return url !== null ? { kind: 'img', url } : { kind: 'emoji', char: '🐌' };
}

export interface PrizeArt {
  readonly url: string;
  /**
   * True for a picture with a transparent background (png / webp / svg): it is
   * shown whole, floating in the light. False for a photo (jpg): it is cropped
   * around the middle and set in the arched frame.
   */
  readonly cutout: boolean;
}

/** The round prize. prize.png (transparent) wins over prize.jpg; with no file at all a cartoon angel is painted. */
export function prizeArt(): PrizeArt {
  const url = assetFileUrl(GROUP, 'prize.png');
  if (url === null) return { url: painted('prize', angelPainter, 300, 400), cutout: true };
  const photo = /\.jpe?g($|\?)/i.test(url);
  return { url, cutout: !photo };
}

export type IntroArtId = GameId | 'show';

/**
 * The key art that announces a game: client/public/assets/intro/<gameId>.webp (any picture
 * extension works, the base name is what counts) and show.webp, Shimi as the show's host.
 * Transparent cut-outs, longest side 768 px. Null while the file is not there: the kit knows
 * the file list at build time, so a missing picture costs no request and no 404, and the
 * screen shows the game's emoji instead.
 */
export function introArtUrl(id: IntroArtId): string | null {
  return assetFileUrl('intro', `${id}.webp`);
}

let introArtWarm = false;

/** Fetch the pictures that exist once, ahead of the first intro, so none pops in late. */
export function preloadIntroArt(): void {
  if (introArtWarm) return;
  introArtWarm = true;
  for (const id of ['show', 'tap', 'icy', 'flappy', 'plotzel', 'ninja'] as const) {
    const url = introArtUrl(id);
    if (url === null) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}

/**
 * The designed QR code (tools/qr): client/public/assets/host/qr.png, a fixed picture of the
 * short join link. Null when the file is not there. The lobby shows it only after qr.json
 * next to it vouches that it encodes this very origin (lobby.tsx).
 */
export function designedQrUrl(): string | null {
  return assetFileUrl(GROUP, 'qr.png');
}

/** Optional decoration on the podium block of place 1 / 2 / 3. */
export function podiumUrl(place: 1 | 2 | 3): string | null {
  return assetFileUrl(GROUP, `podium_${place}.png`);
}

/** Optional backdrop behind every scene. */
export function backdropUrl(): string | null {
  return assetFileUrl(GROUP, 'bg_show.jpg');
}

