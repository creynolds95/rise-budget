import type { UserId } from './util';

/**
 * T23. `period_aggregate` is a cache of what counts as spending per period and category —
 * the same rule as `spentByCategory`: a split counts iff its category is budgeted (pre-deploy
 * A4) and the transaction isn't dropped. Whether the whole transaction is a transfer no longer
 * matters here — a transfer leg recategorized to a budgeted category counts, and a normal
 * split filed to the unbudgeted Transfer category doesn't. Every statement batch that changes
 * a split, or a category's `budgeted` flag, must include `refreshAggregateStmts` for each
 * touched period, so the cache never drifts.
 */
export function refreshAggregateStmts(
  userId: UserId,
  db: D1Database,
  periodId: string,
): D1PreparedStatement[] {
  return [
    db
      .prepare('DELETE FROM period_aggregate WHERE user_id = ?1 AND period_id = ?2')
      .bind(userId, periodId),
    db
      .prepare(
        `INSERT INTO period_aggregate (user_id, period_id, category_id, spent_cents, txn_count)
         SELECT s.user_id, s.period_id, s.category_id, SUM(s.amount_cents), COUNT(DISTINCT s.txn_id)
         FROM split s
         JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
         JOIN category c ON c.id = s.category_id AND c.user_id = s.user_id
         WHERE s.user_id = ?1 AND s.period_id = ?2 AND c.budgeted = 1 AND t.review_state != 'dropped'
         GROUP BY s.category_id`,
      )
      .bind(userId, periodId),
  ];
}

export interface AggregateRow {
  periodId: string;
  categoryId: string;
  spentCents: number;
  txnCount: number;
}

/** Spending per period and category over an inclusive range, for multi-period reports. */
export async function listAggregates(
  userId: UserId,
  db: D1Database,
  fromPeriod: string,
  toPeriod: string,
): Promise<AggregateRow[]> {
  const { results } = await db
    .prepare(
      `SELECT period_id, category_id, spent_cents, txn_count FROM period_aggregate
       WHERE user_id = ?1 AND period_id BETWEEN ?2 AND ?3
       ORDER BY period_id, category_id`,
    )
    .bind(userId, fromPeriod, toPeriod)
    .all<{ period_id: string; category_id: string; spent_cents: number; txn_count: number }>();
  return results.map((r) => ({
    periodId: r.period_id,
    categoryId: r.category_id,
    spentCents: r.spent_cents,
    txnCount: r.txn_count,
  }));
}

/**
 * Dashboard spending (T41), the budget's rule: splits in budgeted *expense* categories, not
 * dropped. Income categories are budgeted too but are money in, so the group kind excludes
 * them. Spending per posted day over an inclusive range of periods.
 */
export async function spendingByDay(
  userId: UserId,
  db: D1Database,
  fromPeriod: string,
  toPeriod: string,
): Promise<{ date: string; cents: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT t.posted_at AS date, SUM(s.amount_cents) AS cents
       FROM split s
       JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
       JOIN category c ON c.id = s.category_id AND c.user_id = s.user_id
       JOIN category_group g ON g.id = c.group_id AND g.user_id = s.user_id
       WHERE s.user_id = ?1 AND s.period_id BETWEEN ?2 AND ?3
         AND c.budgeted = 1 AND g.kind = 'expense' AND t.review_state != 'dropped'
       GROUP BY t.posted_at ORDER BY t.posted_at`,
    )
    .bind(userId, fromPeriod, toPeriod)
    .all<{ date: string; cents: number }>();
  return results;
}

/** Income per period over an inclusive range, same budgeted/dropped rule; sign-flipped to positive. */
export async function incomeByPeriod(
  userId: UserId,
  db: D1Database,
  fromPeriod: string,
  toPeriod: string,
): Promise<{ periodId: string; cents: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT s.period_id AS periodId, -SUM(s.amount_cents) AS cents
       FROM split s
       JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
       JOIN category c ON c.id = s.category_id AND c.user_id = s.user_id
       JOIN category_group g ON g.id = c.group_id AND g.user_id = s.user_id
       WHERE s.user_id = ?1 AND s.period_id BETWEEN ?2 AND ?3
         AND c.budgeted = 1 AND g.kind = 'income' AND t.review_state != 'dropped'
       GROUP BY s.period_id ORDER BY s.period_id`,
    )
    .bind(userId, fromPeriod, toPeriod)
    .all<{ periodId: string; cents: number }>();
  return results;
}

/** Spending per period over an inclusive range, same rule; quiet months are simply absent. */
export async function spendingByPeriod(
  userId: UserId,
  db: D1Database,
  fromPeriod: string,
  toPeriod: string,
): Promise<{ periodId: string; cents: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT s.period_id AS periodId, SUM(s.amount_cents) AS cents
       FROM split s
       JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
       JOIN category c ON c.id = s.category_id AND c.user_id = s.user_id
       JOIN category_group g ON g.id = c.group_id AND g.user_id = s.user_id
       WHERE s.user_id = ?1 AND s.period_id BETWEEN ?2 AND ?3
         AND c.budgeted = 1 AND g.kind = 'expense' AND t.review_state != 'dropped'
       GROUP BY s.period_id ORDER BY s.period_id`,
    )
    .bind(userId, fromPeriod, toPeriod)
    .all<{ periodId: string; cents: number }>();
  return results;
}
