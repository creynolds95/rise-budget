import type {
  AccountOccurrence,
  AmountChange,
  DetectedSeries,
  SurplusSuggestion,
} from '@rise/shared/recurring';
import { RecurringSeries } from '@rise/shared/schemas';
import { nowIso, type UserId } from './util';

/**
 * Recurring series (SPEC §7). One series per merchant; the id is derived from it so every
 * refresh updates the same row.
 */

/** Charges that count, each with its category when it was filed under exactly one. */
export async function listOccurrences(
  userId: UserId,
  db: D1Database,
  from: string,
): Promise<Map<string, AccountOccurrence[]>> {
  // H1: every occurrence always has a split now (a guess or the catch-all), so a category
  // only counts here once the user has actually reviewed it — otherwise every merchant would
  // "establish" whatever its unconfirmed guess happened to be. Transfers come back too, with
  // their other leg's account: a transfer out to savings or a loan is real cash for Surplus.
  const { results } = await db
    .prepare(
      `SELECT t.merchant_normalized, t.account_id, t.posted_at, t.amount_cents, t.is_transfer,
         CASE WHEN t.review_state = 'reviewed' THEN
           (SELECT CASE WHEN COUNT(*) = 1 THEN MAX(s.category_id) END FROM split s
             WHERE s.user_id = ?1 AND s.txn_id = t.id)
         END AS category_id,
         (SELECT p.account_id FROM txn p WHERE p.id = t.transfer_pair_id AND p.user_id = ?1)
           AS pair_account_id
       FROM txn t
       WHERE t.user_id = ?1 AND t.posted_at >= ?2 AND t.is_pending = 0
         AND t.review_state != 'dropped'
       ORDER BY t.posted_at`,
    )
    .bind(userId, from)
    .all<{
      merchant_normalized: string;
      account_id: string;
      posted_at: string;
      amount_cents: number;
      is_transfer: number;
      category_id: string | null;
      pair_account_id: string | null;
    }>();
  const out = new Map<string, AccountOccurrence[]>();
  for (const r of results) {
    const o = {
      date: r.posted_at,
      amountCents: r.amount_cents,
      categoryId: r.category_id,
      accountId: r.account_id,
      isTransfer: r.is_transfer === 1,
      pairAccountId: r.pair_account_id,
    };
    out.set(r.merchant_normalized, [...(out.get(r.merchant_normalized) ?? []), o]);
  }
  return out;
}

export const seriesId = (userId: UserId, merchant: string) => `${userId}|${merchant}`;

/** Merchants with a manually-declared cash-withdrawal rule — skip these in auto-detection. */
export async function manualRuleMerchants(userId: UserId, db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      "SELECT merchant_normalized FROM recurring_series WHERE user_id = ?1 AND source = 'manual'",
    )
    .bind(userId)
    .all<{ merchant_normalized: string }>();
  return new Set(results.map((r) => r.merchant_normalized));
}

export interface ManualRuleRow {
  id: string;
  merchant_normalized: string;
  cadence: string;
  expected_amount_cents: number;
  next_expected_date: string;
  anchor_days: string | null;
  label: string | null;
  next_amount_cents: number | null;
  amount_changes_on: string | null;
}

/** A rule's pending amount change, if any (both columns set together). */
export const changeOf = (r: ManualRuleRow): AmountChange | null =>
  r.next_amount_cents != null && r.amount_changes_on != null
    ? { amountCents: r.next_amount_cents, on: r.amount_changes_on }
    : null;

/** Every manual rule (the owner's "Recurring Cash Withdrawal" tag), for `refreshRecurring`. */
export async function listManualRules(userId: UserId, db: D1Database): Promise<ManualRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, merchant_normalized, cadence, expected_amount_cents, next_expected_date,
         anchor_days, label, next_amount_cents, amount_changes_on
       FROM recurring_series WHERE user_id = ?1 AND source = 'manual'`,
    )
    .bind(userId)
    .all<ManualRuleRow>();
  return results;
}

/**
 * A hand-declared paycheck or bill for Runway (no transaction behind it), keyed on a
 * synthetic merchant id so it never collides with a real one. `amountCents` carries the
 * SPEC §1.1 sign (negative = income) same as every other manual rule.
 */
export function upsertManualEventStmt(
  userId: UserId,
  db: D1Database,
  id: string,
  label: string,
  cadence: string,
  amountCents: number,
  nextExpectedDate: string,
  anchorDays: [number, number] | null = null,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO recurring_series (id, user_id, merchant_normalized, category_id, cadence,
         expected_amount_cents, next_expected_date, status, updated_at, source, anchor_days,
         label)
       VALUES (?2, ?1, ?2, NULL, ?3, ?4, ?5, 'active', ?6, 'manual', ?8, ?7)`,
    )
    .bind(
      userId,
      seriesId(userId, id),
      cadence,
      amountCents,
      nextExpectedDate,
      nowIso(),
      label,
      anchorDays ? JSON.stringify(anchorDays) : null,
    );
}

