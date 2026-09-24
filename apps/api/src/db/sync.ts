import { periodOf } from '@rise/shared/budget';
import type { IncomingAccount, IncomingTxn } from '@rise/shared/import';
import type { StoredTxn } from '@rise/shared/sync';
import { refreshAggregateStmts } from './aggregates';
import { putSnapshotStmts } from './accounts';
import { flagClosedPeriodStmt, type SplitRow, type TxnRow } from './transactions';
import { newId, nowIso, type UserId } from './util';

/**
 * Sync writes (SPEC §3.2, §6.1, ARCHITECTURE §6). Everything here returns statements, so
 * the caller can apply one account's whole sync as a single D1 batch — all or nothing.
 */

// ── accounts ──────────────────────────────────────────────────────────────────

export interface SyncedAccountRow {
  id: string;
  kind: string;
  source_account_id: string;
  last_synced_at: string | null;
  include_in_budget: number;
  archived_at: string | null;
  created_at: string;
}

export async function listSyncedAccounts(
  userId: UserId,
  db: D1Database,
): Promise<SyncedAccountRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, source_account_id, last_synced_at, include_in_budget, archived_at, created_at FROM account
       WHERE user_id = ?1 AND source = 'simplefin'`,
    )
    .bind(userId)
    .all<SyncedAccountRow>();
  return results;
}

/** First sight of a SimpleFIN account. Its guessed kind is never re-guessed afterwards. */
export function insertSyncedAccountStmt(
  userId: UserId,
  db: D1Database,
  id: string,
  a: IncomingAccount,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO account (id, user_id, name, kind, source, source_account_id, institution_name,
         include_in_budget, sync_cadence_hours, created_at)
       VALUES (?2, ?1, ?3, ?4, 'simplefin', ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (user_id, source, source_account_id) DO NOTHING`,
    )
    .bind(
      userId,
      id,
      a.name,
      a.kind,
      a.sourceAccountId,
      a.institutionName,
      a.includeInBudget ? 1 : 0,
      a.syncCadenceHours,
      nowIso(),
    );
}

/**
 * The institution's balance as of its own balance date. `last_synced_at` is when the bank
 * last reported, not when Rise asked — that's what staleness and close readiness judge.
 */
export function reportBalanceStmts(
  userId: UserId,
  db: D1Database,
  accountId: string,
  a: IncomingAccount,
  reportedAt: string,
): D1PreparedStatement[] {
  return [
    ...putSnapshotStmts(userId, db, accountId, {
      asOf: a.balanceDate,
      balanceCents: a.balanceCents,
      source: 'sync',
    }),
    db
      .prepare(
        `UPDATE account SET last_synced_at = ?3 WHERE user_id = ?1 AND id = ?2
         AND (last_synced_at IS NULL OR last_synced_at < ?3)`,
      )
      .bind(userId, accountId, reportedAt),
  ];
}

// ── transactions ──────────────────────────────────────────────────────────────

