import { periodOf } from '@rise/shared/budget';
import { normalizeMerchant } from '@rise/shared/categorize';
import { maskOf } from '@rise/shared/import';
import type {
  MonarchFeedOverlap,
  MonarchMergeCandidate,
  MonarchRowsBody,
  MonarchSetupBody,
} from '@rise/shared/schemas';
import { archiveAccount, createAccount } from './accounts';
import { refreshAggregateStmts } from './aggregates';
import {
  createCategory,
  createGroup,
  ensureTransferCategory,
  listCategories,
  listGroups,
} from './categories';
import { AppError } from '../lib/errors';
import { newId, nowIso, type UserId } from './util';

/**
 * Monarch history import. Everything here is history: it writes transactions, splits and the
 * spending cache, and never a period row, allocation, carry or surplus, so the budget going
 * forward is exactly what it was before the import (nothing rolls over from it).
 */

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

async function ensureGroup(
  userId: UserId,
  db: D1Database,
  name: string,
  kind: 'income' | 'expense',
): Promise<string> {
  const hit = (await listGroups(userId, db)).find((g) => g.name === name && g.kind === kind);
  return hit ? hit.id : (await createGroup(userId, db, { name, kind })).id;
}

/**
 * Create what the person confirmed in the mapping step: history-only accounts (archived, outside
 * net worth and the budget) and categories. Names already created by an earlier run are reused,
 * so setting up twice never doubles anything. Returns the Rise id for every Monarch name.
 */
export async function monarchSetup(
  userId: UserId,
  db: D1Database,
  b: MonarchSetupBody,
): Promise<{ accounts: Record<string, string>; categories: Record<string, string> }> {
  const accounts: Record<string, string> = {};
  for (const a of b.accounts) {
    const prior = await db
      .prepare(
        `SELECT id FROM account WHERE user_id = ?1 AND source = 'manual' AND name = ?2
           AND archived_at IS NOT NULL AND include_in_net_worth = 0 LIMIT 1`,
      )
      .bind(userId, a.monarchName)
      .first<{ id: string }>();
    if (prior) {
      accounts[a.monarchName] = prior.id;
      continue;
    }
    const created = await createAccount(userId, db, {
      name: a.monarchName,
      kind: a.kind,
      source: 'manual',
      includeInNetWorth: false,
      includeInBudget: false,
    });
    await archiveAccount(userId, db, created.id);
    accounts[a.monarchName] = created.id;
  }

  const categories: Record<string, string> = {};
  for (const c of b.categories) {
    if (c.kind === 'transfer' && key(c.monarchName) === 'transfer') {
      categories[c.monarchName] = (await ensureTransferCategory(userId, db)).id;
      continue;
    }
    // The Transfers group has to exist before a transfer-kind category can join it.
    if (c.kind === 'transfer') await ensureTransferCategory(userId, db);
    const groupName =
      c.kind === 'transfer' ? 'Transfers' : c.kind === 'income' ? 'Imported income' : 'Imported';
    let groupId: string;
    if (c.groupId && c.kind !== 'transfer') {
      const picked = (await listGroups(userId, db)).find((g) => g.id === c.groupId);
      if (!picked) throw new AppError(400, 'BAD_REQUEST', `Unknown group for ${c.monarchName}`);
      groupId = picked.id;
    } else {
      groupId = await ensureGroup(
        userId,
        db,
        groupName,
        c.kind === 'income' ? 'income' : 'expense',
      );
    }
    const existing = (await listCategories(userId, db)).find(
      (x) => x.groupId === groupId && !x.archivedAt && key(x.name) === key(c.monarchName),
    );
    categories[c.monarchName] = existing
      ? existing.id
      : (
          await createCategory(userId, db, {
            groupId,
            name: c.monarchName.trim(),
            emoji: null,
            isBill: false,
            rolloverPolicy: 'roll',
            spendShape: 'linear',
            budgeted: c.kind !== 'transfer',
          })
        ).id;
  }
  return { accounts, categories };
}

/**
 * SQL: the bank feed already covers this account on this day. Its first synced transaction
 * marks where SimpleFIN's history starts; from then on every row is SimpleFIN's, so a Monarch
 * row dated that day or later is the same purchase again (often a day or two off, so an exact
 * date match alone misses it). `?1` must be the user id.
 */
function coveredByFeed(accountSql: string, dateSql: string): string {
  return `EXISTS (
    SELECT 1 FROM txn f WHERE f.user_id = ?1 AND f.account_id = ${accountSql}
      AND f.source = 'simplefin' AND f.review_state != 'dropped' AND f.posted_at <= ${dateSql})`;
}

