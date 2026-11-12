import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AVATAR_BASE_IDS, AVATAR_BASE_SLOTS, AVATAR_BG_COUNT, AVATAR_ENCODED_MAX, AVATAR_ID_RANGES, AVATAR_MAX_TOWER, AVATAR_SLOTS,
  DEFAULT_LOOK, decodeLook, defaultLook, encodeLook, isWearing, lookKey, looksEqual, randomLook, removeItem, sanitizeLook,
  seedFromText, shakeOff, slotOfId, toggleItem, wearItem, wornIds,
} from '../../shared/avatar';
import {
  AVATAR_BGS, BASE_ITEMS, CATALOG_PARTS, CATALOG_PROBLEMS, DOLL, ITEMS, ITEM_IDS, canCarry, canStack, getItem, itemAr, itemProblem,
  normalizeLook, tapItem,
} from '../../client/src/avatar/catalog';
import { frameLook, layoutLook, placeBox } from '../../client/src/avatar/layout';

import type { AvatarLook } from '../../shared/avatar';
import type { AvatarItem } from '../../client/src/avatar/catalog';

const ROOT = resolve(import.meta.dirname, '../..');
const PUBLIC = resolve(ROOT, 'client/public');

/** Every id any range allows: the widest id list a look can use. */
const ALL_POSSIBLE: number[] = [...AVATAR_BASE_IDS, ...AVATAR_ID_RANGES.flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i))];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isValid(l: AvatarLook, known: readonly number[] = ALL_POSSIBLE): boolean {
  const ok = (id: number | null, slot: string): boolean => id === null || (slotOfId(id) === slot && known.includes(id));
  return (
    Array.isArray(l.head) && l.head.length <= AVATAR_MAX_TOWER && new Set(l.head).size === l.head.length &&
    l.head.every((id) => ok(id, 'HEAD')) && ok(l.eyes, 'EYES') && ok(l.ears, 'EARS') && ok(l.face, 'FACE') && ok(l.neck, 'NECK') &&
    Number.isInteger(l.bg) && l.bg >= 0 && l.bg < AVATAR_BG_COUNT
  );
}

