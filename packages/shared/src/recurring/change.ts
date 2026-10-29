import type { ProjectedOccurrence } from './detect';

/** A schedule's amount from a date on (a paycheck after a 401k change). Signed like the schedule. */
export interface AmountChange {
  amountCents: number;
  on: string;
}

/** The amount a schedule moves on `date`: the new one from the change's date on. Pure. */
export function amountOn(baseCents: number, change: AmountChange | null, date: string): number {
  return change && date >= change.on ? change.amountCents : baseCents;
}

/** Projected occurrences with the change applied from its date on. Pure. */
export function withAmountChange(
  occurrences: readonly ProjectedOccurrence[],
  change: AmountChange | null,
): ProjectedOccurrence[] {
  return occurrences.map((o) => ({ ...o, amountCents: amountOn(o.amountCents, change, o.date) }));
}
