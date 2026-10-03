/**
 * Retirement projection. Pure, integer cents, real (inflation-adjusted) dollars: growth is
 * the real rate, so every figure reads in today's money. Contributions land at month end.
 * Rates are basis points (400 = 4.00%).
 */

const monthlyStep = (balanceCents: number, realGrowthBps: number): number =>
  balanceCents + Math.round((balanceCents * realGrowthBps) / 120_000);

export function projectBalance(
  startCents: number,
  monthlyContributionCents: number,
  years: number,
  realGrowthBps: number,
): number {
  let balance = startCents;
  for (let m = 0; m < years * 12; m++) {
    balance = monthlyStep(balance, realGrowthBps) + monthlyContributionCents;
  }
  return balance;
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
): SeriesPoint[] {
  const points: SeriesPoint[] = [{ year: 0, balanceCents: startCents }];
  let balance = startCents;
  for (let y = 1; y <= years; y++) {
    balance = projectBalance(balance, monthlyContributionCents, 1, realGrowthBps);
    points.push({ year: y, balanceCents: balance });
  }
  return points;
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
 * than trusting an algebraic form that would drift from it by rounding.
 */
export function requiredMonthlyContribution(
  startCents: number,
  targetCents: number,
  years: number,
  realGrowthBps: number,
): number {
  if (projectBalance(startCents, 0, years, realGrowthBps) >= targetCents) return 0;
  let lo = 0;
  let hi = targetCents;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (projectBalance(startCents, mid, years, realGrowthBps) >= targetCents) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
