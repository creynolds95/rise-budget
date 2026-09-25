import { periodOf, validateSplits } from '@rise/shared/budget';
import { normalizeMerchant } from '@rise/shared/categorize';
import { firstUpcoming } from '@rise/shared/recurring';
import {
  BulkAcceptBody,
  CreateTransactionBody,
  PatchTransactionBody,
  RecurringCashWithdrawalBody,
  ReplaceSplitsBody,
  TransactionQuery,
  TransferLinkBody,
  type RuleOffer,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  bumpMemoryStmt,
  categoryIdsExist,
  deleteManualRuleStmt,
  ensureCatchallCategory,
  ensureTransferCategory,
  flagClosedPeriodStmt,
  getAccount,
  getTransaction,
  getTransactionRow,
  getUser,
  insertManualTransaction,
  listAcceptable,
  listTransactions,
  newId,
  nowIso,
  reassignSplitStmts,
  refreshAggregateStmts,
  seriesId,
  sortKey,
  linkTransferStmts,
  movePostedAtStmts,
  replaceSplits,
  splitsFor,
  unlinkTransferStmts,
  markTransferStmt,
  unmarkTransferStmt,
  updateTransactionFields,
  upsertManualRuleStmt,
  type TxnRow,
} from '../db';
import type { AppEnv } from '../env';
import { recordManualCategorisation, refreshSuggestions, suggestFor } from '../lib/categorize';
import { b64urlDecode, b64urlEncode } from '../lib/crypto';
import { localToday } from '../lib/dates';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';

export const transactions = new Hono<AppEnv>();

const PAGE = 50;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Transaction not found');
const txnRef = (r: TxnRow) => ({ descriptor: r.descriptor_raw, merchant: r.merchant_normalized });

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return undefined;
  try {
    const [key, id] = new TextDecoder().decode(b64urlDecode(cursor)).split('|');
    if (key && id) return { key, id };
  } catch {
    /* fall through */
  }
  throw new AppError(400, 'BAD_REQUEST', 'Invalid cursor');
}

const encodeCursor = (key: string, id: string) =>
  b64urlEncode(new TextEncoder().encode(`${key}|${id}`));

transactions.get('/', async (c) => {
  const q = TransactionQuery.safeParse(c.req.query());
  if (!q.success) throw new AppError(400, 'BAD_REQUEST', 'Invalid query', q.error.issues);
  const f = q.data;
  const items = await listTransactions(
    c.get('userId'),
    c.env.DB,
    {
      from: f.from,
      to: f.to,
      accountIds: f.account,
      categoryIds: f.category,
      q: f.q,
      reviewState: f.reviewState,
      direction: f.direction,
      minCents: f.min,
      maxCents: f.max,
      sort: f.sort,
      after: decodeCursor(f.cursor),
    },
    PAGE + 1,
  );
  const page = items.slice(0, PAGE);
  const last = page.at(-1);
  return c.json({
    items: page,
    nextCursor: items.length > PAGE && last ? encodeCursor(sortKey(last, f.sort), last.id) : null,
  });
});

transactions.get('/:id', async (c) => {
  const t = await getTransaction(c.get('userId'), c.env.DB, c.req.param('id'));
  if (!t) throw notFound();
  return c.json(t);
});

/**
 * Manual entry. Picking a category by hand is reviewed on the spot. Leaving it blank still
 * gets a real category (H1) — the same best guess sync would make, or the catch-all — so it
 * counts as real spending immediately; it waits in the review queue like any other guess.
 */
