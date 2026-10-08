import {
  addPeriods,
  monthsBetween,
  periodOf,
  spreadMonthsOf,
  spreadParts,
} from '@rise/shared/budget';
import { Transaction, type ReviewState, type TxnSort } from '@rise/shared/schemas';
import { refreshAggregateStmts } from './aggregates';
import { bumpMemoryStmt } from './categorize';
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
  refund_of_id: string | null;
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

const toTransaction = (r: TxnRow, splits: SplitRow[], tagIds: string[] = []): Transaction =>
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
    refundOfId: r.refund_of_id,
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
    tagIds,
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
      // Driven from the id list so each lookup uses the txn_id index. CROSS JOIN pins that
      // order: left to itself, production read every split the user has once per id (5M rows
      // in a day, Oct 2026). No INDEXED BY: if the index were ever missing it would turn a
      // slow query into a failing one.
      `SELECT s.id, s.txn_id, s.category_id, s.amount_cents, s.period_id, s.sort_order
       FROM json_each(?2) j CROSS JOIN split s ON s.txn_id = j.value
       WHERE s.user_id = ?1 ORDER BY s.sort_order, s.id`,
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
  notAccountIds?: string[] | undefined;
  notCategoryIds?: string[] | undefined;
  tagIds?: string[] | undefined;
  /** With `categoryIds`: that category's splits in this month, spread parts included. */
  period?: string | undefined;
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
 * Each sort is a fixed ORDER BY and the matching keyset condition on (key, id), so a page
 * boundary never skips or repeats a row. `after` binds the key twice, then the id.
 */
const SORTS: Record<TxnSort, { order: string; after: string }> = {
  date_desc: {
    order: 't.posted_at DESC, t.id DESC',
    after: '(t.posted_at < ? OR (t.posted_at = ? AND t.id < ?))',
  },
  date_asc: {
    order: 't.posted_at ASC, t.id ASC',
    after: '(t.posted_at > ? OR (t.posted_at = ? AND t.id > ?))',
  },
  amount_desc: {
    order: 'ABS(t.amount_cents) DESC, t.id DESC /* scan-ok: sorting by size reads every row */',
    after:
      '(ABS(t.amount_cents) < CAST(? AS INTEGER) OR (ABS(t.amount_cents) = CAST(? AS INTEGER) AND t.id < ?))',
  },
  amount_asc: {
    order: 'ABS(t.amount_cents) ASC, t.id ASC /* scan-ok: sorting by size reads every row */',
    after:
      '(ABS(t.amount_cents) > CAST(? AS INTEGER) OR (ABS(t.amount_cents) = CAST(? AS INTEGER) AND t.id > ?))',
  },
};

/** The cursor key for a row under a sort: its date, or the size of its amount. */
export const sortKey = (t: Transaction, sort: TxnSort): string =>
  sort.startsWith('amount') ? String(Math.abs(t.amountCents)) : t.postedAt;

/**
 * The WHERE clauses for a filter, each bound in order. Only the filters in use go into the
 * SQL: an always-present "?n IS NULL OR …" clause stops SQLite using an index, so every list
 * read and sorted the whole history.
 */
function txnWhere(
  userId: UserId,
  f: TxnFilters,
  sort: { after: string },
): { where: string[]; binds: unknown[] } {
  const where: string[] = [];
  const binds: unknown[] = [];
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql);
    binds.push(...values);
  };
  if (f.from) add('t.posted_at >= ?', f.from);
  if (f.to) add('t.posted_at <= ?', f.to);
  if (f.accountIds?.length === 1) add('t.account_id = ?', f.accountIds[0]);
  else if (f.accountIds?.length)
    add('t.account_id IN (SELECT value FROM json_each(?))', JSON.stringify(f.accountIds));
  // With a month, a category reads its splits in that month — a spread charge shows in every
  // month it draws on (SPEC §3.6), straight off the (user, period, category) index.
  if (f.categoryIds?.length && f.period)
    add(
      `t.id IN (SELECT s.txn_id FROM split s WHERE s.user_id = ? AND s.period_id = ?
         AND s.category_id IN (SELECT value FROM json_each(?)))`,
      userId,
      f.period,
      JSON.stringify(f.categoryIds),
    );
  else if (f.categoryIds?.length)
    add(
      `EXISTS (SELECT 1 FROM split s WHERE s.user_id = t.user_id AND s.txn_id = t.id
         AND s.category_id IN (SELECT value FROM json_each(?)))`,
      JSON.stringify(f.categoryIds),
    );
  if (f.notAccountIds?.length)
    add('t.account_id NOT IN (SELECT value FROM json_each(?))', JSON.stringify(f.notAccountIds));
  if (f.notCategoryIds?.length)
    add(
      `NOT EXISTS (SELECT 1 FROM split s WHERE s.user_id = t.user_id AND s.txn_id = t.id
         AND s.category_id IN (SELECT value FROM json_each(?)))`,
      JSON.stringify(f.notCategoryIds),
    );
  if (f.tagIds?.length)
    add(
      `EXISTS (SELECT 1 FROM txn_tag tt WHERE tt.user_id = t.user_id AND tt.txn_id = t.id
         AND tt.tag_id IN (SELECT value FROM json_each(?)))`,
      JSON.stringify(f.tagIds),
    );
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    add(
      `(t.descriptor_raw LIKE ? ESCAPE '\\' OR t.merchant_normalized LIKE ? ESCAPE '\\'
        OR t.merchant_display LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')`,
      like,
      like,
      like,
      like,
    );
  }
  if (f.reviewState) add('t.review_state = ?', f.reviewState);
  if (f.after) add(sort.after, f.after.key, f.after.key, f.after.id);
  if (f.direction === 'out') add('t.amount_cents > 0');
  if (f.direction === 'in') add('t.amount_cents < 0');
  if (f.minCents != null) add('ABS(t.amount_cents) >= ?', f.minCents);
  if (f.maxCents != null) add('ABS(t.amount_cents) <= ?', f.maxCents);
  return { where, binds };
}

