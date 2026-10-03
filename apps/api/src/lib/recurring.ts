import { dateFromDayNumber, dayNumber } from '@rise/shared/networth';
import {
  advanceManualRule,
  detectSemimonthly,
  detectSeries,
  latestByAccount,
  missState,
  surplusSuggestions,
  typicalPostDay,
  type DetectedSeries,
} from '@rise/shared/recurring';
import {
  advanceManualRuleStmt,
  getUser,
  listAccounts,
  listManualRules,
  listOccurrences,
  listDetectedStatuses,
  manualRuleMerchants,
  replaceSuggestionsStmts,
  setSeriesStatusStmt,
  setTypicalPostDayStmt,
  upsertSeriesStmt,
  type UserId,
} from '../db';
import { cashAccountsOf } from './cashToPayday';

/** Far enough back to see an annual charge three times. */
export const LOOKBACK_DAYS = 3 * 366 + 8;

/**
 * Re-detect every merchant's series (SPEC §7), feed `typical_post_day` (per category, the
 * day of its largest monthly bill), and rebuild the Surplus suggestions.
 */
export async function refreshRecurring(db: D1Database, userId: UserId, today: string) {
  const from = dateFromDayNumber(dayNumber(today) - LOOKBACK_DAYS);
  const [byMerchant, manual, manualMerchants, user, accounts, existing] = await Promise.all([
    listOccurrences(userId, db, from),
    listManualRules(userId, db),
    manualRuleMerchants(userId, db),
    getUser(userId, db),
    listAccounts(userId, db),
    listDetectedStatuses(userId, db),
  ]);
  const latest = latestByAccount(byMerchant);
  // A miss is only clay when it's knowable and unexplained (shared/recurring/miss.ts).
  const stateOf = (
    merchant: string,
    cadence: DetectedSeries['cadence'],
    due: string,
    cents: number,
  ) =>
    missState(
      {
        merchant,
        cadence,
        nextExpectedDate: due,
        expectedAmountCents: cents,
        accountId: byMerchant.get(merchant)?.at(-1)?.accountId ?? null,
      },
      byMerchant,
      latest,
      today,
    );
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
  const suggestions = user
    ? surplusSuggestions(
        byMerchant,
        new Set(cashAccountsOf(user.settings, accounts).map((a) => a.id)),
        new Set([
          ...manualMerchants,
          ...user.settings.dismissedPayMerchants.map((d) => d.merchant),
        ]),
        today,
      )
    : [];
  // A series that no longer fits keeps its last prediction; only its status moves on.
  const detected = new Set(found.map(([merchant]) => merchant));
  const stale = existing.flatMap((r) => {
    if (r.source !== 'detected' || r.status === 'ended' || !r.next_expected_date) return [];
    if (detected.has(r.merchant_normalized)) return [];
    const next = stateOf(
      r.merchant_normalized,
      r.cadence,
      r.next_expected_date,
      r.expected_amount_cents,
    );
    return next === r.status ? [] : [setSeriesStatusStmt(userId, db, r.id, next)];
  });
  await db.batch([
    ...found.map(([merchant, s]) =>
      upsertSeriesStmt(userId, db, merchant, {
        ...s,
        status: stateOf(merchant, s.cadence, s.nextExpectedDate, s.expectedAmountCents),
      }),
    ),
    ...manualUpdates,
    ...stale,
    ...[...billDay].map(([categoryId, b]) => setTypicalPostDayStmt(userId, db, categoryId, b.day)),
    ...replaceSuggestionsStmts(userId, db, suggestions),
  ]);
  return found.length;
}