transactions.post('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const b = await body(c, CreateTransactionBody);
  const account = await getAccount(userId, db, b.accountId);
  if (!account) throw new AppError(400, 'BAD_REQUEST', 'Unknown account');
  if (b.categoryId && !(await categoryIdsExist(userId, db, [b.categoryId]))) {
    throw new AppError(400, 'BAD_REQUEST', 'Unknown category');
  }
  const merchant = normalizeMerchant(b.descriptor);
  const categoryId =
    b.categoryId ??
    (
      await suggestFor(db, userId, [
        {
          id: 'draft',
          descriptor: b.descriptor,
          merchant,
          amountCents: b.amountCents,
          accountKind: account.kind,
        },
      ])
    ).get('draft')?.categoryId ??
    (await ensureCatchallCategory(userId, db)).id;
  const id = await insertManualTransaction(userId, db, {
    accountId: b.accountId,
    postedAt: b.postedAt,
    amountCents: b.amountCents,
    descriptor: b.descriptor,
    merchant,
    notes: b.notes ?? null,
    reviewState: b.categoryId ? 'reviewed' : 'needs_review',
  });
  const row = await getTransactionRow(userId, db, id);
  if (!row) throw notFound();
  await replaceSplits(userId, db, row, [{ categoryId, amountCents: b.amountCents }]);
  if (b.categoryId) {
    // Entered by hand, so it teaches memory, but a rule offer belongs to the review flow.
    await recordManualCategorisation(db, userId, txnRef(row), b.categoryId, {
      countTowardOffer: false,
    });
  }
  return c.json(await getTransaction(userId, db, id), 201);
});

/** Setting `categoryId` makes the transaction one split of its whole amount (SPEC §3.5). */
transactions.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const row = await getTransactionRow(userId, c.env.DB, id);
  if (!row) throw notFound();
  const b = await body(c, PatchTransactionBody);
  if (b.reviewState === 'dropped')
    throw new AppError(400, 'BAD_REQUEST', 'Only sync can drop a pending transaction');
  let ruleOffer: RuleOffer | null = null;
  if (b.categoryId) {
    if (!(await categoryIdsExist(userId, c.env.DB, [b.categoryId])))
      throw new AppError(400, 'BAD_REQUEST', 'Unknown category');
    const changed = await replaceSplits(userId, c.env.DB, row, [
      { categoryId: b.categoryId, amountCents: row.amount_cents },
    ]);
    if (changed || row.review_state === 'needs_review') {
      ruleOffer = await recordManualCategorisation(c.env.DB, userId, txnRef(row), b.categoryId);
    }
  }
  if (b.postedAt && b.postedAt !== row.posted_at) {
    const splits = (await splitsFor(userId, c.env.DB, [id])).get(id) ?? [];
    await c.env.DB.batch(await movePostedAtStmts(userId, c.env.DB, row, splits, b.postedAt));
  }
  await updateTransactionFields(userId, c.env.DB, id, b);
  return c.json({ ...(await getTransaction(userId, c.env.DB, id)), ruleOffer });
});

/** Replace the full split set. Amounts must sum exactly to the parent (edge 11). */
transactions.post('/:id/splits', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const row = await getTransactionRow(userId, c.env.DB, id);
  if (!row) throw notFound();
  const { splits } = await body(c, ReplaceSplitsBody);
  const v = validateSplits(row.amount_cents, splits);
  if (!v.ok) {
    throw new AppError(
      422,
      'SPLITS_DO_NOT_SUM',
      v.code === 'SPLITS_DO_NOT_SUM'
        ? `Splits add up to ${v.actualCents} but the transaction is ${v.expectedCents}`
        : 'At least one split is required',
      v,
    );
  }
  if (
    !(await categoryIdsExist(
      userId,
      c.env.DB,
      splits.map((s) => s.categoryId),
    ))
  ) {
    throw new AppError(400, 'BAD_REQUEST', 'Unknown category');
  }
  if (await replaceSplits(userId, c.env.DB, row, splits)) {
    const single = new Set(splits.map((s) => s.categoryId));
    const [only] = single;
    await recordManualCategorisation(
      c.env.DB,
      userId,
      txnRef(row),
      single.size === 1 && only ? only : null,
    );
  }
  return c.json(await getTransaction(userId, c.env.DB, id));
});

