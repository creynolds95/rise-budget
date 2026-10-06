/** Savings goals. Pure: integer cents in, plain numbers out. */

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
