/**
 * Monte Carlo over the retirement projection. Pure and deterministic: a seeded RNG, so the
 * same inputs always give the same fan. Integer cents, real dollars, rates in basis points.
 * Each month the balance takes the plain projection's step, then a lognormal shock
 * exp(sd·z) whose median is 1: "Growth after inflation" is the typical (compound) rate, so
 * the median path tracks the straight-line projection instead of falling under it by the
 * volatility drag. A month can't lose more than everything.
 */

import { monthlyRateE12 } from './project';

/**
 * The plain projection's month (`monthlyStep`: the effective monthly rate, rounded to the cent),
 * in plain float maths. The fan takes millions of steps and multiplies each by a float shock
 * anyway; the exact integer step costs ~10× more for an answer that differs only when the
 * product lands within ~1e-11¢ of a half cent. The zero-volatility test holds it to the exact
 * projection.
 */
const fanStep = (balanceCents: number, rateE12: number): number =>
  balanceCents + Math.round((balanceCents * rateE12) / 1e12);

export const MC_RUNS = 5000;
export const MC_SEED = 20_261_006;
export const MC_PERCENTILES = [10, 25, 50, 75, 90] as const;

/** mulberry32: a small, fast, well-distributed 32-bit generator. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Standard normal draw (Box–Muller); the first uniform is kept off zero. */
function gaussian(rand: () => number): number {
  const u = 1 - rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export interface FanPoint {
  year: number;
  /** Balance at each of MC_PERCENTILES, ascending. */
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloResult {
  fan: FanPoint[];
  /** Final balance of every run, ascending. */
  finals: number[];
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0;
}

export function simulateRetirement(opts: {
  startCents: number;
  monthlyContributionCents: number;
  years: number;
  realGrowthBps: number;
  volatilityBps: number;
  runs?: number;
  seed?: number;
}): MonteCarloResult {
  const { startCents, monthlyContributionCents, years, realGrowthBps, volatilityBps } = opts;
  const runs = opts.runs ?? MC_RUNS;
  const rand = seededRandom(opts.seed ?? MC_SEED);
  const sd = volatilityBps / 10_000 / Math.sqrt(12);
  const rate = monthlyRateE12(realGrowthBps);
  const byYear: number[][] = Array.from({ length: years + 1 }, () => []);
  const record = (y: number, balance: number) => (byYear[y] as number[]).push(balance);
  for (let r = 0; r < runs; r++) {
    let balance = startCents;
    record(0, balance);
    for (let y = 1; y <= years; y++) {
      for (let m = 0; m < 12; m++) {
        balance =
          Math.round(fanStep(balance, rate) * Math.exp(sd * gaussian(rand))) +
          monthlyContributionCents;
      }
      record(y, balance);
    }
  }
  const fan = byYear.map((balances, year) => {
    const s = [...balances].sort((a, b) => a - b);
    return {
      year,
      p10: percentile(s, 10),
      p25: percentile(s, 25),
      p50: percentile(s, 50),
      p75: percentile(s, 75),
      p90: percentile(s, 90),
    };
  });
  return { fan, finals: [...(byYear[years] as number[])].sort((a, b) => a - b) };
}

/** Share of runs, as a whole percent, that end at or above the target balance. */
export function successRate(finals: readonly number[], targetCents: number): number {
  if (finals.length === 0) return 0;
  return Math.round((finals.filter((f) => f >= targetCents).length * 100) / finals.length);
}
