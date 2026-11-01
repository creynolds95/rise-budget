import { dayNumber } from '../networth';
import { nextBusinessDay, prevBusinessDay } from './calendar';
import {
  firstUpcoming,
  parts,
  projectOccurrences,
  type DetectedSeries,
  type ProjectedOccurrence,
} from './detect';
import { CYCLE_DAYS } from './miss';

export interface UpcomingOccurrence extends ProjectedOccurrence {
  /**
   * A paycheck the rules say has landed (its date is after the bank's balance date) that the
   * bank hasn't shown yet. Counted, but flagged "expected, not seen yet".
   */
  expectedNotSeen?: true;
}

/**
 * The next `count` times a Surplus schedule moves cash, from today on. Pure.
 *
 * A schedule's stored date can be behind today: it only moves on when the real charge posts
 * (or the balance shows it, or the owner marks it paid). Nothing counts as paid without that
 * proof, so a past date is never silently dropped:
 *
 * - a bill past its date, with no proof it left, is still owed: it counts today, until a whole
 *   cycle has passed (then the missed-bill note is the signal). Hand-added bills are the same.
 * - a paycheck past its date counts today when its business-day landing date is after the
 *   bank's balance date (`balanceAsOf`): the rules bring a stale balance forward, flagged
 *   `expectedNotSeen`. When its date is on or before the balance date the balance already has
 *   it, or doesn't, and is left uncounted: reads low, never high. With no balance date known it
 *   is not counted either.
 *
 * Either way the later dates follow.
 */
export function upcomingOccurrences(
  series: DetectedSeries,
  today: string,
  count: number,
  balanceAsOf: string | null = null,
): UpcomingOccurrence[] {
  if (series.nextExpectedDate >= today) return projectOccurrences(series, count);
  // Walking on keeps the stored date's day of month (a 31st stays the 31st after February).
  const day = parts(series.nextExpectedDate).d;
  const anchorDays = series.anchorDays ?? ([day, day] as [number, number]);
  const rolled = {
    ...series,
    anchorDays,
    nextExpectedDate: firstUpcoming(series.cadence, series.nextExpectedDate, anchorDays, today),
  };
  const late = dayNumber(today) - dayNumber(series.nextExpectedDate);
  // A next cycle landing today means a whole cycle has passed: that date is the one owed.
  const withinCycle = late < CYCLE_DAYS[series.cadence] && rolled.nextExpectedDate > today;
  const amount = series.expectedAmountCents;
  const rest = () => projectOccurrences(rolled, count - 1);
  if (!withinCycle || amount === 0) return projectOccurrences(rolled, count);
  if (amount > 0) return [{ date: today, amountCents: amount }, ...rest()];
  // A paycheck lands on the business day before its date; only one after the balance date is
  // news the balance can't have.
  const landed = prevBusinessDay(series.nextExpectedDate);
  if (balanceAsOf === null || landed <= balanceAsOf) return projectOccurrences(rolled, count);
  return [{ date: today, amountCents: amount, expectedNotSeen: true }, ...rest()];
}

/** When a schedule's money moves: a bill the next business day, a paycheck the one before. */
export function landingDate(date: string, amountCents: number): string {
  return amountCents < 0 ? prevBusinessDay(date) : nextBusinessDay(date);
}
