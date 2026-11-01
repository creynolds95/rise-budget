import { projectCashFlow, type CashEvent, type CashProjection } from '@rise/shared/cash-projection';
import type { Account, User } from '@rise/shared/schemas';
import {
  likelySameAs,
  upcomingOccurrences,
  withAmountChange,
  nextBusinessDay,
  prevBusinessDay,
  type AmountChange,
  type DetectedSeries,
} from '@rise/shared/recurring';
import { changeOf, displayNamesFor, listManualRules, listSuggestions, type UserId } from '../db';
import { localToday } from './dates';
import { loadBalanceEvidence, paidAlready } from './balanceSeen';

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

/**
 * The date the bank's balance is from: the oldest any cash account last reported, in the
 * owner's day. Null when there are none or one has never reported.
 */
export function balanceAsOfOf(cash: readonly Account[], timeZone: string): string | null {
  const days: string[] = [];
  for (const a of cash) {
    if (a.lastSyncedAt === null) return null;
    days.push(localToday(timeZone, new Date(a.lastSyncedAt)));
  }
  return days.sort()[0] ?? null;
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
  /** A new amount from a date on, unsigned like `amountCents`. */
  change: AmountChange | null;
  /** The bank balance already shows this one; its transaction hasn't reached Rise yet. */
  inBalance: boolean;
  /** Days its transaction usually trails the balance, once learned. */
  lagDays: number | null;
  /** A paycheck the rules count as landed that the bank hasn't shown yet. */
  expectedNotSeen: boolean;
  /** A bill past its date with no proof it left: still owed, counted today. */
  owedUnseen: boolean;
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
  /** The hand-added schedule this looks like, so adding it may count it twice. */
  likelySameAs: string | null;
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
  /** The cash accounts behind `startBalanceCents`: their balance history is the evidence. */
  cashAccountIds: readonly string[] = [],
  /**
   * The date the bank's balance is from (the oldest of the cash accounts'). The rules bring
   * it forward to today: what they say happened since is counted until the bank shows it.
   */
  balanceAsOf: string | null = null,
): Promise<CashToPaydayResult> {
  const [manualRules, saved] = await Promise.all([
    listManualRules(userId, db),
    listSuggestions(userId, db),
  ]);
  const { seen } = await loadBalanceEvidence(db, userId, manualRules, cashAccountIds, today);
  // Re-checked here: an add or dismiss since the last sync takes effect at once.
  const skip = new Set([...dismissedMerchants, ...manualRules.map((r) => r.merchant_normalized)]);
  const pending = saved.filter((r) => !skip.has(r.merchant_normalized));
  // A manual rule projects even while flagged `broken` (unconfirmed) — the owner still wants it
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

  // Nothing counts as paid without proof (a charge, the balance, or the owner's say-so), for a
  // hand-added schedule as much as a tagged one.
  const upcoming = (rule: (typeof manualRules)[number], series: DetectedSeries, count: number) =>
    withAmountChange(upcomingOccurrences(series, today, count, balanceAsOf), changeOf(rule));
  // The bank balance can show a bill (or paycheck) before its transaction reaches Rise: that
  // one already moved the starting balance, so it is not projected a second time.
  const ahead = (rule: (typeof manualRules)[number], series: DetectedSeries, count: number) => {
    const all = upcoming(rule, series, count + 1);
    return paidAlready(seen.get(rule.id), all[0], today) ? all.slice(1) : all.slice(0, count);
  };
  // A paycheck lands the business day before its date (weekend or bank holiday). When that day
  // is already behind us it counts today only if the bank's balance is older than it.
  const payLanding = (date: string, flagged: boolean): string | null => {
    if (flagged) return date;
    const landed = prevBusinessDay(date);
    if (landed >= today) return landed;
    return balanceAsOf !== null && landed > balanceAsOf ? today : null;
  };
  const payRuns = paySchedules.map(({ rule, merchant, series }) =>
    ahead(rule, series, PAYCHECK_HORIZON).flatMap((o) => {
      const date = payLanding(o.date, 'expectedNotSeen' in o);
      return date
        ? [{ date, cashDeltaCents: -o.amountCents, label: displayNames.get(merchant) ?? merchant }]
        : [];
    }),
  );
  // The horizon ends where the soonest-ending schedule's projected paychecks run out. Past
  // that, a faster schedule's later paychecks are missing while bills keep landing, which
  // reads as a shortfall that isn't there.
  const runEnds = payRuns.flatMap((r) => r.at(-1)?.date ?? []);
  const horizonEnd = runEnds.length ? runEnds.reduce((a, b) => (b < a ? b : a)) : today;
  const payEvents: CashEvent[] = payRuns.flat().filter((e) => e.date <= horizonEnd);

  const billEvents: CashEvent[] = bills.flatMap(({ rule, merchant, series }) =>
    ahead(rule, series, MAX_BILL_OCCURRENCES)
      .filter((o) => o.date <= horizonEnd)
      .map((o) => ({
        // A bill due on a weekend or bank holiday is taken the next business day. A late one
        // owed today stays today: it is already overdue, so moving it later would only read
        // Surplus high.
        date:
          series.nextExpectedDate < today && o.date === today ? o.date : nextBusinessDay(o.date),
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
    change: rule.amount_changes_on
      ? { amountCents: Math.abs(rule.next_amount_cents ?? 0), on: rule.amount_changes_on }
      : null,
    inBalance: seen.has(rule.id),
    lagDays: rule.balance_lag_days,
    expectedNotSeen:
      series.expectedAmountCents < 0 &&
      !seen.has(rule.id) &&
      upcoming(rule, series, 1).some((o) => 'expectedNotSeen' in o),
    owedUnseen:
      series.expectedAmountCents > 0 && !seen.has(rule.id) && series.nextExpectedDate < today,
  }));
  // Hand-added schedules only: a tagged one already hides its own merchant's suggestion.
  const handAdded = schedules
    .filter((r) => r.isHandAdded)
    .map((r) => ({
      name: r.displayName,
      expectedAmountCents: r.kind === 'income' ? -r.amountCents : r.amountCents,
      nextDate: r.nextExpectedDate,
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
    likelySameAs: likelySameAs(
      { expectedAmountCents: r.expected_amount_cents, nextExpectedDate: r.next_expected_date },
      handAdded,
    ),
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
