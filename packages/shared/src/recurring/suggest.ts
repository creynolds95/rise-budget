import { dayNumber } from '../networth';
import { within5Pct } from './amount';
import {
  detectSemimonthly,
  detectSeries,
  INTERVAL_TOLERANCE_DAYS,
  type DetectedSeries,
  type Occurrence,
} from './detect';

export interface AccountOccurrence extends Occurrence {
  accountId: string;
  /** Linked or marked as a transfer between the user's own accounts. */
  isTransfer?: boolean;
  /** The other leg's account, when the transfer is linked. */
  pairAccountId?: string | null;
}

/**
 * What really moves cash in or out of the cash accounts, by merchant. Pure.
 *
 * Spending and income count, and so does a transfer out to savings, a loan or the mortgage:
 * that money leaves checking as surely as a bill. Two transfers never count: a card payment
 * (no autopay, so paying a card is never projected) and a move between two cash accounts,
 * which nets to nothing. A transfer whose other leg hasn't been linked counts; if it is a
 * card payment its amount varies, so it rarely forms a schedule, and Dismiss handles it.
 */
export function cashMovements(
  byMerchant: ReadonlyMap<string, readonly AccountOccurrence[]>,
  cashAccountIds: ReadonlySet<string>,
  cardAccountIds: ReadonlySet<string>,
): Map<string, AccountOccurrence[]> {
  const out = new Map<string, AccountOccurrence[]>();
  for (const [merchant, all] of byMerchant) {
    const occ = all.filter(
      (o) =>
        cashAccountIds.has(o.accountId) &&
        !(
          o.isTransfer &&
          o.pairAccountId &&
          (cashAccountIds.has(o.pairAccountId) || cardAccountIds.has(o.pairAccountId))
        ),
    );
    if (occ.length > 0) out.set(merchant, occ);
  }
  return out;
}

export interface SurplusSuggestion {
  merchant: string;
  /** The account its latest occurrence posted to. */
  accountId: string;
  series: DetectedSeries;
}

/**
 * Schedules Surplus asks the user to confirm: an active series found in the cash accounts'
 * own transactions, for a merchant not already in Surplus or dismissed from it. Nothing here
 * is ever projected until the user adds it.
 */
export function surplusSuggestions(
  byMerchant: ReadonlyMap<string, readonly AccountOccurrence[]>,
  cashAccountIds: ReadonlySet<string>,
  skip: ReadonlySet<string>,
  today: string,
): SurplusSuggestion[] {
  const out: SurplusSuggestion[] = [];
  for (const [merchant, all] of byMerchant) {
    if (skip.has(merchant)) continue;
    const occ = [...all]
      .filter((o) => cashAccountIds.has(o.accountId))
      .sort((a, b) => a.date.localeCompare(b.date));
    // Semimonthly first, same as refreshRecurring.
    const series = detectSemimonthly(occ, today) ?? detectSeries(occ, today);
    if (series?.status !== 'active') continue;
    const accountId = occ.reduce((_, o) => o.accountId, '');
    out.push({ merchant, accountId, series });
  }
  return out;
}

/** A hand-added Surplus schedule, for matching a suggestion against it. */
export interface ScheduleShape {
  name: string;
  expectedAmountCents: number;
  /** Its next date, from today on. */
  nextDate: string;
}

/**
 * The hand-added schedule a suggestion looks like (a hand-added "Mortgage" and the mortgage
 * debit sync found): same direction, the same amount within 5%, due within a few days. Only a
 * likeness, never proof (two paychecks can match), so the suggestion is still shown, named as a
 * likely duplicate, and the user decides.
 */
export function likelySameAs(
  s: { expectedAmountCents: number; nextExpectedDate: string },
  schedules: readonly ScheduleShape[],
): string | null {
  const match = schedules.find(
    (r) =>
      Math.sign(r.expectedAmountCents) === Math.sign(s.expectedAmountCents) &&
      within5Pct(s.expectedAmountCents, r.expectedAmountCents) &&
      Math.abs(dayNumber(r.nextDate) - dayNumber(s.nextExpectedDate)) <= INTERVAL_TOLERANCE_DAYS,
  );
  return match?.name ?? null;
}
