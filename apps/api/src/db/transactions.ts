import { periodOf } from '@rise/shared/budget';
import { Transaction, type ReviewState, type TxnSort } from '@rise/shared/schemas';
import { refreshAggregateStmts } from './aggregates';
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

export async function splitsFor(
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
  accountIds?: string[] | undefined;
  categoryIds?: string[] | undefined;
  q?: string | undefined;
  reviewState?: ReviewState | undefined;
  direction?: 'in' | 'out' | undefined;
  minCents?: number | undefined;
  maxCents?: number | undefined;
  sort?: TxnSort | undefined;
  /** Keyset cursor: rows strictly after (key, id) in the chosen order. */
  after?: { key: string; id: string } | undefined;
}

/**
 * Each sort is a fixed ORDER BY and the matching keyset condition on (?8 key, ?9 id), so a
 * page boundary never skips or repeats a row.
 */
const SORTS: Record<TxnSort, { order: string; after: string }> = {
  date_desc: {
    order: 't.posted_at DESC, t.id DESC',
    after: '(t.posted_at < ?8 OR (t.posted_at = ?8 AND t.id < ?9))',
  },
  date_asc: {
    order: 't.posted_at ASC, t.id ASC',
    after: '(t.posted_at > ?8 OR (t.posted_at = ?8 AND t.id > ?9))',
  },
  amount_desc: {
    order: 'ABS(t.amount_cents) DESC, t.id DESC',
    after:
      '(ABS(t.amount_cents) < CAST(?8 AS INTEGER) OR (ABS(t.amount_cents) = CAST(?8 AS INTEGER) AND t.id < ?9))',
  },
  amount_asc: {
    order: 'ABS(t.amount_cents) ASC, t.id ASC',
    after:
      '(ABS(t.amount_cents) > CAST(?8 AS INTEGER) OR (ABS(t.amount_cents) = CAST(?8 AS INTEGER) AND t.id > ?9))',
  },
};

/** The cursor key for a row under a sort: its date, or the size of its amount. */
export const sortKey = (t: Transaction, sort: TxnSort): string =>
  sort.startsWith('amount') ? String(Math.abs(t.amountCents)) : t.postedAt;

