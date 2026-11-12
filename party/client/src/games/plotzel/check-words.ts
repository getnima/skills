/**
 * Check script for the builtin word list, the colouring rules and the score formulas.
 *   npx tsx client/src/games/plotzel/check-words.ts
 * Exits non-zero on any problem.
 */
import { GAMES } from '../../../../shared/protocol';
import {
  evaluateGuess,
  failedScore,
  FAIL_MIN,
  normalizeWord,
  partialScore,
  PARTIAL_MAX,
  pickAnswer,
  selfReportScore,
  SOLVED_MAX,
  SOLVED_MIN,
  solvedScore,
  WORD_LEN,
} from './logic';
import { WORDS } from './words';

const problems: string[] = [];
let checks = 0;
const HEBREW = /^[א-ת]+$/;
const MIN_WORDS = 250;

// ── the word list ──
const seen = new Map<string, string>();
for (const w of WORDS) {
  if (!HEBREW.test(w)) problems.push(`not Hebrew letters only: "${w}"`);
  const n = normalizeWord(w);
  if ([...n].length !== WORD_LEN) problems.push(`not ${WORD_LEN} letters: "${w}" (${[...n].length})`);
  const first = seen.get(n);
  if (first !== undefined) problems.push(`duplicate: "${w}" = "${first}"`);
  seen.set(n, w);
  // a final form may only stand last, and a last כ/מ/נ/פ/צ must be written final
  for (let i = 0; i < w.length - 1; i++) {
    if ('ךםןףץ'.includes(w[i] ?? '')) problems.push(`final form inside the word: "${w}"`);
  }
  if ('כמנפצ'.includes(w[w.length - 1] ?? '')) problems.push(`last letter should be a final form: "${w}"`);
}
if (WORDS.length < MIN_WORDS) problems.push(`only ${WORDS.length} words, need ${MIN_WORDS}`);

function expect(name: string, got: string, want: string): void {
  checks++;
  if (got !== want) problems.push(`${name}: got ${got}, want ${want}`);
}
function assert(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) problems.push(`${name}${detail ? ` (${detail})` : ''}`);
}
const code = (guess: string, answer: string): string =>
  evaluateGuess(guess, answer)
    .map((x) => (x === 'correct' ? 'G' : x === 'present' ? 'Y' : '.'))
    .join('');

// ── colouring: hand-checked table ──
// Strings are in logical order: index 0 = the FIRST letter (shown on the right).
// G = right letter, right place; Y = in the word elsewhere; . = not (or no copies left).
// Rule: greens first, then yellows left to right only while the answer still has
// unmatched copies of that letter. Final forms equal their base letter (ם = מ).
const TABLE: ReadonlyArray<readonly [guess: string, answer: string, want: string, why: string]> = [
  ['שולחן', 'שולחן', 'GGGGG', 'exact'],
  ['שולחנ', 'שולחן', 'GGGGG', 'base nun at the end = final nun'],
  ['נולחש', 'שולחן', 'YGGGY', 'swapped first and last'],
  ['חנשלו', 'שולחן', 'YYYYY', 'all letters, all misplaced'],
  ['ממממם', 'שולחן', '.....', 'letter not in the word'],
  ['ללללל', 'שולחן', '..G..', 'five copies, one in the word: only the green'],
  ['ןןןןן', 'שולחן', '....G', 'final nun typed everywhere: green at the end only'],
  ['ככככב', 'כלבלב', 'G...G', 'greens use up the only kaf'],
  ['ללאאא', 'כלבלב', 'YG...', 'answer has two lameds: one green, one yellow'],
  ['לבלבכ', 'כלבלב', 'YYYYY', 'two yellows each when the answer has two'],
  ['ממממם', 'לימון', '..G..', 'one mem in the answer'],
  ['מילון', 'לימון', 'YGYGG', 'mem and lamed swapped'],
  ['ננננן', 'בננות', '.GG..', 'two nuns, both green, the rest grey'],
  ['נבנבנ', 'בננות', 'YYG..', 'one green nun + one yellow nun, then none left'],
  ['ממממם', 'ממותה', 'GG...', 'double mem at the start'],
  ['ומממה', 'ממותה', 'YGY.G', 'second mem green, third mem yellow, fourth grey'],
  ['אבטחה', 'אבטיח', 'GGGY.', 'het present, he absent'],
  ['הרובד', 'דבורה', 'YYGYY', 'reversed word'],
  ['ללללל', 'לילות', 'G.G..', 'two lameds, both green'],
  ['תללוי', 'לילות', 'YYGGY', 'mixed greens and yellows'],
  ['עצעצע', 'צעצוע', 'YY.YG', 'two tsadis two ayins: counts respected'],
  ['ץץץץץ', 'צעצוע', 'G.G..', 'final tsadi typed = tsadi'],
  ['יייים', 'ידיים', 'G.GGG', 'three yods green, the extra one grey'],
  ['מיידי', 'ידיים', 'YYGYY', 'final mem of the answer matched by a base mem'],
];
for (const [guess, answer, want, why] of TABLE) expect(`colours "${guess}" vs "${answer}": ${why}`, code(guess, answer), want);
assert(`colour table has at least 20 cases`, TABLE.length >= 20, String(TABLE.length));