export async function listTransactions(
  userId: UserId,
  db: D1Database,
  f: TxnFilters,
  limit: number,
): Promise<Transaction[]> {
  const sort = SORTS[f.sort ?? 'date_desc'];
  const { where, binds } = txnWhere(userId, f, sort);
  const { results } = await db
    .prepare(
      `SELECT * FROM txn t WHERE t.user_id = ?${where.map((w) => ` AND ${w}`).join('')}
       ORDER BY ${sort.order} LIMIT ?`,
    )
    .bind(userId, ...binds, limit)
    .all<TxnRow>();
  return withSplitsAndTags(userId, db, results);
}

/** Rows as transactions, with their splits and tags read in one round trip. */
export async function withSplitsAndTags(
  userId: UserId,
  db: D1Database,
  rows: TxnRow[],
): Promise<Transaction[]> {
  const ids = rows.map((r) => r.id);
  const [splits, tags] = await Promise.all([
    splitsFor(userId, db, ids),
    tagIdsFor(userId, db, ids),
  ]);
  return rows.map((r) => toTransaction(r, splits.get(r.id) ?? [], tags.get(r.id) ?? []));
}

/**
 * What a filter matches, summed: money out, money in, and how many. Transfers and dropped
 * pending rows are left out, the same as spending everywhere else. Only asked for when a
 * filter is on; with a search and no dates it reads the user's history once.
 */
