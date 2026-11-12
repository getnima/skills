/**
 * Simulation: how often do two players end a competition on exactly the same total?
 *
 *   npx tsx tests/load/sim-ties.ts [competitions=10000] [seed=1]
 *
 * Compares the OLD formula (shared ranks, shared bonus), rule B alone (strict
 * round points) and the NEW formula (strict round points + distinct totals).
 * Also checks, for the new formula, that the strict overall rank is always
 * consistent with the totals and that round points are distinct among scorers.
 */
import { computeRoundScores, MAX_ROUND_POINTS, PODIUM_BONUS, rankOverall } from '../../shared/scoring';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = Number(process.argv[2] ?? 10_000);
const rnd = mulberry32(Number(process.argv[3] ?? 1));
const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

/** Raw score of one player in one game: small realistic ranges, pulled a little by skill (0..1). */
const GAMES: Array<(skill: number) => number> = [
  (s) => Math.min(15, Math.max(0, Math.round(int(0, 15) * (0.5 + s)))), // flappy 0..15
  (s) => 50 * Math.min(20, Math.round(int(0, 20) * (0.5 + s))), // plotzel: multiples of 50
  (s) => Math.min(1700, Math.round(int(200, 1700) * (0.6 + 0.8 * s))), // tap 200..1700
  (s) => 5 * Math.min(120, Math.round(int(0, 120) * (0.5 + s))), // ninja: multiples of 5
  (s) => 10 * Math.min(200, Math.round(int(0, 200) * (0.5 + s))), // icy: multiples of 10
];

function oldScores(raws: readonly number[]): number[] {
  const best = Math.max(0, ...raws);
  return raws.map((raw) => {
    if (raw <= 0 || best <= 0) return 0;
    const rank = raws.filter((x) => x > raw).length + 1;
    return Math.round((MAX_ROUND_POINTS * raw) / best) + (PODIUM_BONUS[rank - 1] ?? 0);
  });
}

function hasEqual(totals: readonly number[], ignoreZero: boolean): boolean {
  const seen = new Set<number>();
  for (const t of totals) {
    if (ignoreZero && t === 0) continue;
    if (seen.has(t)) return true;
    seen.add(t);
  }
  return false;
}

console.log(`competitions per size: ${N}, 5 rounds each`);
for (const players of [12, 30, 60]) {
  let oldEq = 0;
  let bEq = 0;
  let newEq = 0;
  let newEqAll = 0;
  let oldPairs = 0;
  let rankBad = 0;
  let pointsBad = 0;
  let winnerBad = 0;
  let maxNudge = 0;
  for (let c = 0; c < N; c++) {
    const skill = Array.from({ length: players }, () => rnd());
    const tOld = new Array<number>(players).fill(0);
    const tB = new Array<number>(players).fill(0);
    const tNew = new Array<number>(players).fill(0);
    const wins = new Array<number>(players).fill(0);
    const best = new Array<number>(players).fill(0);
    let lastPos: Array<number | null> = new Array<number | null>(players).fill(null);
    for (const game of GAMES) {
      const raws = skill.map((s) => game(s));
      const reached = raws.map(() => int(0, 60_000));
      oldScores(raws).forEach((p, i) => (tOld[i]! += p));
      const base = raws.map((raw, i) => ({ id: String(i), raw, reachedAt: raw > 0 ? reached[i]! : null, joinOrder: i }));
      const b = computeRoundScores(base);
      const n = computeRoundScores(base.map((e, i) => ({ ...e, totalBefore: tNew[i]! })));
      const seen = new Set<number>();
      let winners = 0;
      lastPos = [];
      for (let i = 0; i < players; i++) {
        const pb = b.get(String(i))!;
        const pn = n.get(String(i))!;
        tB[i]! += pb.points;
        tNew[i]! += pn.points;
        best[i] = Math.max(best[i]!, pn.points);
        lastPos.push(pn.roundRank);
        if (pn.roundRank === 1 && pn.points > 0) {
          wins[i]! += 1;
          winners++;
        }
        maxNudge = Math.max(maxNudge, Math.abs(pb.points - pn.points));
        if (raws[i]! > 0) {
          if (seen.has(pn.points) || pn.points < 1) pointsBad++;
          seen.add(pn.points);
        } else if (pn.points !== 0) pointsBad++;
      }
      if (winners !== (raws.some((x) => x > 0) ? 1 : 0)) winnerBad++;
    }
    if (hasEqual(tOld, false)) oldEq++;
    if (hasEqual(tB, false)) bEq++;
    if (hasEqual(tNew, true)) newEq++;
    if (hasEqual(tNew, false)) newEqAll++;
    for (let i = 0; i < players; i++) for (let j = i + 1; j < players; j++) if (tOld[i] === tOld[j]) oldPairs++;
    const ranks = rankOverall(tNew.map((total, i) => ({ id: String(i), total, wins: wins[i]!, best: best[i]!, lastPos: lastPos[i] ?? null, joinOrder: i })));
    const byRank = [...ranks].sort((x, y) => x[1] - y[1]).map(([id]) => tNew[Number(id)]!);
    if (new Set(ranks.values()).size !== players || byRank.some((t, i) => i > 0 && t > byRank[i - 1]!)) rankBad++;
  }
  const pct = (x: number): string => `${((100 * x) / N).toFixed(2)}%`;
  console.log(
    `${String(players).padStart(2)} players | equal totals in a competition: OLD ${pct(oldEq)} (avg ${(oldPairs / N).toFixed(2)} equal pairs) | ` +
      `rule B alone ${pct(bEq)} | NEW ${pct(newEq)} (incl. players who never scored: ${pct(newEqAll)}) | ` +
      `largest change by the distinct-totals step: ${maxNudge} pts | rank not total-consistent: ${rankBad} | ` +
      `rounds with equal points among scorers: ${pointsBad} | rounds with a wrong winner count: ${winnerBad}`,
  );
}