/** Rows the planner needs: the fetch window, plus every still-open pending row. */
export async function listStoredForSync(
  userId: UserId,
  db: D1Database,
  accountId: string,
  fromDate: string,
): Promise<(StoredTxn & { row: TxnRow })[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM txn WHERE user_id = ?1 AND account_id = ?2
         AND (posted_at >= ?3 OR (is_pending = 1 AND review_state != 'dropped'))`,
    )
    .bind(userId, accountId, fromDate)
    .all<TxnRow>();
  return results.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    postedAt: r.posted_at,
    amountCents: r.amount_cents,
    descriptor: r.descriptor_raw,
    merchant: r.merchant_normalized,
    isPending: r.is_pending === 1,
    dropped: r.review_state === 'dropped',
    row: r,
  }));
}

export function insertSyncedTxnStmt(
  userId: UserId,
  db: D1Database,
  t: {
    id: string;
    accountId: string;
    incoming: IncomingTxn;
    merchant: string;
    merchantDisplay: string | null;
    suggestedCategoryId: string | null;
    suggestionConfidence: number;
  },
): D1PreparedStatement {
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized,
         merchant_display, is_pending, review_state, suggested_category_id, suggestion_confidence,
         source, source_id, created_at, updated_at)
       VALUES (?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'needs_review', ?10, ?11, 'simplefin', ?12, ?13, ?13)
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      userId,
      t.id,
      t.accountId,
      t.incoming.postedAt,
      t.incoming.amountCents,
      t.incoming.descriptor,
      t.merchant,
      t.merchantDisplay,
      t.incoming.pending ? 1 : 0,
      t.suggestedCategoryId,
      t.suggestionConfidence,
      t.incoming.sourceId,
      now,
    );
}

const counts = (isTransfer: number, reviewState: string) =>
  isTransfer === 0 && reviewState !== 'dropped';

/**
 * Spending effects of moving a transaction's splits from one (period, amounts, counted)
 * state to another: flag closed periods, refresh aggregates for both.
 */
function splitEffectStmts(
  userId: UserId,
  db: D1Database,
  before: { period: string; total: number; counted: boolean },
  after: { period: string; total: number; counted: boolean },
  hasSplits: boolean,
): D1PreparedStatement[] {
  if (!hasSplits) return [];
  const b = before.counted ? before.total : 0;
  const a = after.counted ? after.total : 0;
  const stmts: D1PreparedStatement[] = [];
  if (before.period === after.period) {
    if (b !== a) stmts.push(flagClosedPeriodStmt(userId, db, after.period, a - b));
    stmts.push(...refreshAggregateStmts(userId, db, after.period));
  } else {
    if (b !== 0) stmts.push(flagClosedPeriodStmt(userId, db, before.period, -b));
    if (a !== 0) stmts.push(flagClosedPeriodStmt(userId, db, after.period, a));
    stmts.push(
      ...refreshAggregateStmts(userId, db, before.period),
      ...refreshAggregateStmts(userId, db, after.period),
    );
  }
  return stmts;
}

/**
 * Update a stored row in place from the bank's latest view of it — the same row, or a
 * pending row that posted under a new id (SPEC §3.2). Category, splits, notes and review
 * state are preserved. Splits follow the row: they move period with it, and an amount
 * drift is absorbed by the last split so they still sum to the transaction (§3.5).
 * A dropped row that comes back returns to the review queue.
 */
export function updateSyncedTxnStmts(
  userId: UserId,
  db: D1Database,
  row: TxnRow,
  splits: SplitRow[],
  incoming: IncomingTxn,
  merchant: string,
): D1PreparedStatement[] {
  const reviewState = row.review_state === 'dropped' ? 'needs_review' : row.review_state;
  const oldPeriod = periodOf(row.posted_at);
  const newPeriod = periodOf(incoming.postedAt);
  const drift = incoming.amountCents - row.amount_cents;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE txn SET posted_at = ?3, amount_cents = ?4, descriptor_raw = ?5, merchant_normalized = ?6,
           is_pending = ?7, source_id = ?8, review_state = ?9, updated_at = ?10
         WHERE user_id = ?1 AND id = ?2`,
      )
      .bind(
        userId,
        row.id,
        incoming.postedAt,
        incoming.amountCents,
        incoming.descriptor,
        merchant,
        incoming.pending ? 1 : 0,
        incoming.sourceId,
        reviewState,
        nowIso(),
      ),
  ];
  const last = splits.at(-1);
  for (const s of splits) {
    stmts.push(
      db
        .prepare(
          'UPDATE split SET amount_cents = ?3, period_id = ?4 WHERE user_id = ?1 AND id = ?2',
        )
        .bind(userId, s.id, s.amount_cents + (s === last ? drift : 0), newPeriod),
    );
  }
  const total = splits.reduce((n, s) => n + s.amount_cents, 0);
  stmts.push(
    ...splitEffectStmts(
      userId,
      db,
      { period: oldPeriod, total, counted: counts(row.is_transfer, row.review_state) },
      { period: newPeriod, total: total + drift, counted: counts(row.is_transfer, reviewState) },
      splits.length > 0,
    ),
  );
  return stmts;
}

/** SPEC §3.2: a pending row with no match after 14 days no longer counts. */
export function dropPendingStmts(
  userId: UserId,
  db: D1Database,
  row: TxnRow,
  splits: SplitRow[],
): D1PreparedStatement[] {
  const period = periodOf(row.posted_at);
  const total = splits.reduce((n, s) => n + s.amount_cents, 0);
  return [
    db
      .prepare(
        "UPDATE txn SET review_state = 'dropped', updated_at = ?3 WHERE user_id = ?1 AND id = ?2",
      )
      .bind(userId, row.id, nowIso()),
    ...splitEffectStmts(
      userId,
      db,
      { period, total, counted: counts(row.is_transfer, row.review_state) },
      { period, total, counted: false },
      splits.length > 0,
    ),
  ];
}

