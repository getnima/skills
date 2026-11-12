import { NAME_MAX_LEN } from '../shared/protocol';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/**
 * Normalises a display name: control and bidi-override characters and lone surrogates removed,
 * whitespace collapsed, trimmed, cut to NAME_MAX_LEN user-visible characters
 * (grapheme clusters, so an emoji or a Hebrew letter with niqqud counts once).
 * Returns null when nothing printable is left.
 */
export function cleanName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const stripped = input
    .slice(0, 400)
    // half an emoji (a lone surrogate, also what the 400-unit slice can leave) is not a character
    .replace(/\p{Cs}/gu, '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length === 0) return null;
  const cut = graphemes(stripped).slice(0, NAME_MAX_LEN).join('').trim();
  return cut.length > 0 ? cut : null;
}

function nameKey(name: string): string {
  return name.toLocaleLowerCase();
}

/** "דני" → "דני 2" → "דני 3" ... while the name is taken; stays within NAME_MAX_LEN. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map(nameKey));
  if (!used.has(nameKey(name))) return name;
  const base = graphemes(name);
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, NAME_MAX_LEN - suffix.length).join('').trim() + suffix;
    if (!used.has(nameKey(candidate))) return candidate;
  }
  return name;
}
