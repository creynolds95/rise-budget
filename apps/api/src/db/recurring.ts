import type { DetectedSeries, Occurrence } from '@rise/shared/recurring';
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
): Promise<Map<string, Occurrence[]>> {
  // H1: every occurrence always has a split now (a guess or the catch-all), so a category
  // only counts here once the user has actually reviewed it — otherwise every merchant would
  // "establish" whatever its unconfirmed guess happened to be.
  const { results } = await db
    .prepare(
      `SELECT t.merchant_normalized, t.posted_at, t.amount_cents,
         CASE WHEN t.review_state = 'reviewed' THEN
           (SELECT CASE WHEN COUNT(*) = 1 THEN MAX(s.category_id) END FROM split s
             WHERE s.user_id = ?1 AND s.txn_id = t.id)
         END AS category_id
       FROM txn t
       WHERE t.user_id = ?1 AND t.posted_at >= ?2 AND t.is_transfer = 0 AND t.is_pending = 0
         AND t.review_state != 'dropped'
       ORDER BY t.posted_at`,
    )
    .bind(userId, from)
    .all<{
      merchant_normalized: string;
      posted_at: string;
      amount_cents: number;
      category_id: string | null;
    }>();
  const out = new Map<string, Occurrence[]>();
  for (const r of results) {
    const o = { date: r.posted_at, amountCents: r.amount_cents, categoryId: r.category_id };
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

interface ManualRuleRow {
  id: string;
  merchant_normalized: string;
  cadence: string;
  expected_amount_cents: number;
  next_expected_date: string;
  anchor_days: string | null;
  label: string | null;
}

/** Every manual rule (Caleb's "Recurring Cash Withdrawal" tag), for `refreshRecurring`. */
export async function listManualRules(userId: UserId, db: D1Database): Promise<ManualRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, merchant_normalized, cadence, expected_amount_cents, next_expected_date,
         anchor_days, label
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
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO recurring_series (id, user_id, merchant_normalized, category_id, cadence,
         expected_amount_cents, next_expected_date, status, updated_at, source, anchor_days,
         label)
       VALUES (?2, ?1, ?2, NULL, ?3, ?4, ?5, 'active', ?6, 'manual', NULL, ?7)`,
    )
    .bind(userId, seriesId(userId, id), cadence, amountCents, nextExpectedDate, nowIso(), label);
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
         anchor_days, label
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
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE recurring_series SET next_expected_date = ?3, status = ?4, updated_at = ?5
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(userId, id, nextExpectedDate, status, nowIso());
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
  s: DetectedSeries,
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

/** A known series that stopped fitting and is past due by more than a week is broken. */
export function markOverdueBrokenStmt(
  userId: UserId,
  db: D1Database,
  brokenBefore: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE recurring_series SET status = 'broken', updated_at = ?3
       WHERE user_id = ?1 AND status = 'active' AND next_expected_date < ?2`,
    )
    .bind(userId, brokenBefore, nowIso());
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