export async function listTransactions(
  userId: UserId,
  db: D1Database,
  f: TxnFilters,
  limit: number,
): Promise<Transaction[]> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const sort = SORTS[f.sort ?? 'date_desc'];
  const { results } = await db
    .prepare(
      `SELECT * FROM txn t WHERE t.user_id = ?1
         AND (?2 IS NULL OR t.posted_at >= ?2)
         AND (?3 IS NULL OR t.posted_at <= ?3)
         AND (?4 IS NULL OR t.account_id IN (SELECT value FROM json_each(?4)))
         AND (?5 IS NULL OR EXISTS (SELECT 1 FROM split s WHERE s.user_id = ?1 AND s.txn_id = t.id
              AND s.category_id IN (SELECT value FROM json_each(?5))))
         AND (?6 IS NULL OR t.descriptor_raw LIKE ?6 ESCAPE '\\' OR t.merchant_normalized LIKE ?6 ESCAPE '\\'
              OR t.merchant_display LIKE ?6 ESCAPE '\\' OR t.notes LIKE ?6 ESCAPE '\\')
         AND (?7 IS NULL OR t.review_state = ?7)
         AND (?8 IS NULL OR ${sort.after})
         AND (?11 IS NULL OR (?11 = 'out' AND t.amount_cents > 0) OR (?11 = 'in' AND t.amount_cents < 0))
         AND (?12 IS NULL OR ABS(t.amount_cents) >= ?12)
         AND (?13 IS NULL OR ABS(t.amount_cents) <= ?13)
       ORDER BY ${sort.order} LIMIT ?10`,
    )
    .bind(
      userId,
      f.from ?? null,
      f.to ?? null,
      f.accountIds?.length ? JSON.stringify(f.accountIds) : null,
      f.categoryIds?.length ? JSON.stringify(f.categoryIds) : null,
      like,
      f.reviewState ?? null,
      f.after?.key ?? null,
      f.after?.id ?? null,
      limit,
      f.direction ?? null,
      f.minCents ?? null,
      f.maxCents ?? null,
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
    /** H1: 'reviewed' when the user picked a category by hand, 'needs_review' for a guess. */
    reviewState: ReviewState;
  },
): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized, notes,
         review_state, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'manual', ?10, ?10)`,
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
      t.reviewState,
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
 * Replace a transaction's full split set atomically (SPEC §3.5). Returns false if nothing changed. Splits inherit the parent's
 * period. If that period is closed, flag it for recalculation and accumulate the change —
 * and do nothing else (SPEC §2.5, edge 5). The period's aggregates refresh in the same batch.
 */
/**
 * Sum of the splits filed to a budgeted category (pre-deploy A4) — the amount that actually
 * counts as spending. A transaction can straddle budgeted and unbudgeted categories (e.g. a
 * recategorized transfer leg split partly to "Furniture"), so this is per-split, not per-txn.
 */
async function countedSum(
  userId: UserId,
  db: D1Database,
  splits: { categoryId: string; amountCents: number }[],
): Promise<number> {
  const ids = [...new Set(splits.map((s) => s.categoryId))];
  if (ids.length === 0) return 0;
  const { results } = await db
    .prepare(
      `SELECT id, budgeted FROM category WHERE user_id = ?1 AND id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})`,
    )
    .bind(userId, ...ids)
    .all<{ id: string; budgeted: number }>();
  const budgeted = new Set(results.filter((r) => r.budgeted === 1).map((r) => r.id));
  return splits.reduce((n, s) => n + (budgeted.has(s.categoryId) ? s.amountCents : 0), 0);
}

export async function replaceSplits(
  userId: UserId,
  db: D1Database,
  txn: TxnRow,
  splits: { categoryId: string; amountCents: number }[],
): Promise<boolean> {
  const periodId = periodOf(txn.posted_at);
  const old = (await splitsFor(userId, db, [txn.id])).get(txn.id) ?? [];
  const same =
    old.length === splits.length &&
    old.every(
      (o, i) =>
        o.category_id === splits[i]?.categoryId && o.amount_cents === splits[i]?.amountCents,
    );
  if (same) return false;
  const oldSplits = old.map((o) => ({ categoryId: o.category_id, amountCents: o.amount_cents }));
  const dropped = txn.review_state === 'dropped';
  const [newCounted, oldCounted] = await Promise.all([
    dropped ? 0 : countedSum(userId, db, splits),
    dropped ? 0 : countedSum(userId, db, oldSplits),
  ]);
  const delta = newCounted - oldCounted;
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
    // Flag even at delta = 0: a recategorization between two budgeted categories doesn't
    // change the period's total, but it does move money between two categories' own carry
    // (M2) — the closed period's carry-forward is stale either way. `flagClosedPeriodStmt`
    // is always safe to call; its own SQL no-ops on an open period.
    flagClosedPeriodStmt(userId, db, periodId, delta),
    ...refreshAggregateStmts(userId, db, periodId),
  ]);
  return true;
}

/**
 * Replace a transaction's splits with a single split at a new category, keeping the full
 * amount — the transfer-link, mark-transfer and unlink flows default a leg's category this
 * way (pre-deploy A5), without touching `is_transfer`/`transfer_pair_id`. Returns statements
 * to batch atomically with whatever else changes alongside (e.g. `linkTransferStmts`), rather
 * than executing them itself.
 */
export async function reassignSplitStmts(
  userId: UserId,
  db: D1Database,
  txn: { id: string; posted_at: string; amount_cents: number },
  oldSplits: { category_id: string; amount_cents: number }[],
  categoryId: string,
): Promise<D1PreparedStatement[]> {
  if (oldSplits.length === 1 && oldSplits[0]?.category_id === categoryId) return [];
  const periodId = periodOf(txn.posted_at);
  const newSplits = [{ categoryId, amountCents: txn.amount_cents }];
  const [newCounted, oldCounted] = await Promise.all([
    countedSum(userId, db, newSplits),
    countedSum(
      userId,
      db,
      oldSplits.map((s) => ({ categoryId: s.category_id, amountCents: s.amount_cents })),
    ),
  ]);
  const delta = newCounted - oldCounted;
  return [
    db.prepare('DELETE FROM split WHERE user_id = ?1 AND txn_id = ?2').bind(userId, txn.id),
    db
      .prepare(
        'INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)',
      )
      .bind(newId(), userId, txn.id, categoryId, txn.amount_cents, periodId),
    db
      .prepare('UPDATE txn SET updated_at = ?3 WHERE user_id = ?1 AND id = ?2')
      .bind(userId, txn.id, nowIso()),
    flagClosedPeriodStmt(userId, db, periodId, delta),
    ...refreshAggregateStmts(userId, db, periodId),
  ];
}

/**
 * Move a transaction's date to a new period (M1: past months are editable, not frozen). Its
 * splits move with it; a closed period on either side of the move is flagged with the counted
 * amount leaving/entering it — mirroring sync's own date-drift handling in `sync.ts`'s
 * `updateSyncedTxnStmts`. A same-period date change is just the date column.
 */
export async function movePostedAtStmts(
  userId: UserId,
  db: D1Database,
  row: TxnRow,
  splits: SplitRow[],
  newPostedAt: string,
): Promise<D1PreparedStatement[]> {
  const oldPeriod = periodOf(row.posted_at);
  const newPeriod = periodOf(newPostedAt);
  const setDate = db
    .prepare('UPDATE txn SET posted_at = ?3, updated_at = ?4 WHERE user_id = ?1 AND id = ?2')
    .bind(userId, row.id, newPostedAt, nowIso());
  if (oldPeriod === newPeriod) return [setDate];
  const counted = await countedCentsOf(userId, db, splits, row.review_state);
  return [
    setDate,
    ...splits.map((s) =>
      db
        .prepare('UPDATE split SET period_id = ?3 WHERE user_id = ?1 AND id = ?2')
        .bind(userId, s.id, newPeriod),
    ),
    ...(counted !== 0
      ? [
          flagClosedPeriodStmt(userId, db, oldPeriod, -counted),
          flagClosedPeriodStmt(userId, db, newPeriod, counted),
        ]
      : []),
    ...refreshAggregateStmts(userId, db, oldPeriod),
    ...refreshAggregateStmts(userId, db, newPeriod),
  ];
}

/**
 * Sum of a split set that counts as spending — a category's `budgeted` flag, filtered to
 * `reviewState !== 'dropped'`. Used by sync's amount/period drift and pending-drop paths,
 * which don't reassign category, only whether the same split still counts.
 */
export async function countedCentsOf(
  userId: UserId,
  db: D1Database,
  splits: { category_id: string; amount_cents: number }[],
  reviewState: string,
): Promise<number> {
  if (reviewState === 'dropped') return 0;
  return countedSum(
    userId,
    db,
    splits.map((s) => ({ categoryId: s.category_id, amountCents: s.amount_cents })),
  );
}

/**
 * Splits changed in a period, moving its total by `deltaCents` (a recategorisation moves 0
 * but still changes carry). If it's closed, flag it and accumulate the delta — nothing is
 * recalculated (SPEC §2.5, edge 5). A no-op for open periods.
 */
export function flagClosedPeriodStmt(
  userId: UserId,
  db: D1Database,
  periodId: string,
  deltaCents: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE period SET needs_recalc = 1, recalc_delta_cents = recalc_delta_cents + ?3
       WHERE user_id = ?1 AND id = ?2 AND status = 'closed'`,
    )
    .bind(userId, periodId, deltaCents);
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

/**
 * Review-queue rows whose stored suggestion can be accepted: by id (a swipe, any pre-fill),
 * or every one at or above a confidence (SPEC §8 "Accept all confident").
 */
export async function listAcceptable(
  userId: UserId,
  db: D1Database,
  by: { ids: string[] } | { minConfidence: number },
): Promise<TxnRow[]> {
  const ids = 'ids' in by ? JSON.stringify(by.ids) : null;
  const min = 'minConfidence' in by ? by.minConfidence : null;
  const { results } = await db
    .prepare(
      `SELECT t.* FROM txn t JOIN category c ON c.id = t.suggested_category_id AND c.user_id = t.user_id
       WHERE t.user_id = ?1 AND t.review_state = 'needs_review' AND c.archived_at IS NULL
         AND (?2 IS NULL OR t.id IN (SELECT value FROM json_each(?2)))
         AND (?3 IS NULL OR t.suggestion_confidence >= ?3)
       ORDER BY t.posted_at, t.id`,
    )
    .bind(userId, ids, min)
    .all<TxnRow>();
  return results;
}
