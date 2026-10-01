import { periodOf } from '@rise/shared/budget';
import { normalizeMerchant } from '@rise/shared/categorize';
import type { MonarchRowsBody, MonarchSetupBody } from '@rise/shared/schemas';
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

async function closedPeriods(userId: UserId, db: D1Database, ids: string[]): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT id FROM period WHERE user_id = ?1 AND status = 'closed'
         AND id IN (SELECT value FROM json_each(?2))`,
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
  const [accounts, categories, closed] = await Promise.all([
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
    closedPeriods(
      userId,
      db,
      b.rows.map((r) => periodOf(r.postedAt)),
    ),
  ]);
  const usable = b.rows.filter(
    (r) =>
      accounts.has(r.accountId) &&
      categories.has(r.categoryId) &&
      r.postedAt >= window.from &&
      r.postedAt <= window.to &&
      !closed.has(periodOf(r.postedAt)),
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