// ── raw scores ──
const D = GAMES.plotzel.durationMs; // 120 s
const at = (elapsedMs: number): number => D - elapsedMs; // time left at an elapsed time

// a 3-try solve 40 s into the round is worth the same in all three modes
const builtin3at40 = solvedScore(3, at(40_000), D); // builtin: scored at the submit
const bridge3at40 = solvedScore(3, at(40_000), D); // bridge: scored when `solved {tries:3}` arrives
const self3at40 = selfReportScore(3, at(42_000), D); // self-report: first tap ~2 s after the solve
expect('3 tries @40s builtin', String(builtin3at40), '1133');
expect('3 tries @40s bridge = builtin', String(bridge3at40), String(builtin3at40));
expect('3 tries @40s self-report (tap at 42s) = builtin', String(self3at40), String(builtin3at40));

expect('solved try 1 at the first instant = SOLVED_MAX', String(solvedScore(1, D, D)), String(SOLVED_MAX));
expect('solved try 6 at the last instant = SOLVED_MIN', String(solvedScore(6, 0, D)), String(SOLVED_MIN));
expect('self-report never beats the first instant', String(selfReportScore(1, D, D)), String(SOLVED_MAX));
assert('best possible raw <= GAMES.plotzel.maxRaw', SOLVED_MAX <= GAMES.plotzel.maxRaw, `${SOLVED_MAX} vs ${GAMES.plotzel.maxRaw}`);

// faster is better, fewer tries is better
for (let n = 1; n <= 6; n++) {
  let prev = Infinity;
  for (let e = 0; e <= D; e += 10_000) {
    const v = solvedScore(n, at(e), D);
    if (v > prev) problems.push(`slower scored higher: try ${n} at ${e}`);
    prev = v;
  }
}
checks++;
for (let e = 0; e <= D; e += 10_000) {
  for (let n = 1; n < 6; n++) {
    if (solvedScore(n, at(e), D) <= solvedScore(n + 1, at(e), D)) problems.push(`more tries scored higher at ${e}: ${n}`);
  }
}
checks++;

// a fail is worth something small, always below any solve
expect('self-reported fail = FAIL_MIN', String(selfReportScore('fail', D, D)), String(FAIL_MIN));
expect('finished fail with no colours = FAIL_MIN', String(failedScore(0, 0)), String(FAIL_MIN));
expect('finished fail keeps its colours', String(failedScore(3, 1)), '200');
assert('fail > 0', FAIL_MIN > 0);
assert('every fail < every solve', Math.max(FAIL_MIN, PARTIAL_MAX, failedScore(5, 0)) < SOLVED_MIN);
expect('partial max', String(partialScore(5, 5)), String(PARTIAL_MAX));
expect('partial mix', String(partialScore(2, 1)), '140');
expect('solved try 3 half time', String(solvedScore(3, 30_000, 60_000)), '1050');

// the same seed gives the same word everywhere, and seeds spread over the list
expect('same seed same word', pickAnswer(7), pickAnswer(7));
expect('seed 7', pickAnswer(7), pickAnswer(7, [...WORDS]));
const spread = new Set<string>();
for (let seed = 1; seed <= 200; seed++) spread.add(pickAnswer(seed * 2654435761));
assert('200 seeds give many different words', spread.size > 120, String(spread.size));
for (const seed of [0, 1, 4294967295, 123456789]) assert(`seed ${seed} gives a list word`, WORDS.includes(pickAnswer(seed)));

if (problems.length > 0) {
  for (const p of problems) console.error('FAIL', p);
  process.exit(1);
}
console.log(`ok: ${WORDS.length} words, ${checks} checks (${TABLE.length} colour cases); seed 7 -> ${pickAnswer(7)}`);