/**
 * Accept stored suggestions: by id (a swipe on a pre-filled row) or every suggestion at or
 * above 0.90 (SPEC §8 "Accept all confident"). The user's tap is the confirmation. Accepting
 * teaches memory but doesn't count toward a rule offer.
 *
 * `listAcceptable` only ever returns rows with a live suggested category (it joins on
 * `category`), so every row here is accepted. Batched into one `db.batch` plus one
 * `refreshSuggestions` per distinct merchant, instead of ~5 round trips per row — the "accept
 * all confident" tap can cover hundreds of rows. The merchant-meta write `replaceSplits`'s
 * sibling path (`recordManualCategorisation` with `countTowardOffer: false`) would otherwise
 * do is skipped: with `countTowardOffer: false` it always writes back the same meta it read,
 * a no-op.
 */
transactions.post('/bulk-accept', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const by = await body(c, BulkAcceptBody);
  const rows = await listAcceptable(userId, db, by);
  if (rows.length === 0) return c.json({ accepted: [] });

  const oldSplits = await splitsFor(
    userId,
    db,
    rows.map((r) => r.id),
  );
  const { results: catRows } = await db
    .prepare('SELECT id, budgeted FROM category WHERE user_id = ?1')
    .bind(userId)
    .all<{ id: string; budgeted: number }>();
  const budgetedCats = new Set(catRows.filter((r) => r.budgeted === 1).map((r) => r.id));
  const now = nowIso();
  const periods = new Set<string>();
  const merchants = new Set<string>();
  const stmts: D1PreparedStatement[] = [];

  for (const row of rows) {
    const categoryId = row.suggested_category_id;
    if (!categoryId) continue;
    const periodId = periodOf(row.posted_at);
    periods.add(periodId);
    merchants.add(row.merchant_normalized);

    const old = oldSplits.get(row.id) ?? [];
    const same =
      old.length === 1 &&
      old[0]?.category_id === categoryId &&
      old[0]?.amount_cents === row.amount_cents;
    if (!same) {
      const dropped = row.review_state === 'dropped';
      const newCounted = !dropped && budgetedCats.has(categoryId) ? row.amount_cents : 0;
      const oldCounted = dropped
        ? 0
        : old.reduce((n, s) => n + (budgetedCats.has(s.category_id) ? s.amount_cents : 0), 0);
      const delta = newCounted - oldCounted;
      stmts.push(
        db.prepare('DELETE FROM split WHERE user_id = ?1 AND txn_id = ?2').bind(userId, row.id),
        db
          .prepare(
            'INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)',
          )
          .bind(newId(), userId, row.id, categoryId, row.amount_cents, periodId),
      );
      // Flag even at delta = 0 — a same-total recategorization still moves money between two
      // categories' own carry in a closed period (M2); flagClosedPeriodStmt no-ops if open.
      stmts.push(flagClosedPeriodStmt(userId, db, periodId, delta));
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
  for (const merchant of merchants) await refreshSuggestions(db, userId, merchant);

  return c.json({ accepted: rows.map((r) => r.id) });
});

/**
 * Link two rows as a transfer by hand (SPEC §3.3) — typically a medium-confidence pair,
 * like checking → savings. Both legs stop counting as spending.
 */
transactions.post('/:id/transfer-link', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const { otherTxnId } = await body(c, TransferLinkBody);
  const [a, b] = await Promise.all([
    getTransactionRow(userId, db, c.req.param('id')),
    getTransactionRow(userId, db, otherTxnId),
  ]);
  if (!a || !b) throw notFound();
  if (a.account_id === b.account_id)
    throw new AppError(422, 'BAD_REQUEST', 'A transfer moves money between two accounts');
  if (a.amount_cents !== -b.amount_cents || a.amount_cents === 0)
    throw new AppError(
      422,
      'BAD_REQUEST',
      'The two sides of a transfer must be equal and opposite',
    );
  if (a.transfer_pair_id || b.transfer_pair_id)
    throw new AppError(409, 'CONFLICT', 'Already linked to another transaction');
  const transferCat = await ensureTransferCategory(userId, db);
  const splits = await splitsFor(userId, db, [a.id, b.id]);
  await db.batch([
    ...(await reassignSplitStmts(userId, db, a, splits.get(a.id) ?? [], transferCat.id)),
    ...(await reassignSplitStmts(userId, db, b, splits.get(b.id) ?? [], transferCat.id)),
    ...linkTransferStmts(userId, db, a.id, b.id),
  ]);
  return c.json({
    items: [await getTransaction(userId, db, a.id), await getTransaction(userId, db, b.id)],
  });
});

