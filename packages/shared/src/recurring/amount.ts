import { AMOUNT_TOLERANCE_PERCENT } from './detect';

/**
 * Whether one charge is within 5% of the amount it is expected to be, measured against the
 * expected amount (exact integer maths). Use this, not `steadyAmounts`, to compare a single
 * charge with a schedule: `steadyAmounts` of two values measures each against their average,
 * which lets them sit ~10% apart.
 */
export function within5Pct(actualCents: number, expectedCents: number): boolean {
  return (
    100 * Math.abs(actualCents - expectedCents) <=
    AMOUNT_TOLERANCE_PERCENT * Math.abs(expectedCents)
  );
}
