import { assertCents, sumCents, type Cents } from './money';

/**
 * A line that may count toward `spent` (SPEC §2.1). Reporting reads splits; a transaction
 * with no explicit splits is one implicit split of its whole amount (SPEC §3.5).
 */
export interface SpendLine {
  amountCents: Cents;
  /** Linked transfers are never spending (SPEC §3.3, §3.4). */
  isTransfer: boolean;
  /** Pending rows that never posted are excluded after 14 days (SPEC §3.2). */
  isDropped: boolean;
}

/** SUM of the lines that count. Refunds are negative and reduce spent (edge 13). */
export function spentFrom(lines: readonly SpendLine[]): Cents {
  return sumCents(lines.filter((l) => !l.isTransfer && !l.isDropped).map((l) => l.amountCents));
}

export interface CategoryMathInput {
  carriedInCents: Cents;
  plannedCents: Cents;
  spentCents: Cents;
}

export interface CategoryMath {
  availableCents: Cents;
  spentCents: Cents;
  remainingCents: Cents;
}

/** SPEC §2.1: available = carried_in + planned; remaining = available − spent. */
export function categoryMath(input: CategoryMathInput): CategoryMath {
  const carried = assertCents(input.carriedInCents, 'carriedInCents');
  const planned = assertCents(input.plannedCents, 'plannedCents');
  const spent = assertCents(input.spentCents, 'spentCents');
  const available = carried + planned;
  return { availableCents: available, spentCents: spent, remainingCents: available - spent };
}
