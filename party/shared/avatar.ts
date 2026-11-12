/**
 * Avatar looks: what a guest's Shimi doll wears. Pure data and pure functions, no DOM,
 * importable by the server, the phone and the TV.
 *
 * A look travels as a short string (encodeLook / decodeLook). The pictures and the placement
 * numbers live in the client (client/src/avatar/catalog.ts); this file only knows which id
 * belongs to which slot, and tests/unit/avatar.test.ts checks that against the catalog.
 */

export type AvatarSlot = 'HEAD' | 'EYES' | 'EARS' | 'FACE' | 'NECK';

/** Slots in the order the dressing room shows them. */
export const AVATAR_SLOTS: readonly AvatarSlot[] = ['HEAD', 'EYES', 'EARS', 'FACE', 'NECK'];

/** Number of background plates (bg is 0 .. AVATAR_BG_COUNT - 1). */
export const AVATAR_BG_COUNT = 12;

/** Most hats in a tower (head[0] is worn on the head, the rest stack on it). */
export const AVATAR_MAX_TOWER = 3;

export interface AvatarLook {
  /** 0 to 3 HEAD accessory ids, bottom of the hat tower first. */
  head: number[];
  eyes: number | null;
  ears: number | null;
  face: number | null;
  neck: number | null;
  /** Background plate, 0 .. AVATAR_BG_COUNT - 1. */
  bg: number;
}

/** The 17 accessories of the owner's page: id -> slot. Checked against the catalog by a unit test. */
export const AVATAR_BASE_SLOTS: Readonly<Record<number, AvatarSlot>> = {
  1: 'HEAD',
  2: 'HEAD',
  3: 'HEAD',
  4: 'HEAD',
  5: 'EYES',
  6: 'EARS',
  7: 'NECK',
  8: 'HEAD',
  9: 'EYES',
  10: 'HEAD',
  11: 'FACE',
  12: 'HEAD',
  13: 'EARS',
  14: 'HEAD',
  15: 'NECK',
  16: 'HEAD',
  17: 'HEAD',
};

/** Ids of the 17 original accessories. */
export const AVATAR_BASE_IDS: readonly number[] = Object.keys(AVATAR_BASE_SLOTS).map(Number);

/**
 * Id ranges of the extra accessories. The slot of an extra item is decided by its id alone,
 * so adding a picture never needs a change in this file.
 */
export const AVATAR_ID_RANGES: readonly { from: number; to: number; slot: AvatarSlot }[] = [
  { from: 101, to: 149, slot: 'HEAD' },
  { from: 201, to: 224, slot: 'EYES' },
  { from: 225, to: 249, slot: 'FACE' },
  { from: 301, to: 324, slot: 'EARS' },
  { from: 325, to: 349, slot: 'NECK' },
];

/** Slot of an accessory id, or null when the id can never be an accessory. */
export function slotOfId(id: number): AvatarSlot | null {
  if (!Number.isInteger(id)) return null;
  const base = AVATAR_BASE_SLOTS[id];
  if (base !== undefined) return base;
  for (const r of AVATAR_ID_RANGES) if (id >= r.from && id <= r.to) return r.slot;
  return null;
}

export const DEFAULT_LOOK: Readonly<AvatarLook> = Object.freeze({
  head: Object.freeze([]) as unknown as number[],
  eyes: null,
  ears: null,
  face: null,
  neck: null,
  bg: 0,
});