describe('avatar look encoding', () => {
  it('round-trips 5000 random looks over every possible id', () => {
    const r = rng(42);
    const bySlot = (slot: string): number[] => ALL_POSSIBLE.filter((id) => slotOfId(id) === slot);
    const pick = (list: number[]): number => list[Math.floor(r() * list.length)] as number;
    let longest = 0;
    for (let i = 0; i < 5000; i++) {
      const look = defaultLook();
      const hats = Math.floor(r() * (AVATAR_MAX_TOWER + 1));
      while (look.head.length < hats) {
        const h = pick(bySlot('HEAD'));
        if (!look.head.includes(h)) look.head.push(h);
      }
      if (r() < 0.6) look.eyes = pick(bySlot('EYES'));
      if (r() < 0.6) look.ears = pick(bySlot('EARS'));
      if (r() < 0.6) look.face = pick(bySlot('FACE'));
      if (r() < 0.6) look.neck = pick(bySlot('NECK'));
      look.bg = Math.floor(r() * AVATAR_BG_COUNT);
      const text = encodeLook(look);
      longest = Math.max(longest, text.length);
      expect(text).toMatch(/^[0-9.-]+$/);
      expect(text.length).toBeLessThanOrEqual(AVATAR_ENCODED_MAX);
      expect(decodeLook(text)).toEqual(look);
      expect(JSON.parse(JSON.stringify(text))).toBe(text);
      expect(encodeURIComponent(text)).toBe(text);
    }
    expect(longest).toBeLessThanOrEqual(32);
  });

  it('round-trips 5000 randomLook looks of the real catalog', () => {
    for (let i = 0; i < 5000; i++) {
      const look = randomLook(i * 7919, ITEM_IDS);
      expect(decodeLook(encodeLook(look), ITEM_IDS)).toEqual(look);
    }
  });

  it('has the documented examples', () => {
    expect(encodeLook(DEFAULT_LOOK)).toBe('1.0.0.0.0.0.0');
    expect(encodeLook({ head: [8, 17], eyes: 9, ears: null, face: 11, neck: 7, bg: 8 })).toBe('1.8.8-17.9.0.11.7');
    expect(decodeLook('1.8.8-17.9.0.11.7')).toEqual({ head: [8, 17], eyes: 9, ears: null, face: 11, neck: 7, bg: 8 });
    expect(decodeLook('1.3.12.5.13.0.15')).toEqual({ head: [12], eyes: 5, ears: 13, face: null, neck: 15, bg: 3 });
  });

  it('decodes garbage to a valid look and never throws', () => {
    const garbage: unknown[] = [
      undefined, null, 0, 17, NaN, {}, [], true, () => 1, '', ' ', 'hello', '1', '1.', '.......', '1.0.0.0.0.0', '1.0.0.0.0.0.0.0',
      '2.0.0.0.0.0.0', '1.99.0.0.0.0.0', '1.-1.0.0.0.0.0', '1.0.8-8-8-8-8-8-8-8-8.0.0.0.0', '1.0.5.0.0.0.0', '1.0.0.8.0.0.0',
      '1.0.999.999.999.999.999', '1.0.1e3.0.0.0.0', '1.0.0x10.0.0.0.0', '1.0.8-.0.0.0.0', '1.0.-8.0.0.0.0', '1.0.8--17.0.0.0.0',
      '1.0.٨.0.0.0.0', '1.0.<script>.0.0.0.0', '1.0.0.0.0.0.0\n', 'א.ב.ג.ד.ה.ו.ז', '1.0.0.0.0.0.0'.repeat(20), '1'.repeat(5000),
      '__proto__', '1.0.constructor.0.0.0.0', '1,0,0,0,0,0,0', '1.0.8 17.0.0.0.0', '1.00000.0.0.0.0.0', '1.0.99999.0.0.0.0',
    ];
    for (const g of garbage) {
      let look: AvatarLook | undefined;
      expect(() => (look = decodeLook(g))).not.toThrow();
      expect(look !== undefined && isValid(look), `decode(${String(g).slice(0, 30)})`).toBe(true);
      expect(decodeLook(encodeLook(look as AvatarLook))).toEqual(look);
    }
    const r = rng(7);
    const alphabet = '0123456789.-- 1aא';
    for (let i = 0; i < 20000; i++) {
      let s = r() < 0.7 ? '1.' : '';
      const len = Math.floor(r() * 40);
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(r() * alphabet.length)];
      expect(isValid(decodeLook(s)), s).toBe(true);
    }
    expect(decodeLook('nonsense')).toEqual(DEFAULT_LOOK);
    expect(decodeLook('1.0.5.0.0.0.0').head).toEqual([]); // glasses are not a hat
    expect(decodeLook('1.4.8-8-17.0.0.0.0').head).toEqual([8, 17]); // no hat twice
  });

  it('drops ids the caller does not know', () => {
    expect(decodeLook('1.0.101-8.201.0.0.0').head).toEqual([101, 8]);
    expect(decodeLook('1.0.101-8.201.0.0.0', ITEM_IDS).head).toEqual([101, 8].filter((id) => ITEM_IDS.includes(id)));
    expect(decodeLook('1.0.148-8.224.0.0.0', [8]).head).toEqual([8]);
    expect(decodeLook('1.0.148-8.224.0.0.0', [8]).eyes).toBeNull();
  });

  it('lookKey is stable and equal for equal looks', () => {
    const a: AvatarLook = { head: [8, 17], eyes: 9, ears: null, face: null, neck: null, bg: 2 };
    expect(lookKey(a)).toBe(lookKey({ ...a, head: [...a.head] }));
    expect(lookKey(a)).toBe(lookKey(encodeLook(a)));
    expect(lookKey(a)).not.toBe(lookKey({ ...a, head: [17, 8] }));
    expect(looksEqual(a, '1.2.8-17.9.0.0.0')).toBe(true);
  });
});