async function ownedIds(
  userId: UserId,
  db: D1Database,
  table: 'account' | 'category',
  ids: string[],
): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT id FROM ${table} WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(userId, JSON.stringify([...new Set(ids)]))
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

async function presentSourceIds(
  userId: UserId,
  db: D1Database,
  sourceIds: string[],
  batchId?: string,
): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT source_id FROM txn WHERE user_id = ?1 AND source = 'csv'
         AND (?3 IS NULL OR import_batch_id = ?3)
         AND source_id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(userId, JSON.stringify(sourceIds), batchId ?? null)
    .all<{ source_id: string }>();
  return new Set(results.map((r) => r.source_id));
}

/**
 * One chunk of rows, all or nothing. A row is left out, and counted, when its Monarch id was
 * already imported, when the bank feed already has that day and amount on the account, or
 * when it falls outside the window or into a closed month. Nothing here can restate a month.
 */
export async function importMonarchRows(
  userId: UserId,
  db: D1Database,
  b: MonarchRowsBody,
  window: { from: string; to: string },
): Promise<{ imported: number; duplicate: number; overlap: number; rejected: number }> {
  const [accounts, categories] = await Promise.all([
    ownedIds(
      userId,
      db,
      'account',
      b.rows.map((r) => r.accountId),
    ),
    ownedIds(
      userId,
      db,
      'category',
      b.rows.map((r) => r.categoryId),
    ),
  ]);
  const usable = b.rows.filter(
    (r) =>
      accounts.has(r.accountId) &&
      categories.has(r.categoryId) &&
      r.postedAt >= window.from &&
      r.postedAt <= window.to,
  );
  const rejected = b.rows.length - usable.length;
  if (usable.length === 0) return { imported: 0, duplicate: 0, overlap: 0, rejected };

  const already = await presentSourceIds(
    userId,
    db,
    usable.map((r) => r.sourceId),
  );
  const fresh = usable.filter((r) => !already.has(r.sourceId));
  const duplicate = usable.length - fresh.length;
  if (fresh.length === 0) return { imported: 0, duplicate, overlap: 0, rejected };

  const now = nowIso();
  const payload = fresh.map((r) => {
    const descriptor = r.originalStatement || r.merchant || 'Unknown';
    return {
      id: newId(),
      splitId: newId(),
      accountId: r.accountId,
      categoryId: r.categoryId,
      postedAt: r.postedAt,
      periodId: periodOf(r.postedAt),
      amountCents: r.amountCents,
      descriptor,
      merchant: normalizeMerchant(descriptor),
      display: r.merchant && r.merchant !== descriptor ? r.merchant : null,
      notes: r.notes || null,
      isTransfer: r.isTransfer ? 1 : 0,
      reviewState: r.reviewed ? 'reviewed' : 'needs_review',
      sourceId: r.sourceId,
    };
  });
  const json = JSON.stringify(payload);
  const periods = [...new Set(payload.map((p) => p.periodId))];

  await db.batch([
    db
      .prepare(
        `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized,
           merchant_display, notes, is_pending, is_transfer, review_state, source, source_id, import_batch_id,
           created_at, updated_at)
         SELECT json_extract(j.value, '$.id'), ?1, json_extract(j.value, '$.accountId'),
           json_extract(j.value, '$.postedAt'), json_extract(j.value, '$.amountCents'),
           json_extract(j.value, '$.descriptor'), json_extract(j.value, '$.merchant'),
           json_extract(j.value, '$.display'), json_extract(j.value, '$.notes'), 0,
           json_extract(j.value, '$.isTransfer'), json_extract(j.value, '$.reviewState'), 'csv',
           json_extract(j.value, '$.sourceId'), ?3, ?4, ?4
         FROM json_each(?2) j
         WHERE NOT EXISTS (
           SELECT 1 FROM txn o WHERE o.user_id = ?1 AND o.source != 'csv'
             AND o.account_id = json_extract(j.value, '$.accountId')
             AND o.posted_at = json_extract(j.value, '$.postedAt')
             AND o.amount_cents = json_extract(j.value, '$.amountCents'))
           AND NOT ${coveredByFeed("json_extract(j.value, '$.accountId')", "json_extract(j.value, '$.postedAt')")}
         ON CONFLICT DO NOTHING`,
      )
      .bind(userId, json, b.batchId, now),
    db
      .prepare(
        `INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order)
         SELECT json_extract(j.value, '$.splitId'), ?1, json_extract(j.value, '$.id'),
           json_extract(j.value, '$.categoryId'), json_extract(j.value, '$.amountCents'),
           json_extract(j.value, '$.periodId'), 0
         FROM json_each(?2) j
         WHERE EXISTS (SELECT 1 FROM txn WHERE user_id = ?1 AND id = json_extract(j.value, '$.id')
           AND import_batch_id = ?3)`,
      )
      .bind(userId, json, b.batchId),
    ...periods.flatMap((p) => refreshAggregateStmts(userId, db, p)),
  ]);

  const landed = await presentSourceIds(
    userId,
    db,
    fresh.map((r) => r.sourceId),
    b.batchId,
  );
  return {
    imported: landed.size,
    duplicate,
    overlap: fresh.length - landed.size,
    rejected,
  };
}