/**
 * One side of a transfer whose other side isn't here yet — typically a card payment from
 * checking to a card that reports monthly (Apple). It stops counting as spending now
 * (SPEC §3.4); the user's tap is the confirmation, and it can be linked or undone later.
 */
transactions.post('/:id/mark-transfer', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const a = await getTransactionRow(userId, db, c.req.param('id'));
  if (!a) throw notFound();
  if (a.is_transfer === 1) throw new AppError(409, 'CONFLICT', 'Already a transfer');
  const transferCat = await ensureTransferCategory(userId, db);
  const splits = await splitsFor(userId, db, [a.id]);
  await db.batch([
    ...(await reassignSplitStmts(userId, db, a, splits.get(a.id) ?? [], transferCat.id)),
    markTransferStmt(userId, db, a.id),
  ]);
  return c.json(await getTransaction(userId, db, a.id));
});

/** Unlink: both legs (or a lone marked leg) go back to being ordinary transactions. */
transactions.delete('/:id/transfer-link', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const a = await getTransactionRow(userId, db, c.req.param('id'));
  if (!a) throw notFound();
  const transferCat = await ensureTransferCategory(userId, db);
  const catchall = await ensureCatchallCategory(userId, db);
  // Only revert a leg's category if it's still the default Transfer category from link time
  // (A5) — a leg the user has since recategorized (e.g. to "Furniture") keeps that choice.
  const revertIfDefault = async (leg: TxnRow): Promise<D1PreparedStatement[]> => {
    const own = (await splitsFor(userId, db, [leg.id])).get(leg.id) ?? [];
    if (own.length === 1 && own[0]?.category_id === transferCat.id) {
      return reassignSplitStmts(userId, db, leg, own, catchall.id);
    }
    return [];
  };
  if (a.is_transfer === 1 && !a.transfer_pair_id) {
    await db.batch([...(await revertIfDefault(a)), unmarkTransferStmt(userId, db, a.id)]);
    return c.json({ items: [await getTransaction(userId, db, a.id)] });
  }
  const b = a.transfer_pair_id ? await getTransactionRow(userId, db, a.transfer_pair_id) : null;
  if (!b) throw new AppError(409, 'CONFLICT', 'Not linked as a transfer');
  await db.batch([
    ...(await revertIfDefault(a)),
    ...(await revertIfDefault(b)),
    ...unlinkTransferStmts(userId, db, a.id, b.id),
  ]);
  return c.json({
    items: [await getTransaction(userId, db, a.id), await getTransaction(userId, db, b.id)],
  });
});

/**
 * Caleb's "Recurring Cash Withdrawal" tag (cash-to-payday tool, SPEC-adjacent): a real cash
 * auto-draft too new or too easily confused with a sibling to auto-detect from 3 charges.
 * One rule per merchant — tagging again from another of its transactions replaces it.
 */
transactions.post('/:id/recurring-cash-withdrawal', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const row = await getTransactionRow(userId, db, c.req.param('id'));
  if (!row) throw notFound();
  const b = await body(c, RecurringCashWithdrawalBody);
  const user = await getUser(userId, db);
  const today = localToday(user?.timezone ?? 'America/Chicago');
  const nextExpectedDate = firstUpcoming(b.cadence, b.dueDate, null, today);
  await db.batch([
    upsertManualRuleStmt(
      userId,
      db,
      row.merchant_normalized,
      b.cadence,
      row.amount_cents,
      nextExpectedDate,
    ),
  ]);
  return c.json({ id: seriesId(userId, row.merchant_normalized) }, 201);
});

/** Untag: only ever removes a manual rule, never a detected series. */
transactions.delete('/:id/recurring-cash-withdrawal', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const row = await getTransactionRow(userId, db, c.req.param('id'));
  if (!row) throw notFound();
  await db.batch([deleteManualRuleStmt(userId, db, seriesId(userId, row.merchant_normalized))]);
  return c.body(null, 204);
});