describe('sanitizeLook', () => {
  it('returns the default look for junk', () => {
    for (const junk of [undefined, null, 5, 'x', [], () => 0]) expect(sanitizeLook(junk)).toEqual(DEFAULT_LOOK);
    expect(sanitizeLook({ head: 'no', eyes: '9', bg: '3' })).toEqual(DEFAULT_LOOK);
    expect(sanitizeLook(DEFAULT_LOOK)).not.toBe(DEFAULT_LOOK);
  });

  it('enforces slots, the tower limit, uniqueness and the plate range', () => {
    expect(sanitizeLook({ head: [1, 2, 3, 4, 8], eyes: 5, ears: 6, face: 11, neck: 7, bg: 11 })).toEqual({ head: [1, 2, 3], eyes: 5, ears: 6, face: 11, neck: 7, bg: 11 });
    expect(sanitizeLook({ head: [5, 6, 7, 11, 2.5, -1, NaN, '8', null, 8], bg: 0 }).head).toEqual([8]);
    expect(sanitizeLook({ head: [8, 8, 17, 8], bg: 0 }).head).toEqual([8, 17]);
    expect(sanitizeLook({ head: [], eyes: 8, ears: 5, face: 7, neck: 11, bg: 0 })).toEqual(DEFAULT_LOOK);
    for (const bg of [-1, 12, 1.5, NaN, Infinity, '2']) expect(sanitizeLook({ bg }).bg).toBe(0);
    expect(AVATAR_MAX_TOWER).toBe(3);
  });

  it('keeps only known ids when a list is given', () => {
    const look = { head: [8, 101, 17], eyes: 201, ears: 13, face: 230, neck: 330, bg: 5 };
    expect(sanitizeLook(look)).toEqual(look);
    expect(sanitizeLook(look, AVATAR_BASE_IDS)).toEqual({ head: [8, 17], eyes: null, ears: 13, face: null, neck: null, bg: 5 });
    expect(sanitizeLook(look, new Set([101, 330]))).toEqual({ head: [101], eyes: null, ears: null, face: null, neck: 330, bg: 5 });
    expect(sanitizeLook(look, [])).toEqual({ ...DEFAULT_LOOK, bg: 5 });
  });

  it('does not change or share its input', () => {
    const input = { head: [8, 17], eyes: 9, ears: null, face: null, neck: null, bg: 1 };
    const out = sanitizeLook(input);
    out.head.push(2);
    expect(input.head).toEqual([8, 17]);
    expect(Object.isFrozen(DEFAULT_LOOK)).toBe(true);
  });
});

describe('dressing helpers', () => {
  it('wear / remove / toggle / shake', () => {
    let l = defaultLook();
    l = wearItem(l, 8);
    l = wearItem(l, 17);
    l = wearItem(l, 9);
    l = wearItem(l, 5); // replaces the heart glasses
    expect(l).toEqual({ head: [8, 17], eyes: 5, ears: null, face: null, neck: null, bg: 0 });
    l = wearItem(wearItem(l, 2), 10); // the tower is full: the top hat is replaced
    expect(l.head).toEqual([8, 17, 10]);
    expect(isWearing(l, 10) && !isWearing(l, 2)).toBe(true);
    expect(wornIds(l)).toEqual([8, 17, 10, 5]);
    expect(removeItem(l, 8).head).toEqual([17, 10]);
    expect(toggleItem(toggleItem(l, 11), 11)).toEqual(l);
    expect(wearItem(l, 9999)).toEqual(l);
    expect(shakeOff({ ...l, bg: 7 })).toEqual({ ...DEFAULT_LOOK, bg: 7 });
  });

  it('tapItem follows the catalog', () => {
    let l = tapItem(defaultLook(), 12);
    l = tapItem(l, 4);
    l = tapItem(l, 17);
    expect(l.head).toEqual([12, 4, 17]);
    expect(tapItem(l, 8).head).toEqual([12, 4, 8]);
    expect(tapItem(l, 4).head).toEqual([12, 17]);
    expect(tapItem(tapItem(l, 6), 6)).toEqual(l);
    expect(tapItem(l, 424242)).toEqual(l);
    expect(canStack(l, 8)).toBe(false);
    expect(canStack(tapItem(l, 17), 8)).toBe(true);
    expect(canStack(l, 12)).toBe(false);
  });
});