export interface MonarchBatchRow {
  batchId: string;
  rows: number;
  from: string;
  to: string;
  importedAt: string;
}

export async function listMonarchBatches(
  userId: UserId,
  db: D1Database,
): Promise<MonarchBatchRow[]> {
  const { results } = await db
    .prepare(
      `SELECT import_batch_id AS batchId, COUNT(*) AS rows, MIN(posted_at) AS "from", MAX(posted_at) AS "to",
         MIN(created_at) AS importedAt
       FROM txn WHERE user_id = ?1 AND source = 'csv' AND import_batch_id IS NOT NULL
       GROUP BY import_batch_id ORDER BY MIN(created_at) DESC`,
    )
    .bind(userId)
    .all<MonarchBatchRow>();
  return results;
}

/** Take back one import: its transactions and splits go, the spending cache is rebuilt. */
export async function undoMonarchBatch(
  userId: UserId,
  db: D1Database,
  batchId: string,
): Promise<number> {
  const [{ results: periods }, count] = await Promise.all([
    db
      .prepare(
        `SELECT DISTINCT s.period_id AS id FROM split s JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
         WHERE t.user_id = ?1 AND t.source = 'csv' AND t.import_batch_id = ?2`,
      )
      .bind(userId, batchId)
      .all<{ id: string }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM txn WHERE user_id = ?1 AND source = 'csv' AND import_batch_id = ?2`,
      )
      .bind(userId, batchId)
      .first<{ n: number }>(),
  ]);
  await db.batch([
    db
      .prepare(
        `DELETE FROM split WHERE user_id = ?1 AND txn_id IN
           (SELECT id FROM txn WHERE user_id = ?1 AND source = 'csv' AND import_batch_id = ?2)`,
      )
      .bind(userId, batchId),
    db
      .prepare(`DELETE FROM txn WHERE user_id = ?1 AND source = 'csv' AND import_batch_id = ?2`)
      .bind(userId, batchId),
    ...periods.flatMap((p) => refreshAggregateStmts(userId, db, p.id)),
  ]);
  return count?.n ?? 0;
}

/**
 * SQL: imported row `t` (a history copy's, to land on `liveSql`) is one the live account's bank
 * feed already has, by the same rule the import itself uses.
 */
function duplicatesLive(liveSql: string): string {
  return `(${coveredByFeed(liveSql, 't.posted_at')} OR EXISTS (
    SELECT 1 FROM txn o WHERE o.user_id = ?1 AND o.account_id = ${liveSql} AND o.source != 'csv'
      AND o.posted_at = t.posted_at AND o.amount_cents = t.amount_cents))`;
}

/** Remove imported transactions picked by `where` (over `txn t`), keeping the spending cache right. */
async function dropImported(
  userId: UserId,
  db: D1Database,
  where: string,
  binds: unknown[],
): Promise<D1PreparedStatement[]> {
  const picked = `SELECT t.id FROM txn t WHERE t.user_id = ?1 AND t.source = 'csv'
    AND t.import_batch_id IS NOT NULL AND ${where}`;
  const { results: periods } = await db
    .prepare(
      `SELECT DISTINCT period_id AS id FROM split WHERE user_id = ?1 AND txn_id IN (${picked})`,
    )
    .bind(userId, ...binds)
    .all<{ id: string }>();
  return [
    db
      .prepare(`DELETE FROM split WHERE user_id = ?1 AND txn_id IN (${picked})`)
      .bind(userId, ...binds),
    db.prepare(`DELETE FROM txn WHERE user_id = ?1 AND id IN (${picked})`).bind(userId, ...binds),
    ...periods.flatMap((p) => refreshAggregateStmts(userId, db, p.id)),
  ];
}

/**
 * Import-made history accounts that have a live twin: same trailing mask, exactly one live
 * account. The person confirms each pair; nothing is merged on a guess. `duplicates` counts the
 * rows the live account's bank feed already has: they are dropped, not moved.
 */
export async function listMergeCandidates(
  userId: UserId,
  db: D1Database,
): Promise<MonarchMergeCandidate[]> {
  const { results: accounts } = await db
    .prepare(
      `SELECT a.id, a.name, a.mask, a.archived_at, a.source,
         (SELECT COUNT(*) FROM txn t WHERE t.user_id = a.user_id AND t.account_id = a.id) AS rows,
         (SELECT COUNT(*) FROM txn t WHERE t.user_id = a.user_id AND t.account_id = a.id
            AND t.source = 'csv' AND t.import_batch_id IS NOT NULL) AS imported
       FROM account a WHERE a.user_id = ?1`,
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      mask: string | null;
      archived_at: string | null;
      source: string;
      rows: number;
      imported: number;
    }>();
  const maskFor = (a: { name: string; mask: string | null }) =>
    maskOf(a.name) ?? (a.mask ? a.mask.toLowerCase() : null);
  const live = accounts.filter((a) => !a.archived_at && a.source !== 'manual');
  const out: MonarchMergeCandidate[] = [];
  for (const h of accounts) {
    if (!h.archived_at || h.source !== 'manual' || h.imported === 0 || h.imported !== h.rows)
      continue;
    const mask = maskFor(h);
    if (!mask) continue;
    const twins = live.filter((l) => maskFor(l) === mask);
    const twin = twins[0];
    if (twins.length === 1 && twin) {
      const dup = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM txn t WHERE t.user_id = ?1 AND t.account_id = ?2
             AND ${duplicatesLive('?3')}`,
        )
        .bind(userId, h.id, twin.id)
        .first<{ n: number }>();
      const duplicates = dup?.n ?? 0;
      out.push({
        historyId: h.id,
        historyName: h.name,
        liveId: twin.id,
        liveName: twin.name,
        rows: h.rows - duplicates,
        duplicates,
      });
    }
  }
  return out;
}

