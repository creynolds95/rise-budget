import type { UserId } from './util';

/**
 * T23. `period_aggregate` is a cache of what counts as spending per period and category —
 * the same rule as `spentByCategory`: transfers and dropped pendings don't count. Every
 * statement batch that changes a split, or whether a transaction counts, must include
 * `refreshAggregateStmts` for each touched period, so the cache never drifts.
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
         FROM split s JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
         WHERE s.user_id = ?1 AND s.period_id = ?2 AND t.is_transfer = 0 AND t.review_state != 'dropped'
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
