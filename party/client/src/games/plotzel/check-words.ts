/**
 * Check script for the builtin word list and the rules.
 *   npx tsx client/src/games/plotzel/check-words.ts
 * Exits non-zero on any problem.
 */
import { evaluateGuess, normalizeWord, partialScore, pickAnswer, solvedScore, WORD_LEN } from './logic';
import { WORDS } from './words';

const problems: string[] = [];
const HEBREW = /^[א-ת]+$/;
const MIN_WORDS = 250;

const seen = new Map<string, string>();
for (const w of WORDS) {
  if (!HEBREW.test(w)) problems.push(`not Hebrew letters only: "${w}"`);
  const n = normalizeWord(w);
  if ([...n].length !== WORD_LEN) problems.push(`not ${WORD_LEN} letters: "${w}" (${[...n].length})`);
  const first = seen.get(n);
  if (first !== undefined) problems.push(`duplicate: "${w}" = "${first}"`);
  seen.set(n, w);
  // a final form may only stand last
  for (let i = 0; i < w.length - 1; i++) {
    if ('ךםןףץ'.includes(w[i] ?? '')) problems.push(`final form inside the word: "${w}"`);
  }
}
if (WORDS.length < MIN_WORDS) problems.push(`only ${WORDS.length} words, need ${MIN_WORDS}`);

function expect(name: string, got: string, want: string): void {
  if (got !== want) problems.push(`${name}: got ${got}, want ${want}`);
}
const code = (s: string, a: string): string =>
  evaluateGuess(s, a)
    .map((x) => (x === 'correct' ? 'G' : x === 'present' ? 'Y' : '.'))
    .join('');
// count-based duplicates (strings are in logical order, index 0 = first letter)
expect('dup guess, one in answer, green wins', code('ממממם', 'שולחן'), '.....');
expect('dup guess vs single', code('ללללל', 'שולחן'), '..G..');
expect('three copies in guess, one in answer (yellow once)', code('ננשנש', 'שולחן'), 'Y.Y..');
expect('exact', code('שולחן', 'שולחן'), 'GGGGG');
expect('final form equals base', code('שולחנ', 'שולחן'), 'GGGGG');
expect('green consumes before yellow', code('ככככב', 'כלבלב'), 'G...G');
expect('yellow limited by count', code('ללאאא', 'כלבלב'), 'YG...');
expect('two yellows when answer has two', code('לבלבכ', 'כלבלב'), 'YYYYY');
expect('partial max', String(partialScore(5, 5)), '300');
expect('partial mix', String(partialScore(2, 1)), '140');
expect('solved try 1 full time', String(solvedScore(1, 60_000, 60_000)), '1500');
expect('solved try 3 half time', String(solvedScore(3, 30_000, 60_000)), '1050');
expect('solved try 6 no time', String(solvedScore(6, 0, 60_000)), '500');
expect('same seed same word', pickAnswer(7), pickAnswer(7));

if (problems.length > 0) {
  for (const p of problems) console.error('FAIL', p);
  process.exit(1);
}
console.log(`ok: ${WORDS.length} words, rules checked; seed 7 -> ${pickAnswer(7)}`);