/** A fresh, mutable copy of the bare doll on plate 0. */
export function defaultLook(): AvatarLook {
  return { head: [], eyes: null, ears: null, face: null, neck: null, bg: 0 };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toKnownSet(knownIds: Iterable<number> | undefined): ReadonlySet<number> | null {
  if (knownIds === undefined) return null;
  return knownIds instanceof Set ? (knownIds as ReadonlySet<number>) : new Set(knownIds);
}

/**
 * A valid look from anything (a client message, a decoded string, garbage). Never throws.
 * - ids that are not integers, are in the wrong slot, or are not in `knownIds` are dropped
 *   (without `knownIds`: every id of the base table and of the extra ranges is accepted);
 * - the hat tower keeps its order, loses duplicates and is cut to AVATAR_MAX_TOWER;
 * - bg outside 0 .. AVATAR_BG_COUNT - 1 becomes 0.
 */
export function sanitizeLook(input: unknown, knownIds?: Iterable<number>): AvatarLook {
  const out = defaultLook();
  if (!isRecord(input)) return out;
  const known = toKnownSet(knownIds);
  const ok = (v: unknown, slot: AvatarSlot): v is number =>
    typeof v === 'number' && slotOfId(v) === slot && (known === null || known.has(v));

  if (Array.isArray(input.head)) {
    for (const v of input.head as unknown[]) {
      if (out.head.length >= AVATAR_MAX_TOWER) break;
      if (ok(v, 'HEAD') && !out.head.includes(v)) out.head.push(v);
    }
  }
  if (ok(input.eyes, 'EYES')) out.eyes = input.eyes;
  if (ok(input.ears, 'EARS')) out.ears = input.ears;
  if (ok(input.face, 'FACE')) out.face = input.face;
  if (ok(input.neck, 'NECK')) out.neck = input.neck;
  const bg = input.bg;
  if (typeof bg === 'number' && Number.isInteger(bg) && bg >= 0 && bg < AVATAR_BG_COUNT) out.bg = bg;
  return out;
}

/** Encoding version (the first field of the string). */
export const AVATAR_ENCODING_VERSION = 1;
/** Longest string encodeLook can produce is 32 characters; anything longer than this is refused. */
export const AVATAR_ENCODED_MAX = 48;

/**
 * Compact string for the wire, URLs and localStorage. Only [0-9.-], at most 32 characters.
 *   "<version>.<bg>.<head ids joined by '-' or 0>.<eyes>.<ears>.<face>.<neck>"   (0 = nothing)
 *   bare doll on plate 0                       -> "1.0.0.0.0.0.0"
 *   crown under a party hat, heart glasses,
 *   moustache, bow, plate 8 (sunburst)         -> "1.8.8-17.9.0.11.7"
 * The look is sanitized first (range rules only), so the result always decodes to itself.
 */
export function encodeLook(look: AvatarLook): string {
  const l = sanitizeLook(look);
  const n = (v: number | null): string => (v === null ? '0' : String(v));
  const head = l.head.length > 0 ? l.head.join('-') : '0';
  return `${AVATAR_ENCODING_VERSION}.${l.bg}.${head}.${n(l.eyes)}.${n(l.ears)}.${n(l.face)}.${n(l.neck)}`;
}

const NUM = /^\d{1,4}$/;

/**
 * The look of an encoded string. Never throws: anything that is not a well-formed version 1
 * string gives the default look, and ids that cannot exist are dropped. Pass `knownIds`
 * (the server's or the catalog's id list) to also drop ids nobody has a picture for.
 */
export function decodeLook(text: unknown, knownIds?: Iterable<number>): AvatarLook {
  if (typeof text !== 'string' || text.length === 0 || text.length > AVATAR_ENCODED_MAX) return defaultLook();
  const parts = text.split('.');
  if (parts.length !== 7 || parts[0] !== String(AVATAR_ENCODING_VERSION)) return defaultLook();
  const num = (s: string | undefined): number | null => (s !== undefined && NUM.test(s) ? Number(s) : null);
  const one = (s: string | undefined): number | null => {
    const v = num(s);
    return v === null || v === 0 ? null : v;
  };
  const headPart = parts[2] ?? '0';
  const head: number[] = [];
  if (headPart !== '0') {
    for (const s of headPart.split('-').slice(0, 8)) {
      const v = num(s);
      if (v !== null) head.push(v);
    }
  }
  return sanitizeLook(
    { head, eyes: one(parts[3]), ears: one(parts[4]), face: one(parts[5]), neck: one(parts[6]), bg: num(parts[1]) ?? 0 },
    knownIds,
  );
}

/** A look given either as an object or as its encoded string. */
export function toLook(look: AvatarLook | string | null | undefined): AvatarLook {
  if (typeof look === 'string') return decodeLook(look);
  return sanitizeLook(look);
}

/** Stable cache key of a look (equal looks give equal keys). */
export function lookKey(look: AvatarLook | string): string {
  return encodeLook(toLook(look));
}

export function looksEqual(a: AvatarLook | string, b: AvatarLook | string): boolean {
  return lookKey(a) === lookKey(b);
}

/** Every accessory id of a look, hats first (bottom of the tower first). */
export function wornIds(look: AvatarLook): number[] {
  const ids = [...look.head];
  for (const v of [look.eyes, look.ears, look.face, look.neck]) if (v !== null) ids.push(v);
  return ids;
}

export function isWearing(look: AvatarLook, id: number): boolean {
  return wornIds(look).includes(id);
}

const SLOT_FIELD = { EYES: 'eyes', EARS: 'ears', FACE: 'face', NECK: 'neck' } as const;

/**
 * The look after putting `id` on (a new object; the input is not changed).
 * EYES / EARS / FACE / NECK: replaces what the slot holds. HEAD: goes on top of the tower;
 * when the tower is full it replaces the top hat. Unknown ids change nothing.
 */
export function wearItem(look: AvatarLook, id: number): AvatarLook {
  const next = sanitizeLook(look);
  const slot = slotOfId(id);
  if (slot === null) return next;
  if (slot === 'HEAD') {
    if (next.head.includes(id)) return next;
    if (next.head.length >= AVATAR_MAX_TOWER) next.head[next.head.length - 1] = id;
    else next.head.push(id);
    return next;
  }
  next[SLOT_FIELD[slot]] = id;
  return next;
}

/** The look after taking `id` off (hats above a removed hat drop down one place). */
export function removeItem(look: AvatarLook, id: number): AvatarLook {
  const next = sanitizeLook(look);
  next.head = next.head.filter((h) => h !== id);
  for (const f of Object.values(SLOT_FIELD)) if (next[f] === id) next[f] = null;
  return next;
}

/** Tap on a shelf item: on when it is off, off when it is on. */
export function toggleItem(look: AvatarLook, id: number): AvatarLook {
  return isWearing(look, id) ? removeItem(look, id) : wearItem(look, id);
}

/** "ניעור": everything off, the plate stays. */
export function shakeOff(look: AvatarLook): AvatarLook {
  return { ...defaultLook(), bg: sanitizeLook(look).bg };
}

/** mulberry32: small deterministic generator (the same one the game kit uses). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed for randomLook from any text (a player id, a name). */
export function seedFromText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // final mix: short, similar texts ("p1", "p2") must not give neighbouring seeds
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A deterministic, well spread look: the same seed and id list always give the same look.
 * About 88% wear a hat (a quarter of those a second one, a few a third), 45% glasses,
 * 28% something on the face, 22% on the ears, 38% on the neck; the plate is any of the 12.
 * Nobody gets a bare doll or a single accessory: a look with fewer than two dressed slots is topped up
 * (that is what keeps 60 random guests apart). `ids` = the accessories to choose from
 * (default: the 17 originals); ids without a slot are ignored.
 */
export function randomLook(seed: number, ids: Iterable<number> = AVATAR_BASE_IDS): AvatarLook {
  const rnd = mulberry32(Math.floor(Number.isFinite(seed) ? seed : 0) ^ 0x5eed5);
  const by: Record<AvatarSlot, number[]> = { HEAD: [], EYES: [], EARS: [], FACE: [], NECK: [] };
  for (const id of new Set(ids)) {
    const slot = slotOfId(id);
    if (slot !== null) by[slot].push(id);
  }
  for (const s of AVATAR_SLOTS) by[s].sort((a, b) => a - b);
  const pick = (list: readonly number[]): number | null =>
    list.length === 0 ? null : (list[Math.floor(rnd() * list.length)] ?? null);
  // every draw happens whatever the outcome, so one slot's list never shifts another slot's choice
  const rHat = rnd();
  const rHat2 = rnd();
  const rHat3 = rnd();
  const hats = [pick(by.HEAD), pick(by.HEAD), pick(by.HEAD)];
  const rEyes = rnd();
  const eyes = pick(by.EYES);
  const rFace = rnd();
  const face = pick(by.FACE);
  const rEars = rnd();
  const ears = pick(by.EARS);
  const rNeck = rnd();
  const neck = pick(by.NECK);
  const bg = Math.floor(rnd() * AVATAR_BG_COUNT);
  const rFill = rnd();

  const look = defaultLook();
  const count = rHat >= 0.88 ? 0 : rHat2 >= 0.25 ? 1 : rHat3 >= 0.3 ? 2 : 3;
  for (let i = 0; i < count; i++) {
    const h = hats[i];
    if (h !== null && h !== undefined && !look.head.includes(h)) look.head.push(h);
  }
  if (rEyes < 0.45) look.eyes = eyes;
  if (rFace < 0.28) look.face = face;
  if (rEars < 0.22) look.ears = ears;
  if (rNeck < 0.38) look.neck = neck;
  look.bg = bg;
  // top up to two accessories, starting from a seeded slot so the extras are spread too
  const fill: readonly ['eyes' | 'neck' | 'face' | 'ears', number | null][] = [['eyes', eyes], ['neck', neck], ['face', face], ['ears', ears]];
  const start = Math.floor(rFill * fill.length);
  // a tower counts once: a client may draw only its first hat (a hat that cannot carry cuts the tower)
  const parts = (): number => (look.head.length > 0 ? 1 : 0) + [look.eyes, look.ears, look.face, look.neck].filter((v) => v !== null).length;
  for (let i = 0; i < fill.length && parts() < 2; i++) {
    const f = fill[(start + i) % fill.length];
    if (f !== undefined && look[f[0]] === null) look[f[0]] = f[1];
  }
  if (parts() < 2 && look.head.length === 0 && hats[0] !== null && hats[0] !== undefined) look.head.push(hats[0]);
  return look;
}

/** What a look wears, without its plate: two guests with the same signature have the same doll. */
export function lookSignature(look: AvatarLook | string): string {
  return lookKey(look).replace(/^\d+\.\d+\./, '');
}

/**
 * randomLook that avoids the dolls already in the room: tries up to 24 seeds derived from `seed`
 * and returns the first whose accessories (plate ignored) nobody in `taken` wears.
 * `taken` = the looks (objects or encoded strings) of the other guests. Deterministic.
 */
export function randomLookAvoiding(
  seed: number,
  taken: Iterable<AvatarLook | string>,
  ids: Iterable<number> = AVATAR_BASE_IDS,
): AvatarLook {
  const list = [...new Set(ids)];
  const used = new Set<string>();
  for (const t of taken) used.add(lookSignature(t));
  const base = Math.floor(Number.isFinite(seed) ? seed : 0);
  let look = randomLook(base, list);
  for (let i = 1; i < 24 && used.has(lookSignature(look)); i++) look = randomLook(base + i * 7919, list);
  return look;
}
