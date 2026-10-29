/** Savings goals. Pure: integer cents in, plain numbers out. */

import { allocateByWeights } from '../budget/money';

export interface GoalInput {
  savedCents: number;
  targetCents: number;
  /** What goes in each month; 0 means no pace is set. */
  monthlyCents: number;
}

export interface GoalProgress {
  /** Whole percent, 0–100; floors so an unfinished goal never reads 100. */
  pct: number;
  remainingCents: number;
  /** Months until the target at the monthly amount; 0 when reached, null with no pace. */
  monthsToGo: number | null;
}

export function goalProgress({ savedCents, targetCents, monthlyCents }: GoalInput): GoalProgress {
  const saved = Math.max(0, savedCents);
  const remainingCents = Math.max(0, targetCents - saved);
  const pct = remainingCents === 0 ? 100 : Math.floor((saved * 100) / targetCents);
  const monthsToGo =
    remainingCents === 0 ? 0 : monthlyCents <= 0 ? null : Math.ceil(remainingCents / monthlyCents);
  return { pct, remainingCents, monthsToGo };
}

export const emergencyTargetCents = (months: number, monthlyExpenseCents: number): number =>
  months * monthlyExpenseCents;

/** Months of expenses the savings cover, floored to a tenth; null with no expense figure. */
export function coveredMonths(savedCents: number, monthlyExpenseCents: number): number | null {
  if (monthlyExpenseCents <= 0) return null;
  return Math.floor((Math.max(0, savedCents) * 10) / monthlyExpenseCents) / 10;
}

/**
 * How much of one account's balance each of its goals counts, so two goals on the same
 * account never both count the whole of it. `claims` is each goal's set share, or null for
 * none. Set shares come out first, in goal order, each capped at what is left; whatever is
 * left then splits evenly between the goals with no share set (an odd cent goes to the
 * earlier goal). A negative balance is nothing saved.
 */
export function shareAccountBalance(
  balanceCents: number,
  claims: readonly (number | null)[],
): number[] {
  let left = Math.max(0, balanceCents);
  const out = claims.map((c) => {
    if (c === null) return 0;
    const take = Math.min(c, left);
    left -= take;
    return take;
  });
  const open = claims.flatMap((c, i) => (c === null ? [i] : []));
  if (open.length === 0) return out;
  const even = allocateByWeights(
    left,
    open.map(() => 1),
  );
  open.forEach((i, k) => (out[i] = even[k] as number));
  return out;
}
