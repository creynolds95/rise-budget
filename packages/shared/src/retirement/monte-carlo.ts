/**
 * Monte Carlo over the retirement plan. Pure and seeded, so a run is repeatable. Integer
 * cents, real dollars. Each year draws one market return around the plan's real growth with
 * the plan's volatility; contributions go in until the retirement age, then the monthly
 * spend comes out until the horizon age. A trial "lasts" if money remains at the horizon.
 */

export interface MonteCarloInput {
  startCents: number;
  monthlyContributionCents: number;
  /** Monthly spend drawn from the retirement age on, in today's dollars. */
  monthlySpendCents: number;
  /** Whole years from now until retirement, and until the horizon (>= retirement). */
  yearsToRetire: number;
  yearsToHorizon: number;
  realGrowthBps: number;
  volatilityBps: number;
  trials: number;
  seed: number;
}

export interface MonteCarloPoint {
  year: number;
  p10Cents: number;
  p50Cents: number;
  p90Cents: number;
}

export interface MonteCarloResult {
  /** Year 0 through the horizon. */
  series: MonteCarloPoint[];
  /** Percent of trials with money left at the horizon, 0-100. */
  successPct: number;
}

/** mulberry32: a tiny seeded generator, uniform in [0, 1). */
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

/** Standard normal draw (Box-Muller); `1 - u` keeps the log argument above zero. */
export function normalDraw(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** Nearest-rank percentile of an ascending array. */
const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;

export function simulateRetirement(input: MonteCarloInput): MonteCarloResult {
  const rand = seededRandom(input.seed);
  const mean = input.realGrowthBps / 10_000;
  const vol = input.volatilityBps / 10_000;
  const years = input.yearsToHorizon;
  const columns: number[][] = Array.from({ length: years + 1 }, () => []);
  const push = (y: number, v: number) => (columns[y] as number[]).push(v);
  let lasted = 0;
  for (let t = 0; t < input.trials; t++) {
    let balance = input.startCents;
    push(0, balance);
    for (let y = 1; y <= years; y++) {
      // A year can't lose more than everything.
      const r = Math.max(-1, mean + vol * normalDraw(rand));
      const flow =
        y <= input.yearsToRetire
          ? input.monthlyContributionCents * 12
          : -input.monthlySpendCents * 12;
      balance = Math.max(0, Math.round(balance * (1 + r)) + flow);
      push(y, balance);
    }
    if (balance > 0) lasted++;
  }
  return {
    series: columns.map((col, year) => {
      const sorted = [...col].sort((a, b) => a - b);
      return {
        year,
        p10Cents: percentile(sorted, 10),
        p50Cents: percentile(sorted, 50),
        p90Cents: percentile(sorted, 90),
      };
    }),
    successPct: input.trials === 0 ? 0 : Math.round((lasted * 100) / input.trials),
  };
}
