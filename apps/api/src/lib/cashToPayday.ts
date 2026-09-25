import { projectCashFlow, type CashEvent, type CashProjection } from '@rise/shared/cash-projection';
import { dateFromDayNumber, dayNumber } from '@rise/shared/networth';
import {
  detectSemimonthly,
  detectSeries,
  projectOccurrences,
  type DetectedSeries,
} from '@rise/shared/recurring';
import { displayNamesFor, listManualRules, listOccurrences, type UserId } from '../db';
import { LOOKBACK_DAYS } from './recurring';

/** How far ahead to project: through this many upcoming paychecks. */
const PAYCHECK_HORIZON = 3;
/** A safety cap on how many future occurrences of one bill we ever project. */
const MAX_BILL_OCCURRENCES = 8;

export interface PaySchedule {
  merchant: string;
  displayName: string;
  series: DetectedSeries;
  /** Hand-declared (tagged from a transaction or added from Surplus directly), never detected. */
  isManual: boolean;
}

export interface CashToPaydayResult extends CashProjection {
  paySchedules: PaySchedule[];
}

/**
 * The cash-to-payday projection (design: no autopay — a card payment is never one of these
 * events, only real cash in and out). Auto-detection runs live against fresh transactions
 * rather than the persisted `recurring_series` table, since that table doesn't carry the
 * semimonthly anchor days this needs. Manually-tagged "Recurring Cash Withdrawal" rules are
 * read from that same table (they're never re-detected) and always projected forward.
 */
export async function buildCashToPaydayProjection(
  db: D1Database,
  userId: UserId,
  today: string,
  startBalanceCents: number,
  cushionCents: number,
  dismissedMerchants: readonly string[] = [],
): Promise<CashToPaydayResult> {
  const from = dateFromDayNumber(dayNumber(today) - LOOKBACK_DAYS);
  const [byMerchant, manualRules] = await Promise.all([
    listOccurrences(userId, db, from),
    listManualRules(userId, db),
  ]);
  const dismissed = new Set(dismissedMerchants);
  const manualMerchants = new Set(manualRules.map((r) => r.merchant_normalized));
  const detected: { merchant: string; series: DetectedSeries }[] = [];
  for (const [merchant, occ] of byMerchant) {
    // A merchant Caleb tagged "Recurring Cash Withdrawal" owns its own rule below — never
    // let live auto-detection compete with it for the same merchant.
    if (manualMerchants.has(merchant)) continue;
    // Dismissed from the Surplus tool (e.g. an ex-employer's payroll) — never resurface it,
    // even though the transactions behind it are still real history (SPEC's live-recompute
    // detection would otherwise keep finding it every request).
    if (dismissed.has(merchant)) continue;
    // Semimonthly first — see the same note in lib/recurring.ts's refreshRecurring.
    const series = detectSemimonthly(occ, today) ?? detectSeries(occ, today);
    if (series && series.status === 'active') detected.push({ merchant, series });
  }
  // A manual rule projects even while flagged `broken` (unconfirmed) — Caleb still wants it
  // planned for; `broken` only ever surfaces as the Dashboard's "hasn't charged since" note.
  for (const r of manualRules) {
    detected.push({
      merchant: r.merchant_normalized,
      series: {
        cadence: r.cadence as DetectedSeries['cadence'],
        expectedAmountCents: r.expected_amount_cents,
        lastDate: r.next_expected_date,
        nextExpectedDate: r.next_expected_date,
        status: 'active',
        categoryId: null,
        occurrences: 0,
        anchorDays: r.anchor_days ? (JSON.parse(r.anchor_days) as [number, number]) : null,
      },
    });
  }
  const displayNames = await displayNamesFor(
    userId,
    db,
    detected.map((d) => d.merchant),
  );
  // A hand-declared event (no real transaction behind it) has no merchant_meta row to look
  // its display name up from — its own label is the only name it has.
  for (const r of manualRules) {
    if (r.label) displayNames.set(r.merchant_normalized, r.label);
  }

  // Income transactions carry a negative amount_cents (SPEC §1.1): these are paychecks.
  const paySchedules = detected.filter((d) => d.series.expectedAmountCents < 0);
  const bills = detected.filter((d) => d.series.expectedAmountCents > 0);

  const payEvents: CashEvent[] = paySchedules.flatMap(({ merchant, series }) =>
    projectOccurrences(series, PAYCHECK_HORIZON).map((o) => ({
      date: o.date,
      cashDeltaCents: -o.amountCents,
      label: displayNames.get(merchant) ?? merchant,
    })),
  );
  const horizonEnd = payEvents.reduce((max, e) => (e.date > max ? e.date : max), today);

  const billEvents: CashEvent[] = bills.flatMap(({ merchant, series }) =>
    projectOccurrences(series, MAX_BILL_OCCURRENCES)
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
  return {
    ...projection,
    paySchedules: paySchedules.map(({ merchant, series }) => ({
      merchant,
      displayName: displayNames.get(merchant) ?? merchant,
      series,
      isManual: manualMerchants.has(merchant),
    })),
  };
}