/**
 * Move a history account's transactions onto its live twin and remove the emptied copy. Rows
 * the live account's bank feed already has are dropped instead, so nothing is counted twice.
 */
export async function mergeHistoryAccount(
  userId: UserId,
  db: D1Database,
  historyId: string,
  liveId: string,
): Promise<{ moved: number; dropped: number }> {
  const pair = (await listMergeCandidates(userId, db)).find(
    (c) => c.historyId === historyId && c.liveId === liveId,
  );
  if (!pair) throw new AppError(404, 'NOT_FOUND', 'Those accounts are not a mergeable pair');
  await db.batch([
    ...(await dropImported(userId, db, `t.account_id = ?2 AND ${duplicatesLive('?3')}`, [
      historyId,
      liveId,
    ])),
    db
      .prepare('UPDATE txn SET account_id = ?3 WHERE user_id = ?1 AND account_id = ?2')
      .bind(userId, historyId, liveId),
    db
      .prepare('DELETE FROM deleted_txn WHERE user_id = ?1 AND account_id = ?2')
      .bind(userId, historyId),
    db
      .prepare('DELETE FROM balance_snapshot WHERE user_id = ?1 AND account_id = ?2')
      .bind(userId, historyId),
    db
      .prepare(
        `DELETE FROM account WHERE user_id = ?1 AND id = ?2
           AND NOT EXISTS (SELECT 1 FROM txn WHERE user_id = ?1 AND account_id = ?2)`,
      )
      .bind(userId, historyId),
  ]);
  return { moved: pair.rows, dropped: pair.duplicates };
}

/**
 * Imported rows already sitting on a bank-fed account for days its feed covers: left by an
 * import whose dates were a day or two off the bank's, or by a merge before merges dropped
 * them. Listed per account so the person can remove them.
 */
export async function listFeedOverlaps(
  userId: UserId,
  db: D1Database,
): Promise<MonarchFeedOverlap[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id AS accountId, a.name AS accountName, COUNT(*) AS rows,
         MIN(t.posted_at) AS "from", MAX(t.posted_at) AS "to"
       FROM txn t JOIN account a ON a.id = t.account_id AND a.user_id = t.user_id
       WHERE t.user_id = ?1 AND t.source = 'csv' AND t.import_batch_id IS NOT NULL
         AND ${coveredByFeed('t.account_id', 't.posted_at')}
       GROUP BY a.id ORDER BY a.name`,
    )
    .bind(userId)
    .all<MonarchFeedOverlap>();
  return results;
}

/** Remove one account's imported rows that its bank feed already covers. */
export async function removeFeedOverlap(
  userId: UserId,
  db: D1Database,
  accountId: string,
): Promise<number> {
  const hit = (await listFeedOverlaps(userId, db)).find((o) => o.accountId === accountId);
  if (!hit) throw new AppError(404, 'NOT_FOUND', 'Nothing to remove on that account');
  await db.batch(
    await dropImported(
      userId,
      db,
      `t.account_id = ?2 AND ${coveredByFeed('t.account_id', 't.posted_at')}`,
      [accountId],
    ),
  );
  return hit.rows;
}
