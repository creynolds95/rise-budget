import { dateFromDayNumber, dayNumber } from '@rise/shared/networth';
import {
  advanceManualRule,
  amountOn,
  cashMovements,
  detectSemimonthly,
  firstUpcoming,
  detectSeries,
  latestByAccount,
  missState,
  surplusSuggestions,
  typicalPostDay,
  type AccountOccurrence,
  type DetectedSeries,
} from '@rise/shared/recurring';
import {
  advanceManualRuleStmt,
  changeOf,
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
  const [withTransfers, manual, manualMerchants, user, accounts, existing] = await Promise.all([
    listOccurrences(userId, db, from),
    listManualRules(userId, db),
    manualRuleMerchants(userId, db),
    getUser(userId, db),
    listAccounts(userId, db),
    listDetectedStatuses(userId, db),
  ]);
  // Spending and income only: a transfer is never a bill, a paycheck, or a budget series.
  const byMerchant = new Map<string, AccountOccurrence[]>();
  for (const [merchant, occ] of withTransfers) {
    const spent = occ.filter((o) => !o.isTransfer);
    if (spent.length > 0) byMerchant.set(merchant, spent);
  }
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
    const anchorDays = r.anchor_days ? (JSON.parse(r.anchor_days) as [number, number]) : null;
    const cadence = r.cadence as DetectedSeries['cadence'];
    // Hand-added: no transaction will ever confirm it, so it simply moves on with the calendar.
    const advanced =
      r.label != null
        ? {
            nextExpectedDate: firstUpcoming(cadence, r.next_expected_date, anchorDays, today),
            status: 'active' as const,
          }
        : advanceManualRule(
            {
              cadence,
              anchorDays,
              // A paycheck due after a pending change is matched against its new amount.
              expectedAmountCents: amountOn(
                r.expected_amount_cents,
                changeOf(r),
                r.next_expected_date,
              ),
              nextExpectedDate: r.next_expected_date,
            },
            // Transfers included: a savings or loan transfer confirms its rule like a bill does.
            withTransfers.get(r.merchant_normalized) ?? [],
            today,
          );
    return advanceManualRuleStmt(
      userId,
      db,
      r.id,
      advanced.nextExpectedDate,
      advanced.status,
      'anchorDays' in advanced ? advanced.anchorDays : null,
    );
  });
  const cashIds = user ? new Set(cashAccountsOf(user.settings, accounts).map((a) => a.id)) : null;
  const suggestions =
    user && cashIds
      ? surplusSuggestions(
          cashMovements(
            withTransfers,
            cashIds,
            new Set(accounts.filter((a) => a.kind === 'credit').map((a) => a.id)),
          ),
          cashIds,
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
