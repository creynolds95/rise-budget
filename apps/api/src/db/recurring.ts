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
