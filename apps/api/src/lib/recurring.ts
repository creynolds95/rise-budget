import { dateFromDayNumber, dayNumber } from '@rise/shared/networth';
import {
  advanceManualRule,
  BROKEN_AFTER_DAYS,
  detectSemimonthly,
  detectSeries,
  typicalPostDay,
  type DetectedSeries,
} from '@rise/shared/recurring';
import {
  advanceManualRuleStmt,
  listManualRules,
  listOccurrences,
  manualRuleMerchants,
  markOverdueBrokenStmt,
  setTypicalPostDayStmt,
  upsertSeriesStmt,
  type UserId,
} from '../db';

/** Far enough back to see an annual charge three times. */
export const LOOKBACK_DAYS = 3 * 366 + 8;

/**
 * Re-detect every merchant's series (SPEC §7) and feed `typical_post_day`: per category,
 * the day of its largest monthly bill.
 */
export async function refreshRecurring(db: D1Database, userId: UserId, today: string) {
  const from = dateFromDayNumber(dayNumber(today) - LOOKBACK_DAYS);
  const [byMerchant, manual, manualMerchants] = await Promise.all([
    listOccurrences(userId, db, from),
    listManualRules(userId, db),
    manualRuleMerchants(userId, db),
  ]);
  const found: [string, DetectedSeries][] = [];
  for (const [merchant, occ] of byMerchant) {
    // A merchant Caleb has tagged "Recurring Cash Withdrawal" owns its own rule — never
    // let auto-detection reassign or overwrite it, even once it naturally clears the
    // 3-occurrence bar.
    if (manualMerchants.has(merchant)) continue;
    // Semimonthly first: a true 5th/20th-style pay date is ~15 days apart, which also
    // slips inside biweekly's ±4-day tolerance — but biweekly's fixed 14-day step drifts
    // off the real anchor days over time, so a genuine semimonthly fit wins the tie.
    const s = detectSemimonthly(occ, today) ?? detectSeries(occ, today);
    if (s) found.push([merchant, s]);
  }
  const billDay = new Map<string, { day: number; size: number }>();
  for (const [, s] of found) {
    const day = typicalPostDay(s);
    if (day === null || !s.categoryId) continue;
    const size = Math.abs(s.expectedAmountCents);
    const prev = billDay.get(s.categoryId);
    if (!prev || size > prev.size) billDay.set(s.categoryId, { day, size });
  }
  const manualUpdates = manual.map((r) => {
    const advanced = advanceManualRule(
      {
        cadence: r.cadence as DetectedSeries['cadence'],
        anchorDays: r.anchor_days ? (JSON.parse(r.anchor_days) as [number, number]) : null,
        expectedAmountCents: r.expected_amount_cents,
        nextExpectedDate: r.next_expected_date,
      },
      byMerchant.get(r.merchant_normalized) ?? [],
      today,
    );
    return advanceManualRuleStmt(userId, db, r.id, advanced.nextExpectedDate, advanced.status);
  });
  await db.batch([
    ...found.map(([merchant, s]) => upsertSeriesStmt(userId, db, merchant, s)),
    ...manualUpdates,
    markOverdueBrokenStmt(userId, db, dateFromDayNumber(dayNumber(today) - BROKEN_AFTER_DAYS)),
    ...[...billDay].map(([categoryId, b]) => setTypicalPostDayStmt(userId, db, categoryId, b.day)),
  ]);
  return found.length;
}
