/**
 * Looks on the server. A guest's dressed Shimi is a short string (shared/avatar.ts); the
 * server never trusts the text a phone sends: what it stores is `encodeLook(decodeLook(text))`.
 */
import { decodeLook, defaultLook, encodeLook, randomLook, seedFromText, wornIds } from '../shared/avatar';

/** The bare doll on the first plate: what decodeLook answers for anything that is not a look. */
const BARE = encodeLook(defaultLook());

/**
 * The stored form of a look a client sent: always a valid encoded look, or null when the
 * text is not a look at all (not a string, malformed, or nothing in it survived the rules).
 */
export function cleanLook(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const clean = encodeLook(decodeLook(text));
  // decodeLook turns garbage into the bare doll: only the bare doll's own text may give it
  if (clean === BARE && text !== BARE) return null;
  return clean;
}

/** What a doll wears, without its plate: two guests with the same signature look the same. */
function signature(look: string): string {
  return wornIds(decodeLook(look)).join('-');
}

/**
 * The doll of a guest who has not dressed yet: a random look that depends only on the player
 * id and on the dolls already in the room (it tries up to 24 seeds to avoid wearing exactly
 * what somebody else wears). Deterministic: the same id in the same room gives the same doll.
 */
export function startingLook(playerId: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const t of taken) used.add(signature(t));
  const seed = seedFromText(playerId);
  let look = encodeLook(randomLook(seed));
  for (let i = 1; i < 24 && used.has(signature(look)); i++) look = encodeLook(randomLook(seed + i * 7919));
  return look;
}