/** Edit an existing manual rule (tagged or hand-added) in place; `label` only renames a hand-added one. */
export function updateManualRuleStmt(
  userId: UserId,
  db: D1Database,
  id: string,
  v: {
    cadence: string;
    amountCents: number;
    nextExpectedDate: string;
    anchorDays: [number, number] | null;
    label?: string | undefined;
    change: AmountChange | null;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE recurring_series SET cadence = ?3, expected_amount_cents = ?4,
         next_expected_date = ?5, anchor_days = ?6, status = 'active', updated_at = ?7,
         label = CASE WHEN label IS NULL THEN NULL ELSE COALESCE(?8, label) END,
         next_amount_cents = ?9, amount_changes_on = ?10
       WHERE user_id = ?1 AND id = ?2 AND source = 'manual'`,
    )
    .bind(
      userId,
      id,
      v.cadence,
      v.amountCents,
      v.nextExpectedDate,
      v.anchorDays ? JSON.stringify(v.anchorDays) : null,
      nowIso(),
      v.label ?? null,
      v.change?.amountCents ?? null,
      v.change?.on ?? null,
    );
}

/** A hand-declared manual event, never one tagged from a real transaction. */
export function deleteManualEventStmt(
  userId: UserId,
  db: D1Database,
  id: string,
): D1PreparedStatement {
  return db
    .prepare(
      "DELETE FROM recurring_series WHERE user_id = ?1 AND id = ?2 AND source = 'manual' AND label IS NOT NULL",
    )
    .bind(userId, id);
}

/** Every hand-declared paycheck/bill (never one tagged from a transaction), for Runway. */
export async function listManualEvents(userId: UserId, db: D1Database): Promise<ManualRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, merchant_normalized, cadence, expected_amount_cents, next_expected_date,
         anchor_days, label, next_amount_cents, amount_changes_on
       FROM recurring_series WHERE user_id = ?1 AND source = 'manual' AND label IS NOT NULL
       ORDER BY next_expected_date`,
    )
    .bind(userId)
    .all<ManualRuleRow>();
  return results;
}

/** Create (or replace) a manual rule from a tagged transaction. One per merchant. */
export function upsertManualRuleStmt(
  userId: UserId,
  db: D1Database,
  merchant: string,
  cadence: string,
  amountCents: number,
  nextExpectedDate: string,
  anchorDays: [number, number] | null = null,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO recurring_series (id, user_id, merchant_normalized, category_id, cadence,
         expected_amount_cents, next_expected_date, status, updated_at, source, anchor_days)
       VALUES (?2, ?1, ?3, NULL, ?4, ?5, ?6, 'active', ?7, 'manual', ?8)
       ON CONFLICT (id) DO UPDATE SET
         cadence = excluded.cadence, expected_amount_cents = excluded.expected_amount_cents,
         next_expected_date = excluded.next_expected_date, status = 'active',
         updated_at = excluded.updated_at, source = 'manual', anchor_days = excluded.anchor_days
       WHERE recurring_series.user_id = ?1`,
    )
    .bind(
      userId,
      seriesId(userId, merchant),
      merchant,
      cadence,
      amountCents,
      nextExpectedDate,
      nowIso(),
      anchorDays ? JSON.stringify(anchorDays) : null,
    );
}

/** Advancing a manual rule after a confirming (or missed) check — never changes its cadence. */
export function advanceManualRuleStmt(
  userId: UserId,
  db: D1Database,
  id: string,
  nextExpectedDate: string,
  status: 'active' | 'broken',
  anchorDays: [number, number] | null = null,
): D1PreparedStatement {
  // A rule saved without its days keeps the ones it was first due on (never re-anchored).
  // Once every date still ahead is on or after a pending amount change, it becomes the amount.
  return db
    .prepare(
      `UPDATE recurring_series SET next_expected_date = ?3, status = ?4, updated_at = ?5,
         anchor_days = COALESCE(anchor_days, ?6),
         expected_amount_cents = CASE WHEN ?3 >= amount_changes_on
           THEN next_amount_cents ELSE expected_amount_cents END,
         next_amount_cents = CASE WHEN ?3 >= amount_changes_on THEN NULL ELSE next_amount_cents END,
         amount_changes_on = CASE WHEN ?3 >= amount_changes_on THEN NULL ELSE amount_changes_on END
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(
      userId,
      id,
      nextExpectedDate,
      status,
      nowIso(),
      anchorDays ? JSON.stringify(anchorDays) : null,
    );
}

/** Untag: delete the manual rule (never a detected one — the route checks `source` first). */
export function deleteManualRuleStmt(
  userId: UserId,
  db: D1Database,
  id: string,
): D1PreparedStatement {
  return db
    .prepare("DELETE FROM recurring_series WHERE user_id = ?1 AND id = ?2 AND source = 'manual'")
    .bind(userId, id);
}

