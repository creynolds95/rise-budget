import { PER_YEAR } from '@rise/shared/recurring';
import type { AlertSettings, ChargeFlag, RecurringSeries } from '@rise/shared/schemas';
import { shortDate } from './dates';
import { formatCents } from './money';

const ALL_ON: AlertSettings = {
  priceUp: true,
  doubleCharge: true,
  duplicate: true,
  unusual: true,
  firstTime: true,
};

/** What the subscription radar says about one series, respecting the owner's choices. */
export function radarNotes(s: RecurringSeries, alerts: AlertSettings = ALL_ON): string[] {
  const notes: string[] = [];
  if (alerts.priceUp && s.priceChangedOn && s.previousAmountCents !== null)
    notes.push(
      `Up from ${formatCents(Math.abs(s.previousAmountCents))} on ${shortDate(s.priceChangedOn)}`,
    );
  if (alerts.doubleCharge && s.doubleChargedOn)
    notes.push(`Charged twice, ${shortDate(s.doubleChargedOn)}`);
  return notes;
}

const FLAG_TEXT: Record<ChargeFlag, [keyof AlertSettings, string]> = {
  duplicate: ['duplicate', 'Possible duplicate'],
  unusual: ['unusual', 'More than usual here'],
  first_time: ['firstTime', 'First charge here'],
};

/** A charge's quiet flag as words, or null when there's none or the owner turned it off. */
export function flagText(
  flag: ChargeFlag | null | undefined,
  alerts: AlertSettings = ALL_ON,
): string | null {
  if (!flag) return null;
  const [key, text] = FLAG_TEXT[flag];
  return alerts[key] ? text : null;
}

/** What the live recurring charges cost in a year: money out only. */
export function yearlyCost(series: readonly RecurringSeries[]): number {
  return series
    .filter((s) => (s.status === 'active' || s.status === 'broken') && s.expectedAmountCents > 0)
    .reduce((n, s) => n + s.expectedAmountCents * PER_YEAR[s.cadence], 0);
}