describe('randomLook', () => {
  it('is deterministic', () => {
    for (let s = 0; s < 300; s++) expect(randomLook(s, ITEM_IDS)).toEqual(randomLook(s, [...ITEM_IDS].reverse()));
    expect(randomLook(5)).toEqual(randomLook(5, AVATAR_BASE_IDS));
    expect(randomLook(seedFromText('דנה'))).toEqual(randomLook(seedFromText('דנה')));
    for (const bad of [NaN, Infinity, -5, 1.5, 2 ** 40]) expect(isValid(randomLook(bad))).toBe(true);
  });

  it('is valid and pleasantly varied', () => {
    const n = 2000;
    const looks = Array.from({ length: n }, (_, i) => randomLook(i));
    expect(looks.every((l) => isValid(l, AVATAR_BASE_IDS))).toBe(true);
    const share = (f: (l: AvatarLook) => boolean): number => looks.filter(f).length / n;
    expect(share((l) => l.head.length > 0)).toBeGreaterThan(0.75);
    expect(share((l) => l.head.length > 0)).toBeLessThan(0.95);
    expect(share((l) => l.head.length > 1)).toBeGreaterThan(0.1);
    expect(share((l) => l.head.length > 1)).toBeLessThan(0.35);
    expect(share((l) => l.head.length === 3)).toBeGreaterThan(0.01);
    expect(share((l) => l.eyes !== null)).toBeGreaterThan(0.3);
    expect(share((l) => l.eyes !== null)).toBeLessThan(0.5);
    expect(share((l) => l.face !== null)).toBeGreaterThan(0.12);
    expect(share((l) => l.ears !== null)).toBeGreaterThan(0.1);
    expect(share((l) => l.neck !== null)).toBeGreaterThan(0.2);
    expect(new Set(looks.map((l) => l.bg)).size).toBe(AVATAR_BG_COUNT);
    expect(new Set(looks.flatMap(wornIds)).size).toBe(AVATAR_BASE_IDS.length); // every accessory shows up
    expect(new Set(looks.map(encodeLook)).size).toBeGreaterThan(n * 0.6);
    // neighbours differ: 60 guests in a row do not look alike
    const sixty = looks.slice(0, 60).map(encodeLook);
    expect(new Set(sixty).size).toBeGreaterThan(50);
  });

  it('only uses the ids it is given', () => {
    for (let s = 0; s < 200; s++) {
      const l = randomLook(s, [2, 9]);
      expect(l.head.every((h) => h === 2) && (l.eyes === null || l.eyes === 9) && l.ears === null && l.face === null && l.neck === null).toBe(true);
      expect(randomLook(s, [])).toEqual({ ...DEFAULT_LOOK, bg: randomLook(s, []).bg });
    }
  });
});

