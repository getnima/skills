/**
 * Looks on the server. A guest's dressed Shimi is a short string (shared/avatar.ts); the
 * server never trusts the text a phone sends: what it stores is
 * `encodeLook(decodeLook(text, ITEM_IDS))` (client/src/avatar/README.md, "Wiring checklist").
 */
import { ITEM_IDS } from '../client/src/avatar/catalog';
import { AVATAR_ENCODED_MAX, decodeLook, defaultLook, encodeLook, randomLookAvoiding, seedFromText } from '../shared/avatar';

/** Every accessory that has a picture (the catalog is plain data, safe in node). */
const KNOWN_IDS: ReadonlySet<number> = new Set(ITEM_IDS);

/** The bare doll on the first plate: what decodeLook answers for anything that is not a look. */
const BARE = encodeLook(defaultLook());

/**
 * The stored form of a look a client sent: always a valid encoded look (at most 32
 * characters of [0-9.-], only accessories of the catalog), or null when the text is not a
 * look at all (not a string, too long, malformed, or nothing in it survived the rules).
 */
export function cleanLook(text: unknown): string | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > AVATAR_ENCODED_MAX) return null;
  const clean = encodeLook(decodeLook(text, KNOWN_IDS));
  // decodeLook turns garbage into the bare doll: only the bare doll's own text may give it
  if (clean === BARE && text !== BARE) return null;
  return clean;
}

/**
 * The doll of a guest who has not dressed yet: a random look (any accessory of the catalog)
 * that depends only on the player id and on the dolls already in the room, and that nobody
 * in the room wears. Deterministic: the same id in the same room gives the same doll.
 */
export function startingLook(playerId: string, taken: Iterable<string>): string {
  return encodeLook(randomLookAvoiding(seedFromText(playerId), taken, KNOWN_IDS));
}