export async function totalTransactions(
  userId: UserId,
  db: D1Database,
  f: TxnFilters,
): Promise<{ outCents: number; inCents: number; count: number }> {
  const { where, binds } = txnWhere(userId, { ...f, after: undefined }, SORTS.date_desc);
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents END), 0) AS out_cents,
              COALESCE(-SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents END), 0) AS in_cents,
              COUNT(*) AS n
       FROM txn t WHERE t.user_id = ? AND t.is_transfer = 0 AND t.review_state != 'dropped'${where
         .map((w) => ` AND ${w}`)
         .join('')} /* scan-ok: one pass over the filtered rows, on demand */`,
    )
    .bind(userId, ...binds)
    .first<{ out_cents: number; in_cents: number; n: number }>();
  return { outCents: row?.out_cents ?? 0, inCents: row?.in_cents ?? 0, count: row?.n ?? 0 };
}

/** Tag ids per transaction, driven from the id list like `splitsFor`. */
export async function tagIdsFor(
  userId: UserId,
  db: D1Database,
  txnIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (txnIds.length === 0) return out;
  const { results } = await db
    .prepare(
      `SELECT tt.txn_id, tt.tag_id FROM json_each(?2) j CROSS JOIN txn_tag tt ON tt.txn_id = j.value
       WHERE tt.user_id = ?1`,
    )
    .bind(userId, JSON.stringify(txnIds))
    .all<{ txn_id: string; tag_id: string }>();
  for (const r of results) out.set(r.txn_id, [...(out.get(r.txn_id) ?? []), r.tag_id]);
  return out;
}

/** How many transactions wait for review, read straight from the review index. */
export async function countNeedsReview(userId: UserId, db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM txn WHERE user_id = ?1 AND review_state = 'needs_review'")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
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
  return (await withSplitsAndTags(userId, db, [row]))[0] ?? null;
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
  splits: SplitWrite[],
): Promise<boolean> {
  const stmts = await replaceSplitsStmts(userId, db, txn, splits);
  if (!stmts) return false;
  await db.batch(stmts);
  return true;
}

/** A split to write. `periodId` defaults to the transaction's own month; a spread sets it. */
export interface SplitWrite {
  categoryId: string;
  amountCents: number;
  periodId?: string;
}

/**
 * `replaceSplits` as statements, to batch atomically with whatever else changes alongside.
 * Null when the split set is already exactly this. Every month the old or new splits sit in
 * is refreshed, so un-spreading a charge clears the later months too.
 */
async function replaceSplitsStmts(
  userId: UserId,
  db: D1Database,
  txn: TxnRow,
  splits: SplitWrite[],
): Promise<D1PreparedStatement[] | null> {
  const periodId = periodOf(txn.posted_at);
  const rows = splits.map((s) => ({ ...s, periodId: s.periodId ?? periodId }));
  const old = (await splitsFor(userId, db, [txn.id])).get(txn.id) ?? [];
  const same =
    old.length === rows.length &&
    old.every(
      (o, i) =>
        o.category_id === rows[i]?.categoryId &&
        o.amount_cents === rows[i]?.amountCents &&
        o.period_id === rows[i]?.periodId,
    );
  if (same) return null;
  const oldSplits = old.map((o) => ({ categoryId: o.category_id, amountCents: o.amount_cents }));
  const dropped = txn.review_state === 'dropped';
  const [newCounted, oldCounted] = await Promise.all([
    dropped ? 0 : countedSum(userId, db, rows),
    dropped ? 0 : countedSum(userId, db, oldSplits),
  ]);
  const delta = newCounted - oldCounted;
  const periods = new Set([
    periodId,
    ...old.map((o) => o.period_id),
    ...rows.map((r) => r.periodId),
  ]);
  return [
    db.prepare('DELETE FROM split WHERE user_id = ?1 AND txn_id = ?2').bind(userId, txn.id),
    ...rows.map((s, i) =>
      db
        .prepare(
          'INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        )
        .bind(newId(), userId, txn.id, s.categoryId, s.amountCents, s.periodId, i),
    ),
    db
      .prepare('UPDATE txn SET updated_at = ?3 WHERE user_id = ?1 AND id = ?2')
      .bind(userId, txn.id, nowIso()),
    // Flag even at delta = 0: a recategorization between two budgeted categories doesn't
    // change the period's total, but it does move money between two categories' own carry
    // (M2) — the closed period's carry-forward is stale either way. `flagClosedPeriodStmt`
    // is always safe to call; its own SQL no-ops on an open period.
    flagClosedPeriodStmt(userId, db, periodId, delta),
    ...[...periods].flatMap((p) => refreshAggregateStmts(userId, db, p)),
  ];
}

/**
 * Spread one charge evenly over `months` months from its own (SPEC §3.6); 1 puts it back in
 * one month. Null when it's already spread that way.
 */
export async function spreadStmts(
  userId: UserId,
  db: D1Database,
  txn: TxnRow,
  categoryId: string,
  months: number,
): Promise<D1PreparedStatement[] | null> {
  const parts = spreadParts(txn.amount_cents, months, periodOf(txn.posted_at), categoryId);
  return replaceSplitsStmts(userId, db, txn, parts);
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
  oldSplits: { category_id: string; amount_cents: number; period_id?: string }[],
  categoryId: string,
  /** Keep a spread charge's months under the new category (SPEC §3.6); a transfer collapses. */
  keepSpread = false,
): Promise<D1PreparedStatement[]> {
  if (oldSplits.length === 1 && oldSplits[0]?.category_id === categoryId) return [];
  const periodId = periodOf(txn.posted_at);
  const months = keepSpread
    ? spreadMonthsOf(
        periodId,
        oldSplits.map((s) => ({ categoryId: s.category_id, periodId: s.period_id ?? periodId })),
      )
    : 1;
  const newSplits = spreadParts(txn.amount_cents, months, periodId, categoryId);
  const [newCounted, oldCounted] = await Promise.all([
    countedSum(userId, db, newSplits),
    countedSum(
      userId,
      db,
      oldSplits.map((s) => ({ categoryId: s.category_id, amountCents: s.amount_cents })),
    ),
  ]);
  const delta = newCounted - oldCounted;
  const periods = new Set([periodId, ...newSplits.map((s) => s.periodId)]);
  for (const s of oldSplits) if (s.period_id) periods.add(s.period_id);
  return [
    db.prepare('DELETE FROM split WHERE user_id = ?1 AND txn_id = ?2').bind(userId, txn.id),
    ...newSplits.map((s, i) =>
      db
        .prepare(
          'INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        )
        .bind(newId(), userId, txn.id, categoryId, s.amountCents, s.periodId, i),
    ),
    db
      .prepare('UPDATE txn SET updated_at = ?3 WHERE user_id = ?1 AND id = ?2')
      .bind(userId, txn.id, nowIso()),
    flagClosedPeriodStmt(userId, db, periodId, delta),
    ...[...periods].flatMap((p) => refreshAggregateStmts(userId, db, p)),
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
  // Each split shifts by the same number of months, so a spread charge keeps its shape.
  const shift = monthsBetween(oldPeriod, newPeriod);
  const periods = new Set([oldPeriod, newPeriod]);
  for (const s of splits) periods.add(s.period_id).add(addPeriods(s.period_id, shift));
  return [
    setDate,
    ...splits.map((s) =>
      db
        .prepare('UPDATE split SET period_id = ?3 WHERE user_id = ?1 AND id = ?2')
        .bind(userId, s.id, addPeriods(s.period_id, shift)),
    ),
    ...(counted !== 0
      ? [
          flagClosedPeriodStmt(userId, db, oldPeriod, -counted),
          flagClosedPeriodStmt(userId, db, newPeriod, counted),
        ]
      : []),
    ...[...periods].flatMap((p) => refreshAggregateStmts(userId, db, p)),
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

/**
 * Accept each row's stored suggestion in one batch: its split becomes the suggested category
 * (unless it already is exactly that), it's marked reviewed, and the merchant memory counts the
 * choice. Returns the merchants touched, for the caller to refresh their suggestions.
 *
 * Batched instead of ~5 round trips per row — "accept all confident" can cover hundreds. The
 * merchant-meta write that recordManualCategorisation (countTowardOffer: false) would do is
 * skipped: it always writes back the same meta it read, a no-op.
 */
export async function acceptSuggestions(
  userId: UserId,
  db: D1Database,
  rows: TxnRow[],
): Promise<Set<string>> {
  const merchants = new Set<string>();
  if (rows.length === 0) return merchants;
  const [oldSplits, { results: catRows }] = await Promise.all([
    splitsFor(
      userId,
      db,
      rows.map((r) => r.id),
    ),
    db
      .prepare('SELECT id, budgeted FROM category WHERE user_id = ?1')
      .bind(userId)
      .all<{ id: string; budgeted: number }>(),
  ]);
  const budgetedCats = new Set(catRows.filter((r) => r.budgeted === 1).map((r) => r.id));
  const now = nowIso();
  const periods = new Set<string>();
  const stmts: D1PreparedStatement[] = [];

  for (const row of rows) {
    const categoryId = row.suggested_category_id;
    if (!categoryId) continue;
    const periodId = periodOf(row.posted_at);
    periods.add(periodId);
    merchants.add(row.merchant_normalized);

    const old = oldSplits.get(row.id) ?? [];
    for (const o of old) periods.add(o.period_id);
    // A spread charge keeps its months under the accepted category (SPEC §3.6).
    const parts = spreadParts(
      row.amount_cents,
      spreadMonthsOf(
        periodId,
        old.map((o) => ({ categoryId: o.category_id, periodId: o.period_id })),
      ),
      periodId,
      categoryId,
    );
    for (const p of parts) periods.add(p.periodId);
    const same =
      old.length === parts.length &&
      parts.every(
        (p, i) =>
          old[i]?.category_id === p.categoryId &&
          old[i]?.amount_cents === p.amountCents &&
          old[i]?.period_id === p.periodId,
      );
    if (!same) {
      const dropped = row.review_state === 'dropped';
      const newCounted = !dropped && budgetedCats.has(categoryId) ? row.amount_cents : 0;
      const oldCounted = dropped
        ? 0
        : old.reduce((n, s) => n + (budgetedCats.has(s.category_id) ? s.amount_cents : 0), 0);
      stmts.push(
        db.prepare('DELETE FROM split WHERE user_id = ?1 AND txn_id = ?2').bind(userId, row.id),
        ...parts.map((p, i) =>
          db
            .prepare(
              'INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
            )
            .bind(newId(), userId, row.id, categoryId, p.amountCents, p.periodId, i),
        ),
        // Flag even at delta = 0 — a same-total recategorization still moves money between two
        // categories' own carry in a closed period (M2); flagClosedPeriodStmt no-ops if open.
        flagClosedPeriodStmt(userId, db, periodId, newCounted - oldCounted),
      );
    }
    stmts.push(
      db
        .prepare(
          "UPDATE txn SET review_state = 'reviewed', updated_at = ?3 WHERE user_id = ?1 AND id = ?2",
        )
        .bind(userId, row.id, now),
      bumpMemoryStmt(userId, db, row.merchant_normalized, categoryId),
    );
  }
  for (const periodId of periods) stmts.push(...refreshAggregateStmts(userId, db, periodId));
  await db.batch(stmts);
  return merchants;
}

/**
 * Remove a transaction. Its splits go first (as `replaceSplits` would) so the aggregates and a
 * closed month's recalculation flag stay right; a synced row leaves a tombstone so the next
 * sync doesn't bring it back. One batch: if the row can't go, its splits and the spending
 * cache stay exactly as they were.
 */
export async function deleteTransaction(
  userId: UserId,
  db: D1Database,
  txn: TxnRow,
): Promise<void> {
  await db.batch([
    ...((await replaceSplitsStmts(userId, db, txn, [])) ?? []),
    db.prepare('DELETE FROM txn WHERE user_id = ?1 AND id = ?2').bind(userId, txn.id),
    ...(txn.source_id
      ? [
          db
            .prepare(
              `INSERT OR IGNORE INTO deleted_txn (user_id, account_id, source, source_id, deleted_at)
               VALUES (?1, ?2, ?3, ?4, ?5)`,
            )
            .bind(userId, txn.account_id, txn.source, txn.source_id, nowIso()),
        ]
      : []),
  ]);
}

/** Bank ids the user deleted from this account, for sync to skip. */
export async function deletedSourceIds(
  userId: UserId,
  db: D1Database,
  accountId: string,
): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT source_id FROM deleted_txn WHERE user_id = ?1 AND account_id = ?2')
    .bind(userId, accountId)
    .all<{ source_id: string }>();
  return new Set(results.map((r) => r.source_id));
}

export interface OutflowRow {
  id: string;
  accountId: string;
  postedAt: string;
  amountCents: number;
  /** Lowercase description, normalized merchant and display name, for name matching. */
  text: string;
}

/** Posted money out between two dates, newest first. A short window on the date index. */
/** Posted rows in both directions over a short window, newest first, for rules that follow
 *  transfers. Same index as `listOutflows`; bounded by date and by LIMIT. */
export async function listPostedWindow(
  userId: UserId,
  db: D1Database,
  from: string,
  to: string,
): Promise<OutflowRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized, merchant_display FROM txn
       WHERE user_id = ?1 AND posted_at >= ?2 AND posted_at <= ?3 AND amount_cents != 0 AND is_pending = 0
       ORDER BY posted_at DESC, id DESC LIMIT 500`,
    )
    .bind(userId, from, to)
    .all<{
      id: string;
      account_id: string;
      posted_at: string;
      amount_cents: number;
      descriptor_raw: string;
      merchant_normalized: string;
      merchant_display: string | null;
    }>();
  return results.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    postedAt: r.posted_at,
    amountCents: r.amount_cents,
    text: `${r.descriptor_raw} ${r.merchant_normalized} ${r.merchant_display ?? ''}`.toLowerCase(),
  }));
}

