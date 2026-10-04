import { projectCashFlow, type CashEvent, type CashProjection } from '@rise/shared/cash-projection';
import type { Account, User } from '@rise/shared/schemas';
import { upcomingOccurrences, type DetectedSeries } from '@rise/shared/recurring';
import { displayNamesFor, listManualRules, listSuggestions, type UserId } from '../db';

/** How far ahead to project: through this many upcoming paychecks. */
const PAYCHECK_HORIZON = 3;
/** A safety cap on how many future occurrences of one bill we ever project. */
const MAX_BILL_OCCURRENCES = 8;

/** The accounts Surplus counts as cash. None chosen: every budgeted depository account. */
export function cashAccountsOf(settings: User['settings'], accounts: readonly Account[]) {
  const ids = settings.cashAccountIds;
  return ids.length > 0
    ? accounts.filter((a) => ids.includes(a.id))
    : accounts.filter((a) => a.kind === 'depository' && a.includeInBudget);
}

export interface PaySchedule {
  merchant: string;
  displayName: string;
  series: DetectedSeries;
}

/** One paycheck or bill schedule, as the Surplus page lists and edits it. */
export interface ScheduleRow {
  id: string;
  merchant: string;
  displayName: string;
  kind: 'income' | 'expense';
  amountCents: number;
  cadence: DetectedSeries['cadence'];
  anchorDays: [number, number] | null;
  nextExpectedDate: string;
  /** Added by hand from Surplus, so its name is its own. */
  isHandAdded: boolean;
}

/** A schedule sync found in the cash accounts, waiting for the user to add or dismiss it. */
export interface SuggestionRow {
  merchant: string;
  displayName: string;
  accountId: string;
  kind: 'income' | 'expense';
  amountCents: number;
  cadence: DetectedSeries['cadence'];
  anchorDays: [number, number] | null;
  nextExpectedDate: string;
}

export interface CashToPaydayResult extends CashProjection {
  paySchedules: PaySchedule[];
  schedules: ScheduleRow[];
  suggestions: SuggestionRow[];
}

/**
 * The Surplus projection (design: no autopay — a card payment is never one of these events,
 * only real cash in and out). Only schedules the user confirmed are projected; what sync
 * detected in the cash accounts comes back as `suggestions` for review, never counted.
 */
export async function buildCashToPaydayProjection(
  db: D1Database,
  userId: UserId,
  today: string,
  startBalanceCents: number,
  cushionCents: number,
  dismissedMerchants: readonly string[] = [],
): Promise<CashToPaydayResult> {
  const [manualRules, saved] = await Promise.all([
    listManualRules(userId, db),
    listSuggestions(userId, db),
  ]);
  // Re-checked here: an add or dismiss since the last sync takes effect at once.
  const skip = new Set([...dismissedMerchants, ...manualRules.map((r) => r.merchant_normalized)]);
  const pending = saved.filter((r) => !skip.has(r.merchant_normalized));
  // A manual rule projects even while flagged `broken` (unconfirmed) — Caleb still wants it
  // planned for; `broken` only ever surfaces as the Dashboard's "hasn't charged since" note.
  const confirmed = manualRules.map((r) => ({
    rule: r,
    merchant: r.merchant_normalized,
    series: {
      cadence: r.cadence as DetectedSeries['cadence'],
      expectedAmountCents: r.expected_amount_cents,
      lastDate: r.next_expected_date,
      nextExpectedDate: r.next_expected_date,
      status: 'active' as const,
      categoryId: null,
      occurrences: 0,
      anchorDays: r.anchor_days ? (JSON.parse(r.anchor_days) as [number, number]) : null,
    },
  }));
  const displayNames = await displayNamesFor(userId, db, [
    ...confirmed.map((d) => d.merchant),
    ...pending.map((r) => r.merchant_normalized),
  ]);
  // A hand-declared event (no real transaction behind it) has no merchant_meta row to look
  // its display name up from — its own label is the only name it has.
  for (const r of manualRules) {
    if (r.label) displayNames.set(r.merchant_normalized, r.label);
  }

  // Income transactions carry a negative amount_cents (SPEC §1.1): these are paychecks.
  const paySchedules = confirmed.filter((d) => d.series.expectedAmountCents < 0);
  const bills = confirmed.filter((d) => d.series.expectedAmountCents > 0);

  // A hand-added schedule has no charge to wait for; a tagged one waits for its real one.
  const upcoming = (rule: { label: string | null }, series: DetectedSeries, count: number) =>
    upcomingOccurrences(series, today, count, rule.label == null);
  const payEvents: CashEvent[] = paySchedules.flatMap(({ rule, merchant, series }) =>
    upcoming(rule, series, PAYCHECK_HORIZON).map((o) => ({
      date: o.date,
      cashDeltaCents: -o.amountCents,
      label: displayNames.get(merchant) ?? merchant,
    })),
  );
  const horizonEnd = payEvents.reduce((max, e) => (e.date > max ? e.date : max), today);

  const billEvents: CashEvent[] = bills.flatMap(({ rule, merchant, series }) =>
    upcoming(rule, series, MAX_BILL_OCCURRENCES)
      .filter((o) => o.date <= horizonEnd)
      .map((o) => ({
        date: o.date,
        cashDeltaCents: -o.amountCents,
        label: displayNames.get(merchant) ?? merchant,
      })),
  );

  const projection = projectCashFlow(startBalanceCents, today, cushionCents, [
    ...payEvents,
    ...billEvents,
  ]);
  const schedules: ScheduleRow[] = confirmed.map(({ rule, merchant, series }) => ({
    id: rule.id,
    merchant,
    displayName: displayNames.get(merchant) ?? merchant,
    kind: series.expectedAmountCents < 0 ? 'income' : 'expense',
    amountCents: Math.abs(series.expectedAmountCents),
    cadence: series.cadence,
    anchorDays: series.anchorDays,
    // A hand-added date that has passed already happened; show the one coming up.
    nextExpectedDate:
      rule.label != null
        ? (upcoming(rule, series, 1)[0]?.date ?? series.nextExpectedDate)
        : series.nextExpectedDate,
    isHandAdded: rule.label != null,
  }));
  const suggestions: SuggestionRow[] = pending.map((r) => ({
    merchant: r.merchant_normalized,
    displayName: displayNames.get(r.merchant_normalized) ?? r.merchant_normalized,
    accountId: r.account_id,
    kind: r.expected_amount_cents < 0 ? 'income' : 'expense',
    amountCents: Math.abs(r.expected_amount_cents),
    cadence: r.cadence as DetectedSeries['cadence'],
    anchorDays: r.anchor_days ? (JSON.parse(r.anchor_days) as [number, number]) : null,
    nextExpectedDate: r.next_expected_date,
  }));
  return {
    ...projection,
    schedules,
    suggestions,
    paySchedules: paySchedules.map(({ merchant, series }) => ({
      merchant,
      displayName: displayNames.get(merchant) ?? merchant,
      series,
    })),
  };
}
