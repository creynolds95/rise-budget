import { mulDiv } from '../budget/money';

/**
 * Retirement projection. Pure, integer cents, real (inflation-adjusted) dollars: growth is
 * the real rate, so every figure reads in today's money. Contributions land at month end.
 * Rates are basis points (400 = 4.00%) a year, effective: 4% means a balance left alone is
 * 4% bigger after twelve months, so each month grows by (1.04)^(1/12) − 1, not 4% ÷ 12 (which
 * compounds to 4.074%).
 */

const E12 = 10n ** 12n;

/**
 * The monthly rate equivalent to an annual rate of `bps`, in units of 1e-12, to the nearest
 * unit. Exact integer maths: the twelfth root by bisection on BigInt, so every engine agrees to
 * the last digit. Work it out once per projection, not per month.
 */
export function monthlyRateE12(bps: number): number {
  // x = 1e12 × (1 + bps/1e4)^(1/12)  ⇔  x^12 = (1e4 + bps) × 1e140.
  const target = BigInt(10_000 + bps) * 10n ** 140n;
  let lo = E12;
  let hi = 2n * E12;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (mid ** 12n <= target) lo = mid;
    else hi = mid;
  }
  // lo = floor(x); round to nearest: up when (lo + ½)^12 is still at or under the target.
  const x = (2n * lo + 1n) ** 12n <= 4096n * target ? lo + 1n : lo;
  return Number(x - E12);
}

/**
 * One month's growth on a balance: balance × rateE12 / 1e12, rounded half away from zero to
 * whole cents. Exact, and without BigInt in the common case (the Monte Carlo takes millions of
 * steps): the balance is split at 1e5 so every partial product stays a safe integer. A balance
 * too big for that (around $1B at 10%) takes `mulDiv`, which is exact at any size.
 */
export function monthlyGrowth(balanceCents: number, rateE12: number): number {
  const b = Math.abs(balanceCents);
  const lo = b % 100_000;
  const a = ((b - lo) / 100_000) * rateE12; // (hi × rate): growth = (a × 1e5 + lo × rate) / 1e12
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(lo * rateE12)) {
    return mulDiv(balanceCents, rateE12, 1_000_000_000_000);
  }
  const ar = a % 10_000_000;
  const s = ar * 100_000 + lo * rateE12; // < 1e12 + 1e5 × rate: safe
  const sr = s % 1_000_000_000_000;
  const g = (a - ar) / 10_000_000 + (s - sr) / 1_000_000_000_000 + (2 * sr >= 1e12 ? 1 : 0);
  return balanceCents < 0 ? 0 - g : g; // 0 − g, not −g: no negative zero
}

/** One month: growth at the monthly rate, then the month-end contribution. */
export const monthlyStep = (balanceCents: number, rateE12: number): number =>
  balanceCents + monthlyGrowth(balanceCents, rateE12);

function grow(
  startCents: number,
  monthlyContributionCents: number,
  months: number,
  rateE12: number,
): number {
  let balance = startCents;
  for (let m = 0; m < months; m++) {
    balance = monthlyStep(balance, rateE12) + monthlyContributionCents;
  }
  return balance;
}

/**
 * Year by year, each year's one-time amount (a life event, in today's dollars) landing at its
 * end: `lumps[y - 1]` at the end of year y. Missing years add nothing.
 */
function growYears(
  startCents: number,
  monthlyContributionCents: number,
  years: number,
  rateE12: number,
  lumps: readonly number[],
): number[] {
  const out = [startCents];
  let balance = startCents;
  for (let y = 1; y <= years; y++) {
    balance = grow(balance, monthlyContributionCents, 12, rateE12) + (lumps[y - 1] ?? 0);
    out.push(balance);
  }
  return out;
}

export function projectBalance(
  startCents: number,
  monthlyContributionCents: number,
  years: number,
  realGrowthBps: number,
  lumps: readonly number[] = [],
): number {
  if (lumps.length === 0)
    return grow(startCents, monthlyContributionCents, years * 12, monthlyRateE12(realGrowthBps));
  return growYears(
    startCents,
    monthlyContributionCents,
    years,
    monthlyRateE12(realGrowthBps),
    lumps,
  ).at(-1) as number;
}

export interface SeriesPoint {
  year: number;
  balanceCents: number;
}

/** Year-end balances from now (year 0) through `years`. */
export function projectSeries(
  startCents: number,
  monthlyContributionCents: number,
  years: number,
  realGrowthBps: number,
  lumps: readonly number[] = [],
): SeriesPoint[] {
  return growYears(
    startCents,
    monthlyContributionCents,
    years,
    monthlyRateE12(realGrowthBps),
    lumps,
  ).map((balanceCents, year) => ({ year, balanceCents }));
}

/** What a balance supports per month at a safe-withdrawal rate. */
export function monthlyIncomeFor(balanceCents: number, withdrawalBps: number): number {
  return Math.round((balanceCents * withdrawalBps) / 10_000 / 12);
}

/** The balance a monthly spend target needs: the inverse of `monthlyIncomeFor`. */
export function neededBalanceFor(monthlySpendCents: number, withdrawalBps: number): number {
  return Math.round((monthlySpendCents * 12 * 10_000) / withdrawalBps);
}

/**
 * The smallest whole-cent monthly contribution that reaches `targetCents` after `years`.
 * Balance is monotone in the contribution, so this bisects on the real projection rather
 * than trusting an algebraic form that would drift from it by rounding. 0 when the start
 * already gets there; null when it doesn't and there are no months left to contribute in.
 */
export function requiredMonthlyContribution(
  startCents: number,
  targetCents: number,
  years: number,
  realGrowthBps: number,
  lumps: readonly number[] = [],
): number | null {
  const rate = monthlyRateE12(realGrowthBps);
  const at = (monthly: number) =>
    lumps.length === 0
      ? grow(startCents, monthly, years * 12, rate)
      : (growYears(startCents, monthly, years, rate, lumps).at(-1) as number);
  if (at(0) >= targetCents) return 0;
  if (years <= 0) return null;
  // A big enough expense can outrun any contribution up to the target itself; search higher.
  let hi = Math.max(targetCents, 1);
  while (at(hi) < targetCents) hi *= 2;
  let lo = 0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (at(mid) >= targetCents) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