export async function listOutflows(
  userId: UserId,
  db: D1Database,
  from: string,
  to: string,
): Promise<OutflowRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized, merchant_display FROM txn
       WHERE user_id = ?1 AND posted_at >= ?2 AND posted_at <= ?3 AND amount_cents > 0 AND is_pending = 0
       ORDER BY posted_at DESC, id DESC LIMIT 500`,
    )
    .bind(userId, from, to)
    .all<{
      id: string;
      account_id: string;
      posted_at: string;
      amount_cents: number;
      descriptor_raw: string;
      merchant_normalized: string;
      merchant_display: string | null;
    }>();
  return results.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    postedAt: r.posted_at,
    amountCents: r.amount_cents,
    text: `${r.descriptor_raw} ${r.merchant_normalized} ${r.merchant_display ?? ''}`.toLowerCase(),
  }));
}

/** What earlier refunds of this purchase already returned, as positive cents. */
export async function refundedCents(
  userId: UserId,
  db: D1Database,
  originalId: string,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COALESCE(-SUM(amount_cents), 0) AS n FROM txn WHERE user_id = ?1 AND refund_of_id = ?2',
    )
    .bind(userId, originalId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setRefundOf(
  userId: UserId,
  db: D1Database,
  id: string,
  originalId: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE txn SET refund_of_id = ?3, updated_at = ?4 WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id, originalId, nowIso())
    .run();
}
