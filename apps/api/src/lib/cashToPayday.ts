import { projectCashFlow, type CashEvent, type CashProjection } from '@rise/shared/cash-projection';
import { dateFromDayNumber, dayNumber } from '@rise/shared/networth';
import {
  detectSemimonthly,
  detectSeries,
  projectOccurrences,
  type DetectedSeries,
} from '@rise/shared/recurring';
import { displayNamesFor, listOccurrences, type UserId } from '../db';
import { LOOKBACK_DAYS } from './recurring';

/** How far ahead to project: through this many upcoming paychecks. */
const PAYCHECK_HORIZON = 3;
/** A safety cap on how many future occurrences of one bill we ever project. */
const MAX_BILL_OCCURRENCES = 8;

export interface PaySchedule {
  merchant: string;
  displayName: string;
  series: DetectedSeries;
}

export interface CashToPaydayResult extends CashProjection {
  paySchedules: PaySchedule[];
}

/**
 * The cash-to-payday projection (design: no autopay — a card payment is never one of these
 * events, only real cash in and out). Detection runs live against fresh transactions rather
 * than the persisted `recurring_series` table, since that table doesn't carry the semimonthly
 * anchor days this needs.
 */
export async function buildCashToPaydayProjection(
  db: D1Database,
  userId: UserId,
  today: string,
  startBalanceCents: number,
  cushionCents: number,
): Promise<CashToPaydayResult> {
  const from = dateFromDayNumber(dayNumber(today) - LOOKBACK_DAYS);
  const byMerchant = await listOccurrences(userId, db, from);
  const detected: { merchant: string; series: DetectedSeries }[] = [];
  for (const [merchant, occ] of byMerchant) {
    // Semimonthly first — see the same note in lib/recurring.ts's refreshRecurring.
    const series = detectSemimonthly(occ, today) ?? detectSeries(occ, today);
    if (series && series.status === 'active') detected.push({ merchant, series });
  }
  const displayNames = await displayNamesFor(
    userId,
    db,
    detected.map((d) => d.merchant),
  );

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
    })),
  };
}
