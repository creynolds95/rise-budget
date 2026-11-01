import { dateFromDayNumber, dayNumber } from '../networth';
import { within5Pct } from './amount';
import { addMonths, LATE_MATCH_DAYS, nextSemimonthlyDate, parts, type Cadence } from './detect';
import { earliestMatch } from './calendar';
import { cashMovements } from './suggest';

/** A Surplus schedule as the transaction page sees it. `amountCents` carries the SPEC §1.1 sign. */
export interface SurplusScheduleShape {
  merchant: string;
  name: string;
  amountCents: number;
  cadence: Cadence;
  anchorDays: [number, number] | null;
  /** Any one of its due dates; the rest follow from its cadence. */
  nextExpectedDate: string;
  isHandAdded: boolean;
}

export interface SurplusTxn {
  merchant: string;
  amountCents: number;
  date: string;
  accountId: string;
  isTransfer: boolean;
  pairAccountId: string | null;
}

export type SurplusMatch =
  /** Its merchant's schedule pays on charges like this one. */
  | { state: 'tracked'; name: string }
  /** A hand-added schedule of the same amount falls due around this date. Likely, not proof. */
  | { state: 'likely'; name: string }
  /** Sync found a schedule for this merchant that hasn't been added yet. */
  | { state: 'suggested'; name: string }
  | { state: 'untracked' };

/**
 * Whether one of a schedule's due dates is near `date`: a bill's charge no earlier than a day
 * before it, a paycheck no earlier than its early window, either up to a few days late.
 */
export function nearDue(s: SurplusScheduleShape, date: string): boolean {
  const late = LATE_MATCH_DAYS[s.cadence];
  const income = s.amountCents < 0;
  const at = dayNumber(date);
  const close = (d: string) =>
    at >= dayNumber(earliestMatch(d, income)) && at <= dayNumber(d) + late;
  switch (s.cadence) {
    case 'weekly':
    case 'biweekly': {
      const cycle = s.cadence === 'weekly' ? 7 : 14;
      const k = Math.floor((at - dayNumber(s.nextExpectedDate)) / cycle);
      return [k, k + 1].some((n) =>
        close(dateFromDayNumber(dayNumber(s.nextExpectedDate) + n * cycle)),
      );
    }
    case 'semimonthly':
      return (
        close(
          nextSemimonthlyDate(dateFromDayNumber(at - late - 1), s.anchorDays as [number, number]),
        ) || close(nextSemimonthlyDate(dateFromDayNumber(at - 1), s.anchorDays as [number, number]))
      );
    case 'monthly':
    case 'annual': {
      const step = s.cadence === 'monthly' ? 1 : 12;
      const a = parts(s.nextExpectedDate);
      const t = parts(date);
      const k = Math.floor((t.y * 12 + t.m - (a.y * 12 + a.m)) / step);
      const day = s.anchorDays?.[0] ?? a.d;
      return [k - 1, k, k + 1].some((n) => close(addMonths(s.nextExpectedDate, n * step, day)));
    }
  }
}

/**
 * Whether Surplus counts this transaction, and as which schedule. Pure. Only real cash in or
 * out of the cash accounts can be (`cashMovements`): a card purchase, a card payment or a move
 * between cash accounts never is.
 */
export function surplusMatch(
  t: SurplusTxn,
  schedules: readonly SurplusScheduleShape[],
  suggestions: ReadonlyMap<string, string>,
  cashAccountIds: ReadonlySet<string>,
  cardAccountIds: ReadonlySet<string>,
): SurplusMatch {
  const moves = cashMovements(
    new Map([[t.merchant, [{ ...t, categoryId: null }]]]),
    cashAccountIds,
    cardAccountIds,
  );
  if (moves.size === 0) return { state: 'untracked' };
  const alike = (s: SurplusScheduleShape) =>
    Math.sign(s.amountCents) === Math.sign(t.amountCents) &&
    within5Pct(t.amountCents, s.amountCents);
  const own = schedules.find((s) => !s.isHandAdded && s.merchant === t.merchant);
  if (own) return alike(own) ? { state: 'tracked', name: own.name } : { state: 'untracked' };
  const hand = schedules.find((s) => s.isHandAdded && alike(s) && nearDue(s, t.date));
  if (hand) return { state: 'likely', name: hand.name };
  const suggested = suggestions.get(t.merchant);
  return suggested ? { state: 'suggested', name: suggested } : { state: 'untracked' };
}