// ── transfers (SPEC §3.3) ─────────────────────────────────────────────────────

export interface TransferRow {
  id: string;
  account_id: string;
  kind: string;
  posted_at: string;
  amount_cents: number;
}

/**
 * Rows that may be auto-linked: posted, not already a transfer, still waiting for review and
 * uncategorised — a row the user has already decided about is never re-labelled silently.
 */
export async function listTransferCandidates(
  userId: UserId,
  db: D1Database,
  from: string,
  to: string,
): Promise<TransferRow[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.account_id, a.kind, t.posted_at, t.amount_cents
       FROM txn t JOIN account a ON a.id = t.account_id AND a.user_id = t.user_id
       WHERE t.user_id = ?1 AND t.posted_at BETWEEN ?2 AND ?3
         AND t.is_pending = 0 AND t.is_transfer = 0 AND t.transfer_pair_id IS NULL
         AND t.review_state = 'needs_review'
         AND NOT EXISTS (SELECT 1 FROM split s WHERE s.user_id = ?1 AND s.txn_id = t.id)`,
    )
    .bind(userId, from, to)
    .all<TransferRow>();
  return results;
}

/** Link both legs. They stay in the review queue, shown as one pair the user can unlink. */
export function linkTransferStmts(
  userId: UserId,
  db: D1Database,
  a: string,
  b: string,
): D1PreparedStatement[] {
  const link = (id: string, other: string) =>
    db
      .prepare(
        `UPDATE txn SET is_transfer = 1, transfer_pair_id = ?3, suggested_category_id = NULL,
           suggestion_confidence = 0, updated_at = ?4
         WHERE user_id = ?1 AND id = ?2`,
      )
      .bind(userId, id, other, nowIso());
  return [link(a, b), link(b, a)];
}

export function unlinkTransferStmts(
  userId: UserId,
  db: D1Database,
  a: string,
  b: string,
): D1PreparedStatement[] {
  const unlink = (id: string) =>
    db
      .prepare(
        `UPDATE txn SET is_transfer = 0, transfer_pair_id = NULL, updated_at = ?3
         WHERE user_id = ?1 AND id = ?2`,
      )
      .bind(userId, id, nowIso());
  return [unlink(a), unlink(b)];
}

// ── sync_run audit ────────────────────────────────────────────────────────────

export interface SyncRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  accounts_touched: number;
  rows_inserted: number;
  rows_updated: number;
  error_json: string | null;
}

export async function startSyncRun(userId: UserId, db: D1Database): Promise<string> {
  const id = newId();
  await db
    .prepare(
      "INSERT INTO sync_run (id, user_id, started_at, status) VALUES (?2, ?1, ?3, 'running')",
    )
    .bind(userId, id, nowIso())
    .run();
  return id;
}

export async function finishSyncRun(
  userId: UserId,
  db: D1Database,
  id: string,
  r: {
    status: 'ok' | 'partial' | 'failed';
    accountsTouched: number;
    rowsInserted: number;
    rowsUpdated: number;
    errors: unknown[];
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE sync_run SET finished_at = ?3, status = ?4, accounts_touched = ?5, rows_inserted = ?6,
         rows_updated = ?7, error_json = ?8
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(
      userId,
      id,
      nowIso(),
      r.status,
      r.accountsTouched,
      r.rowsInserted,
      r.rowsUpdated,
      r.errors.length > 0 ? JSON.stringify(r.errors) : null,
    )
    .run();
}

export async function listSyncRuns(
  userId: UserId,
  db: D1Database,
  limit = 10,
): Promise<SyncRunRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM sync_run WHERE user_id = ?1 ORDER BY started_at DESC, id LIMIT ?2')
    .bind(userId, limit)
    .all<SyncRunRow>();
  return results;
}

/** A row starts or stops counting as spending (linked or unlinked as a transfer). */
export function countingChangeStmts(
  userId: UserId,
  db: D1Database,
  row: TxnRow,
  splits: SplitRow[],
  countsAfter: boolean,
): D1PreparedStatement[] {
  const period = periodOf(row.posted_at);
  const total = splits.reduce((n, s) => n + s.amount_cents, 0);
  return splitEffectStmts(
    userId,
    db,
    { period, total, counted: counts(row.is_transfer, row.review_state) },
    { period, total, counted: countsAfter && row.review_state !== 'dropped' },
    splits.length > 0,
  );
}
