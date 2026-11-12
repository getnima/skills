// How alike are 60 random default looks? npx tsx tests/e2e/avatar-review-distinct.ts
import { encodeLook, lookSignature, randomLook, randomLookAvoiding, seedFromText } from '../../shared/avatar';
import { ITEM_IDS, normalizeLook } from '../../client/src/avatar/catalog';

let samePairs = 0, roomsWithDup = 0, bare = 0, sameHead = 0;
for (let seed = 0; seed < 200; seed++) {
  const keys = Array.from({ length: 60 }, (_, i) => encodeLook(normalizeLook(randomLook(seedFromText(`room${seed}-player${i}`), ITEM_IDS))));
  const count = new Map<string, number>();
  for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
  let pairs = 0;
  for (const c of count.values()) pairs += (c * (c - 1)) / 2;
  samePairs += pairs;
  if (pairs > 0) roomsWithDup++;
  bare += keys.filter((k) => /^1\.\d+\.0\.0\.0\.0\.0$/.test(k)).length;
  // same accessories, different plate only
  const noBg = new Map<string, number>();
  for (const k of keys) { const s = k.replace(/^1\.\d+/, ''); noBg.set(s, (noBg.get(s) ?? 0) + 1); }
  for (const c of noBg.values()) sameHead += (c * (c - 1)) / 2;
}
let avoidPairs = 0;
for (let seed = 0; seed < 200; seed++) {
  const room: string[] = [];
  for (let i = 0; i < 60; i++) room.push(encodeLook(randomLookAvoiding(seedFromText(`room${seed}-player${i}`), room, ITEM_IDS)));
  avoidPairs += 60 - new Set(room.map(lookSignature)).size;
}
console.log('with randomLookAvoiding: guests sharing a doll (plate ignored) in 200 rooms of 60:', avoidPairs);
console.log(JSON.stringify({ rooms: 200, guests: 60, identicalPairs: samePairs, roomsWithAnIdenticalPair: roomsWithDup, pairsSameAccessoriesAnyPlate: sameHead, bareDolls: bare, perRoomBare: bare / 200 }));
