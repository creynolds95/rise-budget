import { dateFromDayNumber, dayNumber } from '../networth';
import {
  addMonths,
  EARLY_MATCH_DAYS,
  nextSemimonthlyDate,
  parts,
  steadyAmounts,
  type Cadence,
} from './detect';
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

/** Whether one of a schedule's due dates falls within its early-match window of `date`. */
export function nearDue(s: SurplusScheduleShape, date: string): boolean {
  const tol = EARLY_MATCH_DAYS[s.cadence];
  const at = dayNumber(date);
  const close = (d: string) => Math.abs(dayNumber(d) - at) <= tol;
  switch (s.cadence) {
    case 'weekly':
    case 'biweekly': {
      const cycle = s.cadence === 'weekly' ? 7 : 14;
      const off = (((at - dayNumber(s.nextExpectedDate)) % cycle) + cycle) % cycle;
      return Math.min(off, cycle - off) <= tol;
    }
    case 'semimonthly':
      return close(
        nextSemimonthlyDate(dateFromDayNumber(at - tol - 1), s.anchorDays as [number, number]),
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
    steadyAmounts([s.amountCents, t.amountCents]);
  const own = schedules.find((s) => !s.isHandAdded && s.merchant === t.merchant);
  if (own) return alike(own) ? { state: 'tracked', name: own.name } : { state: 'untracked' };
  const hand = schedules.find((s) => s.isHandAdded && alike(s) && nearDue(s, t.date));
  if (hand) return { state: 'likely', name: hand.name };
  const suggested = suggestions.get(t.merchant);
  return suggested ? { state: 'suggested', name: suggested } : { state: 'untracked' };
}
