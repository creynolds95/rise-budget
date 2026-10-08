import { periodOf, spreadMonthsOf } from '@rise/shared/budget';
import type { Transaction } from '@rise/shared/schemas';

/** How many months a transaction is spread over (SPEC §3.6); 1 when it isn't. */
export const spreadMonths = (t: Pick<Transaction, 'postedAt' | 'splits'>): number =>
  spreadMonthsOf(periodOf(t.postedAt), t.splits);

/** The part a spread transaction draws in one month, as "2 of 12", or null. */
export function spreadPart(
  t: Pick<Transaction, 'postedAt' | 'splits'>,
  periodId: string,
): { index: number; months: number; amountCents: number } | null {
  const months = spreadMonths(t);
  if (months < 2) return null;
  const sorted = [...t.splits].sort((a, b) => a.periodId.localeCompare(b.periodId));
  const i = sorted.findIndex((s) => s.periodId === periodId);
  const s = sorted[i];
  return s ? { index: i + 1, months, amountCents: s.amountCents } : null;
}
