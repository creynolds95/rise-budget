/**
 * Consumer averages for the monthly report's "vs consumer averages" section. Static on
 * purpose: nothing about the owner's money leaves the app to fetch it, and the data changes
 * once a year.
 *
 * Source: U.S. Bureau of Labor Statistics, Consumer Expenditure Survey, 2024 calendar-year
 * average annual expenditures, all consumer units (released December 2025). Update once a
 * year from the new release; `BENCHMARK_YEAR` is shown in the report. The income-quintile
 * tables are a follow-up: `BENCHMARKS` is keyed by band so they slot in without a schema change.
 */
import type { Cents } from '../budget/money';

export const BENCHMARK_YEAR = 2024;

export const BENCHMARK_GROUPS = [
  'housing',
  'transportation',
  'food-home',
  'food-away',
  'healthcare',
  'entertainment',
  'apparel',
] as const;
export type BenchmarkGroup = (typeof BENCHMARK_GROUPS)[number];

export const BENCHMARK_LABEL: Record<BenchmarkGroup, string> = {
  housing: 'Housing',
  transportation: 'Transportation',
  'food-home': 'Groceries',
  'food-away': 'Dining out',
  healthcare: 'Healthcare',
  entertainment: 'Entertainment',
  apparel: 'Clothing',
};

/** Average annual dollars per consumer unit, whole dollars, from the BLS release. */
const ALL_BAND_ANNUAL_DOLLARS: Record<BenchmarkGroup, number> = {
  housing: 26_266,
  transportation: 13_318,
  'food-home': 6_224,
  'food-away': 3_945,
  healthcare: 6_197,
  entertainment: 3_609,
  apparel: 2_001,
};

/** Total annual expenditures for the same band, the denominator for each group's share. */
const ALL_BAND_TOTAL_DOLLARS = 78_535;

export interface Benchmark {
  /** Monthly average in cents per group. */
  monthlyCents: Record<BenchmarkGroup, Cents>;
  /** Average total monthly spending in cents (all groups, including ones not listed). */
  totalMonthlyCents: Cents;
}

const toMonthly = (dollars: number): Cents => Math.round((dollars * 100) / 12);

export const BENCHMARKS: Record<'all', Benchmark> = {
  all: {
    monthlyCents: Object.fromEntries(
      BENCHMARK_GROUPS.map((g) => [g, toMonthly(ALL_BAND_ANNUAL_DOLLARS[g])]),
    ) as Record<BenchmarkGroup, Cents>,
    totalMonthlyCents: toMonthly(ALL_BAND_TOTAL_DOLLARS),
  },
};

/**
 * Which benchmark group a Rise category belongs to, from its name. Order matters: the
 * specific food groups come before the generic ones. null = no comparable BLS group (debt
 * payments, savings, childcare, and so on stay out of the comparison rather than being
 * forced into the wrong bucket).
 */
const MATCHERS: readonly [BenchmarkGroup, RegExp][] = [
  ['food-away', /restaurant|dining|eating out|takeout|take-out|coffee|fast food|bars?\b/i],
  ['food-home', /grocer|supermarket|food at home/i],
  [
    'housing',
    /mortgage|rent\b|property tax|home insurance|homeowner|utilit|electric|energy|gas bill|water|sewer|trash|internet|hoa|home (repair|maint)|furnish/i,
  ],
  ['transportation', /auto|car |fuel|gasoline|gas station|transit|parking|vehicle|rideshare|toll/i],
  ['healthcare', /health|medical|dental|pharmac|doctor|vision|prescription/i],
  ['entertainment', /entertain|streaming|hobb|movie|subscription|recreation|fun\b/i],
  ['apparel', /cloth|apparel|shoes/i],
];

export function benchmarkGroupOf(categoryName: string): BenchmarkGroup | null {
  for (const [group, re] of MATCHERS) if (re.test(categoryName)) return group;
  return null;
}