describe('slot table vs catalog', () => {
  it('the shared base table is exactly the catalog items 1-17', () => {
    expect(BASE_ITEMS.map((i) => i.id)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    expect(AVATAR_BASE_IDS).toEqual(BASE_ITEMS.map((i) => i.id));
    for (const it of BASE_ITEMS) expect(AVATAR_BASE_SLOTS[it.id], `item ${it.id}`).toBe(it.slot);
  });

  it('every catalog item has the slot its id says, a unique id, and no merge problems', () => {
    expect(CATALOG_PROBLEMS).toEqual([]);
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
    expect(ITEMS.length).toBe(BASE_ITEMS.length + CATALOG_PARTS.reduce((n, p) => n + p.items.length, 0));
    for (const it of ITEMS) {
      expect(slotOfId(it.id), `item ${it.id}`).toBe(it.slot);
      expect(AVATAR_SLOTS).toContain(it.slot);
      expect(getItem(it.id)).toBe(it);
    }
    for (const part of CATALOG_PARTS) for (const it of part.items) expect(it.id >= part.range[0] && it.id <= part.range[1], `${part.file} id ${it.id}`).toBe(true);
  });

  it('id ranges do not overlap and stay under 1000 (the encoding allows 4 digits)', () => {
    const seen = new Map<number, string>();
    for (const id of ALL_POSSIBLE) {
      expect(seen.has(id), `id ${id} twice`).toBe(false);
      seen.set(id, slotOfId(id) ?? '');
      expect(id).toBeLessThan(1000);
    }
    for (const id of [0, -1, 18, 100, 150, 200, 250, 300, 350, 1.5, NaN]) expect(slotOfId(id)).toBeNull();
    expect([slotOfId(101), slotOfId(149), slotOfId(201), slotOfId(224), slotOfId(225), slotOfId(249), slotOfId(301), slotOfId(324), slotOfId(325), slotOfId(349)])
      .toEqual(['HEAD', 'HEAD', 'EYES', 'EYES', 'FACE', 'FACE', 'EARS', 'EARS', 'NECK', 'NECK']);
  });

  it('the merge refuses bad items', () => {
    const good: AvatarItem = { id: 101, slot: 'HEAD', name: 'כובע', file: '/assets/shimi/props/x.png', place: [10, -10, 80, 30] };
    expect(itemProblem(good, [101, 149])).toBeNull();
    expect(itemProblem({ ...good, id: 201 }, [101, 149])).toMatch(/outside/);
    expect(itemProblem({ ...good, slot: 'EYES' })).toMatch(/slot/);
    expect(itemProblem({ ...good, id: 60 })).toMatch(/no id range/);
    expect(itemProblem({ ...good, name: ' ' })).toMatch(/name/);
    expect(itemProblem({ ...good, file: 'x.png' })).toMatch(/file/);
    expect(itemProblem({ ...good, place: [10, -10, 0, 30] })).toMatch(/place/);
    expect(itemProblem({ ...good, place: [10, NaN, 80, 30] })).toMatch(/place/);
    expect(itemProblem({ ...good, tw: { crown: 0.5, bottom: 0.6, sink: 0.1, seat: 0.3 } })).toMatch(/tw/);
  });
});

/** Width and height of a PNG from its IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString('latin1'), file).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('catalog files and placement', () => {
  it('the doll picture is the box the placement refers to', () => {
    expect(pngSize(resolve(PUBLIC, DOLL.file.slice(1)))).toEqual([DOLL.width, DOLL.height]);
  });

  it('every item has a picture on disk whose proportions match its placement', () => {
    for (const it of ITEMS) {
      const file = resolve(PUBLIC, it.file.slice(1));
      expect(existsSync(file), `${it.file} (item ${it.id})`).toBe(true);
      const [w, h] = pngSize(file);
      const box = placeBox(it);
      // the picture is not squashed: the placed box has the picture's own shape (2% slack)
      expect(Math.abs(box.h / box.w / (h / w) - 1), `item ${it.id} place vs picture`).toBeLessThan(0.02);
      expect(Math.abs(itemAr(it) / (h / w) - 1), `item ${it.id} ar`).toBeLessThan(0.02);
      expect(itemProblem(it), `item ${it.id}`).toBeNull();
      expect(it.name.length).toBeGreaterThan(1);
      expect(/[֐-׿]/.test(it.name), `item ${it.id} has a Hebrew name`).toBe(true);
    }
  });

  it('every item sits in the part of the doll its slot means', () => {
    const cx = (DOLL.centerX / 100) * DOLL.width;
    for (const it of ITEMS) {
      const b = placeBox(it);
      const top = (b.y / DOLL.height) * 100;
      const bottom = ((b.y + b.h) / DOLL.height) * 100;
      const mid = (top + bottom) / 2;
      // roughly centred on the doll: the centre line passes through the picture's middle half
      expect(Math.abs(b.x + b.w / 2 - cx), `item ${it.id} centre`).toBeLessThan(b.w * 0.25 + 30);
      if (it.slot === 'HEAD') {
        expect(top, `hat ${it.id} top`).toBeLessThan(2);
        expect(bottom, `hat ${it.id} bottom`).toBeGreaterThan(8);
        expect(bottom, `hat ${it.id} bottom`).toBeLessThan(45);
      } else if (it.slot === 'EYES') {
        expect(mid, `eyes ${it.id}`).toBeGreaterThan(22);
        expect(mid, `eyes ${it.id}`).toBeLessThan(33);
      } else if (it.slot === 'FACE') {
        expect(mid, `face ${it.id}`).toBeGreaterThan(20);
        expect(mid, `face ${it.id}`).toBeLessThan(47);
      } else if (it.slot === 'EARS') {
        expect(top, `ears ${it.id}`).toBeLessThan(36);
        expect(bottom, `ears ${it.id}`).toBeGreaterThan(20);
        expect(bottom, `ears ${it.id}`).toBeLessThan(50);
      } else {
        expect(top, `neck ${it.id}`).toBeGreaterThan(38);
        expect(top, `neck ${it.id}`).toBeLessThan(60);
      }
    }
  });

  it('the 17 originals carry the source page data', () => {
    for (const it of BASE_ITEMS) {
      expect(it.lines?.length, `item ${it.id} lines`).toBe(3);
      expect(it.colors?.length ?? 0).toBeGreaterThanOrEqual(3);
      expect(it.fly !== undefined && it.snd !== undefined && it.contact !== undefined && it.burst !== undefined).toBe(true);
      expect(it.tw !== undefined, `item ${it.id} tw`).toBe(it.slot === 'HEAD');
      expect(it.file).toMatch(new RegExp(`^/assets/shimi/prop_${String(it.id).padStart(2, '0')}_[a-z_]+\\.png$`));
    }
    // spot checks against design/albert-14-11.source.html
    expect(getItem(1)).toMatchObject({ name: 'קסדת בירה', place: [-5.59, -13.07, 110, 53.99], tw: { crown: 0.08, bottom: 0.5, sink: 0.1, seat: 0.261 }, fly: 'lob', snd: 'thud' });
    expect(getItem(11)).toMatchObject({ slot: 'FACE', name: 'שפם', place: [20.7, 32.75, 62.11, 5.5] });
    expect(getItem(15)).toMatchObject({ slot: 'NECK', name: 'זר הוואי', place: [20.7, 47.67, 60.04, 27] });
    expect(getItem(17)?.lines?.[2]).toBe('החרוט עליי, העוגה עליכם.');
  });

  it('matches ITEMS in the source page, number by number', () => {
    const src = readFileSync(resolve(ROOT, 'design/albert-14-11.source.html'), 'utf8');
    const block = src.slice(src.indexOf('const ITEMS = {'), src.indexOf('const ALL = '));
    for (const it of BASE_ITEMS) {
      const m = new RegExp(`\\n\\s+${it.id}: \\{ slot:'(\\w+)', name:'([^']+)', place:\\[([^\\]]+)\\], ar:(\\d+)/(\\d+), contact:\\[([^\\]]+)\\], fly:'(\\w+)', weight:([\\d.]+), power:([\\d.]+), snd:'(\\w+)'`).exec(block);
      expect(m, `item ${it.id} found in the source`).not.toBeNull();
      if (m === null) continue;
      expect(it.slot).toBe(m[1]);
      expect(it.name).toBe(m[2]);
      expect([...it.place]).toEqual((m[3] ?? '').split(',').map(Number));
      expect(it.ar).toBeCloseTo(Number(m[4]) / Number(m[5]), 10);
      expect([...(it.contact ?? [])]).toEqual((m[6] ?? '').split(',').map(Number));
      expect(it.fly).toBe(m[7]);
      expect(it.weight).toBe(Number(m[8]));
      expect(it.power).toBe(Number(m[9]));
      expect(it.snd).toBe(m[10]);
      for (const line of it.lines ?? []) expect(block.includes(`'${line}'`), `item ${it.id} line`).toBe(true);
    }
  });

  it('has 12 plates', () => {
    expect(AVATAR_BGS.length).toBe(AVATAR_BG_COUNT);
    expect(AVATAR_BGS.map((b) => b.id)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(AVATAR_BGS.filter((b) => b.kind === 'flat').length).toBe(8);
    expect(new Set(AVATAR_BGS.filter((b) => b.kind !== 'flat').map((b) => b.kind))).toEqual(new Set(['sunburst', 'dots', 'bars', 'stars']));
    for (const b of AVATAR_BGS) expect(b.color).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('layout and framing', () => {
  it('paints in the source page order', () => {
    const placed = layoutLook({ head: [8, 17, 4], eyes: 9, ears: 6, face: 11, neck: 7, bg: 0 });
    expect(placed.map((p) => p.layer)).toEqual(['EARS', 'FACE', 'EYES', 'HEAD', 'TOWER', 'TOWER', 'NECK']);
    expect(placed.map((p) => p.item.id)).toEqual([6, 11, 9, 8, 17, 4, 7]);
  });

  it('stacks the tower like the source page', () => {
    const [crown, party, cap] = layoutLook({ ...defaultLook(), head: [8, 17, 4] });
    if (crown === undefined || party === undefined || cap === undefined) throw new Error('three hats expected');
    const W = DOLL.width;
    const H = DOLL.height;
    // worn hat: its place
    expect(crown.x).toBeCloseTo((9.524 / 100) * W, 6);
    expect(crown.y).toBeCloseTo((-15.833 / 100) * H, 6);
    // level 0: width shrinks by .93, bottom line sits (crown + sink) below the worn hat's top, same centre line
    const w0 = (43.89 / 100) * W * 0.93;
    const h0 = w0 * (355 / 249);
    const ay0 = crown.y + (0.24 + 0.08) * crown.h;
    expect(party.w).toBeCloseTo(w0, 6);
    expect(party.h).toBeCloseTo(h0, 6);
    expect(party.x + party.w / 2).toBeCloseTo(crown.x + crown.w / 2, 6);
    expect(party.y).toBeCloseTo(ay0 - 0.96 * h0, 6);
    // level 1
    const w1 = (55.11 / 100) * W * 0.93 * 0.93;
    const h1 = w1 * (211 / 242);
    const ay1 = ay0 - (0.96 - 0.03 - 0.16) * h0;
    expect(cap.w).toBeCloseTo(w1, 6);
    expect(cap.y).toBeCloseTo(ay1 - 0.97 * h1, 6);
    // each hat is higher than the one below and still overlaps it
    expect(party.y).toBeLessThan(crown.y);
    expect(cap.y).toBeLessThan(party.y);
    expect(party.y + party.h).toBeGreaterThan(crown.y);
    expect(cap.y + cap.h).toBeGreaterThan(party.y);
  });

  it('every tower of the catalog rises and stays connected', () => {
    const hats = ITEMS.filter((i) => i.slot === 'HEAD');
    for (const a of hats) for (const b of hats) for (const c of hats) {
      if (a === b || b === c || a === c || !canCarry(a.id) || !canCarry(b.id)) continue;
      const p = layoutLook({ ...defaultLook(), head: [a.id, b.id, c.id] }).filter((x) => x.layer === 'HEAD' || x.layer === 'TOWER');
      expect(p.length).toBe(3);
      for (let i = 1; i < p.length; i++) {
        const lo = p[i - 1] as (typeof p)[number];
        const hi = p[i] as (typeof p)[number];
        const tw = hi.item.tw ?? { bottom: 0.97 };
        expect(hi.y + tw.bottom * hi.h, `${a.id}-${b.id}-${c.id} hat ${i} rests inside the hat below`).toBeGreaterThanOrEqual(lo.y - 0.5);
        expect(hi.y + tw.bottom * hi.h).toBeLessThanOrEqual(lo.y + lo.h);
      }
      expect((p[2] as (typeof p)[number]).y).toBeLessThan((p[0] as (typeof p)[number]).y);
    }
  });

  it('the frame is a square that holds everything, centred on the face line', () => {
    const cx = (DOLL.centerX / 100) * DOLL.width;
    const r = rng(11);
    for (let i = 0; i < 1500; i++) {
      const look = normalizeLook(randomLook(Math.floor(r() * 1e9), ITEM_IDS));
      const placed = layoutLook(look);
      for (const crop of ['icon', 'bust', 'full'] as const) {
        const f = frameLook(look, crop, placed);
        expect(f.w).toBeCloseTo(f.h, 9);
        expect(f.x + f.w / 2).toBeCloseTo(cx, 6);
        const margin = f.w * 0.049;
        for (const p of placed) {
          if (p.layer === 'NECK' && crop !== 'full') continue;
          expect(p.x, `${encodeLook(look)} ${crop} left`).toBeGreaterThanOrEqual(f.x + margin);
          expect(p.x + p.w).toBeLessThanOrEqual(f.x + f.w - margin);
          expect(p.y).toBeGreaterThanOrEqual(f.y + margin);
          if (crop === 'full') expect(p.y + p.h).toBeLessThanOrEqual(f.y + f.h - margin);
        }
        // the head is always inside
        expect((DOLL.headBox[0] / 100) * DOLL.width).toBeGreaterThanOrEqual(f.x + margin - 1e-6);
        expect((DOLL.headBox[1] / 100) * DOLL.height).toBeGreaterThanOrEqual(f.y + margin - 1e-6);
      }
    }
  });

  it('the bare head fills the icon; a 3-hat tower still leaves a readable face', () => {
    const headW = ((DOLL.headBox[2] - DOLL.headBox[0]) / 100) * DOLL.width;
    const bare = frameLook(defaultLook(), 'icon');
    expect(headW / bare.w).toBeGreaterThan(0.55);
    let smallest = 1;
    const hats = ITEMS.filter((i) => i.slot === 'HEAD');
    for (const a of hats) for (const b of hats) for (const c of hats) {
      if (a === b || b === c || a === c) continue;
      const look = normalizeLook({ ...defaultLook(), head: [a.id, b.id, c.id] });
      smallest = Math.min(smallest, headW / frameLook(look, 'icon').w);
    }
    // at 28 px the head is then still at least 28 * 0.2 = 5.6 px wide: a dot with a hat pile, by design
    expect(smallest).toBeGreaterThan(0.2);
  });

  it('normalizeLook cuts the tower above a hat that cannot carry', () => {
    expect(normalizeLook({ head: [8, 17, 4], bg: 0 }).head).toEqual([8, 17, 4]);
    expect(normalizeLook({ head: [8, 140, 4], bg: 0 }).head.includes(140)).toBe(ITEM_IDS.includes(140));
    expect(normalizeLook('junk')).toEqual(DEFAULT_LOOK);
  });
});
