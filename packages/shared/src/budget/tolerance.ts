import type { Cents } from './money';

/** The owner's rounding tolerance: $0.50 either side of a whole-dollar plan. */
export const ROUNDING_TOLERANCE_CENTS = 50;

export interface ToleranceInput {
  plannedCents: Cents;
  availableCents: Cents;
  spentCents: Cents;
}

export interface ToleranceResult {
  /** True when a whole-dollar plan was missed by no more than the tolerance, either way. */
  onBudget: boolean;
  /** What to show as left: 0 when on budget, else the exact remaining. */
  remainingCents: Cents;
  /** What to draw on the rail: the whole available amount when on budget, else the exact spend. */
  spentCents: Cents;
}

/**
 * Display-only. A plan of exactly $16 and a $16.23 charge is on budget, not over by $0.23.
 * Nothing stored changes: carry still rolls the exact remaining, and the exact cents stay in
 * the totals and transactions.
 */
export function applyTolerance(i: ToleranceInput): ToleranceResult {
  const remaining = i.availableCents - i.spentCents;
  const wholeDollarPlan = i.plannedCents > 0 && i.plannedCents % 100 === 0;
  if (wholeDollarPlan && remaining !== 0 && Math.abs(remaining) <= ROUNDING_TOLERANCE_CENTS) {
    return { onBudget: true, remainingCents: 0, spentCents: i.availableCents };
  }
  return { onBudget: remaining === 0, remainingCents: remaining, spentCents: i.spentCents };
}
