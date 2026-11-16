import type { AccountSummary, SyncEventDraft } from '@rise/shared/sync';
import { newId, nowIso, type UserId } from './util';

/**
 * The diagnostics log (migration 0036). Append-only; pruned nightly (backup.ts). Writers
 * return statements so the caller decides when they run; the sync runs them after the
 * account's own batch, in a try/catch, so a logging fault can never fail a sync.
 */

export function insertSyncEventStmts(
  userId: UserId,
  db: D1Database,
  runId: string,
  accountId: string,
  events: readonly SyncEventDraft[],
): D1PreparedStatement[] {
  const at = nowIso();
  const flag = (v: boolean | null) => (v === null ? null : v ? 1 : 0);
  return events.map((e) =>
    db
      .prepare(
        `INSERT INTO sync_event (id, user_id, run_id, account_id, txn_id, kind, reason, source_tail,
           posted_at, amount_cents, was_pending, is_pending, detail_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
      .bind(
        newId(),
        userId,
        runId,
        accountId,
        e.txnId,
        e.kind,
        e.reason,
        e.sourceTail,
        e.postedAt,
        e.amountCents,
        flag(e.wasPending),
        flag(e.isPending),
        e.detail ? JSON.stringify(e.detail) : null,
        at,
      ),
  );
}

export function insertBalanceObservationStmt(
  userId: UserId,
  db: D1Database,
  runId: string,
  accountId: string,
  o: { balanceDate: string; balanceCents: number; reportedAt: string; summary: AccountSummary },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO balance_observation (id, user_id, run_id, account_id, balance_date, balance_cents,
         reported_at, sent_txns, sent_pending, sent_pending_cents, stored_pending,
         stored_pending_cents, observed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      newId(),
      userId,
      runId,
      accountId,
      o.balanceDate,
      o.balanceCents,
      o.reportedAt,
      o.summary.sent,
      o.summary.sentPending,
      o.summary.sentPendingCents,
      o.summary.storedPending,
      o.summary.storedPendingCents,
      nowIso(),
    );
}

export interface SyncEventRow {
  run_id: string;
  account_id: string;
  txn_id: string | null;
  kind: string;
  reason: string | null;
  source_tail: string | null;
  posted_at: string | null;
  amount_cents: number | null;
  was_pending: number | null;
  is_pending: number | null;
  detail_json: string | null;
  created_at: string;
}

export async function listSyncEvents(
  userId: UserId,
  db: D1Database,
  sinceIso: string,
  limit: number,
): Promise<SyncEventRow[]> {
  const { results } = await db
    .prepare(
      `SELECT run_id, account_id, txn_id, kind, reason, source_tail, posted_at, amount_cents,
         was_pending, is_pending, detail_json, created_at
       FROM sync_event WHERE user_id = ?1 AND created_at >= ?2
       ORDER BY created_at DESC, id LIMIT ?3`,
    )
    .bind(userId, sinceIso, limit)
    .all<SyncEventRow>();
  return results;
}

export async function listTxnEvents(
  userId: UserId,
  db: D1Database,
  txnId: string,
): Promise<SyncEventRow[]> {
  const { results } = await db
    .prepare(
      `SELECT run_id, account_id, txn_id, kind, reason, source_tail, posted_at, amount_cents,
         was_pending, is_pending, detail_json, created_at
       FROM sync_event WHERE user_id = ?1 AND txn_id = ?2 ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(userId, txnId)
    .all<SyncEventRow>();
  return results;
}

export interface BalanceObservationRow {
  run_id: string;
  account_id: string;
  balance_date: string;
  balance_cents: number;
  reported_at: string;
  sent_txns: number;
  sent_pending: number;
  sent_pending_cents: number;
  stored_pending: number;
  stored_pending_cents: number;
  observed_at: string;
}

export async function listBalanceObservations(
  userId: UserId,
  db: D1Database,
  sinceIso: string,
  limit: number,
): Promise<BalanceObservationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT run_id, account_id, balance_date, balance_cents, reported_at, sent_txns, sent_pending,
         sent_pending_cents, stored_pending, stored_pending_cents, observed_at
       FROM balance_observation WHERE user_id = ?1 AND observed_at >= ?2
       ORDER BY observed_at DESC, id LIMIT ?3`,
    )
    .bind(userId, sinceIso, limit)
    .all<BalanceObservationRow>();
  return results;
}

export interface DiagAccountRow {
  id: string;
  kind: string;
  name: string;
  nickname: string | null;
  institution_name: string | null;
  source_account_id: string | null;
  created_at: string;
  last_synced_at: string | null;
  balance_cents: number;
  archived_at: string | null;
}

export async function listDiagAccounts(userId: UserId, db: D1Database): Promise<DiagAccountRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, name, nickname, institution_name, source_account_id, created_at,
         last_synced_at, balance_cents, archived_at
       FROM account WHERE user_id = ?1`,
    )
    .bind(userId)
    .all<DiagAccountRow>();
  return results;
}

export interface DiagTxnRow {
  id: string;
  account_id: string;
  posted_at: string;
  amount_cents: number;
  is_pending: number;
  review_state: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export async function getDiagTxn(
  userId: UserId,
  db: D1Database,
  txnId: string,
): Promise<DiagTxnRow | null> {
  return db
    .prepare(
      `SELECT id, account_id, posted_at, amount_cents, is_pending, review_state, source, created_at, updated_at
       FROM txn WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(userId, txnId)
    .first<DiagTxnRow>();
}
