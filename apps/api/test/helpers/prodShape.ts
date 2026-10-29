import { env } from 'cloudflare:workers';

/**
 * A database shaped like production (Oct 2026): ~7.4k transactions over 3¾ years on 7
 * accounts, ~7.7k splits (4% split three ways), 70 categories, a plan for every month, daily
 * balance snapshots, a year of sync runs, audit log, sessions. Inserted with a few set-based
 * statements so it costs ~1 s, not a sync per row.
 *
 * Ids carry `tag` so several users can share one test database.
 */
export const SHAPE = {
  txns: 7_400,
  categories: 70,
  groups: 14,
  accounts: 7,
  merchants: 400,
  needsReview: 30,
  firstDay: '2023-01-01',
  days: 1_370, // → early Oct 2026
} as const;

export async function seedProdShape(userId: string, tag: string) {
  const db = env.DB;
  const u = userId;
  const now = '2026-10-02T12:00:00.000Z';
  const kinds = ['depository', 'depository', 'credit', 'credit', 'credit', 'loan', 'investment'];
  const stmts: D1PreparedStatement[] = [];
  const q = (sql: string, ...b: unknown[]) => stmts.push(db.prepare(sql).bind(...b));

  // Recursive CTEs over a counter: SQLite here has no generate_series.
  const seq = (n: number) =>
    `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${n - 1})`;

  kinds.forEach((kind, i) =>
    q(
      `INSERT INTO account (id, user_id, name, kind, source, source_account_id, balance_cents, created_at, last_synced_at)
       VALUES (?1, ?2, ?3, ?4, 'simplefin', ?5, ?6, ?7, ?7)`,
      `${tag}a${i}`,
      u,
      `Account ${i}`,
      kind,
      `${tag}sfa${i}`,
      100_000 * (i + 1),
      now,
    ),
  );
  q(
    `${seq(SHAPE.groups)} INSERT INTO category_group (id, user_id, name, kind, sort_order)
     SELECT ?2 || 'g' || i, ?1, 'Group ' || i, CASE WHEN i = 0 THEN 'income' ELSE 'expense' END, i FROM n`,
    u,
    tag,
  );
  q(
    `${seq(SHAPE.categories)} INSERT INTO category (id, user_id, group_id, name, sort_order, budgeted, rollover_policy, archived_at)
     SELECT ?2 || 'c' || i, ?1, ?2 || 'g' || (i % ${SHAPE.groups}), 'Category ' || i, i,
            CASE WHEN i % 10 = 9 THEN 0 ELSE 1 END,
            CASE WHEN i % 3 = 0 THEN 'roll' ELSE 'return_to_pool' END,
            CASE WHEN i % 23 = 22 THEN ?3 END
     FROM n`,
    u,
    tag,
    now,
  );
  q(
    `INSERT INTO category (id, user_id, group_id, name, is_catchall) VALUES (?2 || 'cx', ?1, ?2 || 'g1', 'Uncategorized', 1)`,
    u,
    tag,
  );
  // Transactions: ~5.4 a day, 400 merchants, a few transfers and pendings, 30 to review.
  q(
    `${seq(SHAPE.txns)} INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw,
       merchant_normalized, is_pending, is_transfer, review_state, suggested_category_id,
       suggestion_confidence, source, source_id, created_at, updated_at)
     SELECT ?2 || 't' || i, ?1, ?2 || 'a' || (i % 7),
            date(?3, '+' || (i * ${SHAPE.days} / ${SHAPE.txns}) || ' days'),
            CASE WHEN i % 40 = 0 THEN -250000 ELSE 100 + (i * 7919) % 15000 END,
            'POS PURCHASE MERCHANT ' || ((i * 31) % ${SHAPE.merchants}) || ' #' || i,
            'MERCHANT ' || ((i * 31) % ${SHAPE.merchants}),
            CASE WHEN i >= ${SHAPE.txns - 4} THEN 1 ELSE 0 END,
            CASE WHEN i % 50 = 7 THEN 1 ELSE 0 END,
            CASE WHEN i >= ${SHAPE.txns - SHAPE.needsReview} THEN 'needs_review'
                 WHEN i % 300 = 1 THEN 'dropped' ELSE 'reviewed' END,
            ?2 || 'c' || (i % 60), 0.8, 'simplefin', ?2 || 'sf' || i, ?4, ?4
     FROM n`,
    u,
    tag,
    SHAPE.firstDay,
    now,
  );
  // One split per transaction, plus two more on every 25th.
  q(
    `INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order)
     SELECT t.id || 's0', ?1, t.id, ?2 || 'c' || (CAST(substr(t.id, length(?2) + 2) AS INTEGER) % 60),
            t.amount_cents, substr(t.posted_at, 1, 7), 0
     FROM txn t WHERE t.user_id = ?1`,
    u,
    tag,
  );
  q(
    `${seq(2)} INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order)
     SELECT t.id || 's' || (n.i + 1), ?1, t.id, ?2 || 'c' || ((CAST(substr(t.id, length(?2) + 2) AS INTEGER) + n.i + 1) % 60),
            0, substr(t.posted_at, 1, 7), n.i + 1
     FROM txn t, n WHERE t.user_id = ?1 AND CAST(substr(t.id, length(?2) + 2) AS INTEGER) % 25 = 0`,
    u,
    tag,
  );
  // Months 2023-01 .. 2027-09, a plan for each budgeted category in each.
  q(
    `${seq(57)} INSERT INTO period (id, user_id, expected_income_cents)
     SELECT strftime('%Y-%m', date('2023-01-01', '+' || i || ' months')), ?1, 500000 FROM n`,
    u,
  );
  q(
    `INSERT INTO allocation (id, user_id, period_id, category_id, planned_cents)
     SELECT p.id || ':' || c.id, ?1, p.id, c.id, 20000
     FROM period p JOIN category c ON c.user_id = p.user_id
     WHERE p.user_id = ?1 AND c.budgeted = 1 AND c.is_catchall = 0`,
    u,
  );
  q(
    `INSERT INTO period_aggregate (user_id, period_id, category_id, spent_cents, txn_count)
     SELECT s.user_id, s.period_id, s.category_id, SUM(s.amount_cents), COUNT(*)
     FROM split s JOIN txn t ON t.id = s.txn_id JOIN category c ON c.id = s.category_id
     WHERE s.user_id = ?1 AND c.budgeted = 1 AND t.review_state != 'dropped'
     GROUP BY s.period_id, s.category_id`,
    u,
  );
  // A balance per account per day.
  q(
    `${seq(SHAPE.days)} INSERT INTO balance_snapshot (id, user_id, account_id, as_of, balance_cents, source, created_at)
     SELECT ?2 || 'b' || a.id || i, ?1, a.id, date(?3, '+' || i || ' days'), 100000 + i * 13, 'sync', ?4
     FROM n, account a WHERE a.user_id = ?1`,
    u,
    tag,
    SHAPE.firstDay,
    now,
  );
  q(
    `INSERT INTO merchant_memory (user_id, merchant_normalized, category_id, count, last_used_at)
     SELECT ?1, merchant_normalized, MIN(suggested_category_id), COUNT(*), MAX(posted_at)
     FROM txn WHERE user_id = ?1 GROUP BY merchant_normalized`,
    u,
  );
  q(
    `${seq(40)} INSERT INTO rule (id, user_id, match_field, match_type, match_value, category_id, priority, created_at)
     SELECT ?2 || 'r' || i, ?1, 'merchant', 'contains', 'MERCHANT ' || (i * 7), ?2 || 'c' || i, i, ?3 FROM n`,
    u,
    tag,
    now,
  );
  q(
    `${seq(30)} INSERT INTO recurring_series (id, user_id, merchant_normalized, category_id, cadence,
       expected_amount_cents, next_expected_date, status, updated_at, source)
     SELECT ?2 || 'rs' || i, ?1, 'MERCHANT ' || i, ?2 || 'c' || i, 'monthly', 1500 + i, '2026-10-' || printf('%02d', 1 + i % 28),
            'active', ?3, CASE WHEN i < 8 THEN 'manual' ELSE 'detected' END FROM n`,
    u,
    tag,
    now,
  );
  q(
    `${seq(1_100)} INSERT INTO sync_run (id, user_id, started_at, finished_at, status, accounts_touched, rows_inserted)
     SELECT ?2 || 'sr' || i, ?1, datetime('2025-09-25', '+' || (i * 8) || ' hours'),
            datetime('2025-09-25', '+' || (i * 8) || ' hours', '+20 seconds'), 'ok', 7, i % 5 FROM n`,
    u,
    tag,
  );
  q(
    `${seq(5_000)} INSERT INTO audit_log (id, user_id, action, target_type, target_id, detail_json, created_at)
     SELECT ?2 || 'al' || i, ?1, CASE WHEN i % 3 = 0 THEN 'auth.login' ELSE 'txn.categorized' END, 'txn', ?2 || 't' || i, '{}',
            datetime('2025-09-25', '+' || (i * 2) || ' hours') FROM n`,
    u,
    tag,
  );
  q(
    `${seq(60)} INSERT INTO session (id, user_id, refresh_hash, expires_at, created_at, revoked_at)
     SELECT ?2 || 'se' || i, ?1, 'h' || i, '2026-12-01T00:00:00.000Z', datetime('2026-08-01', '+' || i || ' days'),
            CASE WHEN i < 50 THEN ?3 END FROM n`,
    u,
    tag,
    now,
  );
  q(
    `${seq(400)} INSERT INTO idempotency (key, user_id, response_json, created_at)
     SELECT ?2 || 'ik' || i, ?1, '{}', datetime('2026-09-01', '+' || i || ' hours') FROM n`,
    u,
    tag,
  );
  await db.batch(stmts);
  return {
    accountId: `${tag}a0`,
    cardId: `${tag}a2`,
    categoryId: `${tag}c3`,
    txnId: `${tag}t${SHAPE.txns - 1}`,
    reviewedTxnId: `${tag}t${SHAPE.txns - 100}`,
    groupId: `${tag}g2`,
  };
}
