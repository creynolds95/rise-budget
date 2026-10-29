import { addPeriods, comparePeriods, type PeriodId } from './period';
import { assertCents, type Cents } from './money';

export const MAX_SPREAD_MONTHS = 12;

export interface SpreadPart {
  categoryId: string;
  amountCents: Cents;
  periodId: PeriodId;
}

/**
 * One charge spread over `months` months starting at its own (SPEC §3.6). Equal parts; the
 * cents that don't divide evenly land on the first month, so the parts always sum exactly.
 */
export function spreadParts(
  totalCents: Cents,
  months: number,
  start: PeriodId,
  categoryId: string,
): SpreadPart[] {
  assertCents(totalCents, 'totalCents');
  if (!Number.isInteger(months) || months < 1 || months > MAX_SPREAD_MONTHS) {
    throw new RangeError(`months must be 1..${MAX_SPREAD_MONTHS}, got ${months}`);
  }
  const base = Math.trunc(totalCents / months);
  const extra = totalCents - base * months;
  return Array.from({ length: months }, (_, i) => ({
    categoryId,
    amountCents: base + (i === 0 ? extra : 0),
    periodId: addPeriods(start, i),
  }));
}

/**
 * How many months a split set is spread over, or 1 when it isn't spread: one category, each
 * split in its own consecutive month starting at the transaction's.
 */
export function spreadMonthsOf(
  txnPeriod: PeriodId,
  splits: readonly { categoryId: string; periodId: PeriodId }[],
): number {
  if (splits.length < 2 || splits.length > MAX_SPREAD_MONTHS) return 1;
  const cat = splits[0]?.categoryId;
  const periods = splits.map((s) => s.periodId).sort(comparePeriods);
  const consecutive = periods.every((p, i) => p === addPeriods(txnPeriod, i));
  return consecutive && splits.every((s) => s.categoryId === cat) ? splits.length : 1;
}