/** A series the user marked `ended` stays ended. */
export function upsertSeriesStmt(
  userId: UserId,
  db: D1Database,
  merchant: string,
  s: Omit<DetectedSeries, 'status'> & { status: 'active' | 'broken' | 'lapsed' },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO recurring_series (id, user_id, merchant_normalized, category_id, cadence,
         expected_amount_cents, next_expected_date, status, updated_at)
       VALUES (?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (id) DO UPDATE SET
         category_id = excluded.category_id, cadence = excluded.cadence,
         expected_amount_cents = excluded.expected_amount_cents,
         next_expected_date = excluded.next_expected_date,
         status = CASE WHEN recurring_series.status = 'ended' THEN 'ended' ELSE excluded.status END,
         updated_at = excluded.updated_at
       WHERE recurring_series.user_id = ?1`,
    )
    .bind(
      userId,
      seriesId(userId, merchant),
      merchant,
      s.categoryId,
      s.cadence,
      s.expectedAmountCents,
      s.nextExpectedDate,
      s.status,
      nowIso(),
    );
}

/**
 * A detected series' status: recomputed by refresh (`active` / `broken` / `lapsed`), or the
 * user's own call (`ended`, or `active` to track it again). Never touches a manual rule.
 */
export function setSeriesStatusStmt(
  userId: UserId,
  db: D1Database,
  id: string,
  status: 'active' | 'broken' | 'lapsed' | 'ended',
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE recurring_series SET status = ?3, updated_at = ?4
       WHERE user_id = ?1 AND id = ?2 AND source = 'detected'`,
    )
    .bind(userId, id, status, nowIso());
}

/** What refresh needs to re-judge a detected series it no longer finds. Raw rows: no parse. */
export async function listDetectedStatuses(userId: UserId, db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT id, merchant_normalized, cadence, expected_amount_cents, next_expected_date, status,
         source
       FROM recurring_series WHERE user_id = ?1`,
    )
    .bind(userId)
    .all<{
      id: string;
      merchant_normalized: string;
      cadence: DetectedSeries['cadence'];
      expected_amount_cents: number;
      next_expected_date: string | null;
      status: string;
      source: string;
    }>();
  return results;
}

interface SeriesRow {
  id: string;
  merchant_normalized: string;
  category_id: string | null;
  cadence: string;
  expected_amount_cents: number;
  next_expected_date: string | null;
  status: string;
  updated_at: string;
  source: string;
}

export async function listSeries(userId: UserId, db: D1Database): Promise<RecurringSeries[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM recurring_series WHERE user_id = ?1 ORDER BY next_expected_date, merchant_normalized',
    )
    .bind(userId)
    .all<SeriesRow>();
  return results.map((r) =>
    RecurringSeries.parse({
      id: r.id,
      merchantNormalized: r.merchant_normalized,
      categoryId: r.category_id,
      cadence: r.cadence,
      expectedAmountCents: r.expected_amount_cents,
      nextExpectedDate: r.next_expected_date,
      status: r.status,
      source: r.source,
      updatedAt: r.updated_at,
    }),
  );
}

/** Pace reads this for fixed-shape categories (SPEC §2.7). Not money: display only. */
export function setTypicalPostDayStmt(
  userId: UserId,
  db: D1Database,
  categoryId: string,
  day: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE category SET typical_post_day = ?3
       WHERE user_id = ?1 AND id = ?2 AND (typical_post_day IS NULL OR typical_post_day != ?3)`,
    )
    .bind(userId, categoryId, day);
}

/** Rebuild the user's Surplus suggestions from scratch (one refresh's whole answer). */
export function replaceSuggestionsStmts(
  userId: UserId,
  db: D1Database,
  suggestions: readonly SurplusSuggestion[],
): D1PreparedStatement[] {
  const now = nowIso();
  return [
    db.prepare('DELETE FROM surplus_suggestion WHERE user_id = ?1').bind(userId),
    ...suggestions.map(({ merchant, accountId, series: s }) =>
      db
        .prepare(
          `INSERT INTO surplus_suggestion (id, user_id, merchant_normalized, account_id, cadence,
             expected_amount_cents, next_expected_date, anchor_days, updated_at)
           VALUES (?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(
          userId,
          seriesId(userId, merchant),
          merchant,
          accountId,
          s.cadence,
          s.expectedAmountCents,
          s.nextExpectedDate,
          s.anchorDays ? JSON.stringify(s.anchorDays) : null,
          now,
        ),
    ),
  ];
}

export interface SuggestionRow {
  merchant_normalized: string;
  account_id: string;
  cadence: string;
  expected_amount_cents: number;
  next_expected_date: string;
  anchor_days: string | null;
}

export async function listSuggestions(userId: UserId, db: D1Database): Promise<SuggestionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT merchant_normalized, account_id, cadence, expected_amount_cents,
         next_expected_date, anchor_days
       FROM surplus_suggestion WHERE user_id = ?1 ORDER BY next_expected_date`,
    )
    .bind(userId)
    .all<SuggestionRow>();
  return results;
}
