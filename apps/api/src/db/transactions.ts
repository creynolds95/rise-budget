import { periodOf } from '@rise/shared/budget';
import { Transaction, type ReviewState } from '@rise/shared/schemas';
import { newId, nowIso, type UserId } from './util';

export interface TxnRow {
  id: string;
  account_id: string;
  posted_at: string;
  amount_cents: number;
  descriptor_raw: string;
  merchant_normalized: string;
  merchant_display: string | null;
  notes: string | null;
  is_pending: number;
  is_transfer: number;
  transfer_pair_id: string | null;
  review_state: string;
  suggested_category_id: string | null;
  suggestion_confidence: number;
  source: string;
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SplitRow {
  id: string;
  txn_id: string;
  category_id: string;
  amount_cents: number;
  period_id: string;
  sort_order: number;
}

const toTransaction = (r: TxnRow, splits: SplitRow[]): Transaction =>
  Transaction.parse({
    id: r.id,
    accountId: r.account_id,
    postedAt: r.posted_at,
    amountCents: r.amount_cents,
    descriptorRaw: r.descriptor_raw,
    merchantNormalized: r.merchant_normalized,
    merchantDisplay: r.merchant_display,
    notes: r.notes,
    isPending: r.is_pending === 1,
    isTransfer: r.is_transfer === 1,
    transferPairId: r.transfer_pair_id,
    reviewState: r.review_state,
    suggestedCategoryId: r.suggested_category_id,
    suggestionConfidence: r.suggestion_confidence,
    source: r.source,
    sourceId: r.source_id,
    splits: splits.map((s) => ({
      id: s.id,
      txnId: s.txn_id,
      categoryId: s.category_id,
      amountCents: s.amount_cents,
      periodId: s.period_id,
      sortOrder: s.sort_order,
    })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

async function splitsFor(
  userId: UserId,
  db: D1Database,
  txnIds: string[],
): Promise<Map<string, SplitRow[]>> {
  const out = new Map<string, SplitRow[]>();
  if (txnIds.length === 0) return out;
  const { results } = await db
    .prepare(
      `SELECT id, txn_id, category_id, amount_cents, period_id, sort_order FROM split
       WHERE user_id = ?1 AND txn_id IN (SELECT value FROM json_each(?2)) ORDER BY sort_order, id`,
    )
    .bind(userId, JSON.stringify(txnIds))
    .all<SplitRow>();
  for (const s of results) out.set(s.txn_id, [...(out.get(s.txn_id) ?? []), s]);
  return out;
}

export interface TxnFilters {
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  q?: string | undefined;
  reviewState?: ReviewState | undefined;
  /** Keyset cursor: rows strictly after (postedAt, id) in newest-first order. */
  after?: { postedAt: string; id: string } | undefined;
}

export async function listTransactions(
  userId: UserId,
  db: D1Database,
  f: TxnFilters,
  limit: number,
): Promise<Transaction[]> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const { results } = await db
    .prepare(
      `SELECT * FROM txn t WHERE t.user_id = ?1
         AND (?2 IS NULL OR t.posted_at >= ?2)
         AND (?3 IS NULL OR t.posted_at <= ?3)
         AND (?4 IS NULL OR t.account_id = ?4)
         AND (?5 IS NULL OR EXISTS (SELECT 1 FROM split s WHERE s.user_id = ?1 AND s.txn_id = t.id AND s.category_id = ?5))
         AND (?6 IS NULL OR t.descriptor_raw LIKE ?6 ESCAPE '\\' OR t.merchant_normalized LIKE ?6 ESCAPE '\\'
              OR t.merchant_display LIKE ?6 ESCAPE '\\' OR t.notes LIKE ?6 ESCAPE '\\')
         AND (?7 IS NULL OR t.review_state = ?7)
         AND (?8 IS NULL OR t.posted_at < ?8 OR (t.posted_at = ?8 AND t.id < ?9))
       ORDER BY t.posted_at DESC, t.id DESC LIMIT ?10`,
    )
    .bind(
      userId,
      f.from ?? null,
      f.to ?? null,
      f.accountId ?? null,
      f.categoryId ?? null,
      like,
      f.reviewState ?? null,
      f.after?.postedAt ?? null,
      f.after?.id ?? null,
      limit,
    )
    .all<TxnRow>();
  const splits = await splitsFor(
    userId,
    db,
    results.map((r) => r.id),
  );
  return results.map((r) => toTransaction(r, splits.get(r.id) ?? []));
}

export async function getTransactionRow(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<TxnRow | null> {
  return db
    .prepare('SELECT * FROM txn WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id)
    .first<TxnRow>();
}

export async function getTransaction(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<Transaction | null> {
  const row = await getTransactionRow(userId, db, id);
  if (!row) return null;
  return toTransaction(row, (await splitsFor(userId, db, [id])).get(id) ?? []);
}

export async function insertManualTransaction(
  userId: UserId,
  db: D1Database,
  t: {
    accountId: string;
    postedAt: string;
    amountCents: number;
    descriptor: string;
    merchant: string;
    notes: string | null;
  },
): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized, notes,
         review_state, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'reviewed', 'manual', ?9, ?9)`,
    )
    .bind(
      id,
      userId,
      t.accountId,
      t.postedAt,
      t.amountCents,
      t.descriptor,
      t.merchant,
      t.notes,
      now,
    )
    .run();
  return id;
}

export async function updateTransactionFields(
  userId: UserId,
  db: D1Database,
  id: string,
  f: {
    notes?: string | null | undefined;
    merchantDisplay?: string | null | undefined;
    reviewState?: ReviewState | undefined;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE txn SET
         notes = CASE WHEN ?3 THEN ?4 ELSE notes END,
         merchant_display = CASE WHEN ?5 THEN ?6 ELSE merchant_display END,
         review_state = COALESCE(?7, review_state),
         updated_at = ?8
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(
      userId,
      id,
      f.notes !== undefined ? 1 : 0,
      f.notes ?? null,
      f.merchantDisplay !== undefined ? 1 : 0,
      f.merchantDisplay ?? null,
      f.reviewState ?? null,
      nowIso(),
    )
    .run();
}

/**
 * Replace a transaction's full split set atomically (SPEC §3.5). Splits inherit the parent's
 * period. If that period is closed, flag it for recalculation and accumulate the change —
 * and do nothing else (SPEC §2.5, edge 5).
 */
export async function replaceSplits(
  userId: UserId,
  db: D1Database,
  txn: TxnRow,
  splits: { categoryId: string; amountCents: number }[],
): Promise<void> {
  const periodId = periodOf(txn.posted_at);
  const old = (await splitsFor(userId, db, [txn.id])).get(txn.id) ?? [];
  const same =
    old.length === splits.length &&
    old.every(
      (o, i) =>
        o.category_id === splits[i]?.categoryId && o.amount_cents === splits[i]?.amountCents,
    );
  if (same) return;
  const counts = txn.is_transfer === 0 && txn.review_state !== 'dropped';
  const delta =
    splits.reduce((n, s) => n + s.amountCents, 0) - old.reduce((n, s) => n + s.amount_cents, 0);
  await db.batch([
    db.prepare('DELETE FROM split WHERE user_id = ?1 AND txn_id = ?2').bind(userId, txn.id),
    ...splits.map((s, i) =>
      db
        .prepare(
          'INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        )
        .bind(newId(), userId, txn.id, s.categoryId, s.amountCents, periodId, i),
    ),
    db
      .prepare('UPDATE txn SET updated_at = ?3 WHERE user_id = ?1 AND id = ?2')
      .bind(userId, txn.id, nowIso()),
    ...(counts
      ? [
          db
            .prepare(
              `UPDATE period SET needs_recalc = 1, recalc_delta_cents = recalc_delta_cents + ?3
               WHERE user_id = ?1 AND id = ?2 AND status = 'closed'`,
            )
            .bind(userId, periodId, delta),
        ]
      : []),
  ]);
}

export async function categoryIdsExist(
  userId: UserId,
  db: D1Database,
  ids: string[],
): Promise<boolean> {
  const unique = [...new Set(ids)];
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM category WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))',
    )
    .bind(userId, JSON.stringify(unique))
    .first<{ n: number }>();
  return row?.n === unique.length;
}
