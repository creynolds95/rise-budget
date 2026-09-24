import { periodOf, validateSplits } from '@rise/shared/budget';
import { normalizeMerchant } from '@rise/shared/categorize';
import {
  BulkAcceptBody,
  CreateTransactionBody,
  PatchTransactionBody,
  ReplaceSplitsBody,
  TransactionQuery,
  TransferLinkBody,
  type RuleOffer,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  bumpMemoryStmt,
  categoryIdsExist,
  countingChangeStmts,
  flagClosedPeriodStmt,
  getAccount,
  getTransaction,
  getTransactionRow,
  insertManualTransaction,
  listAcceptable,
  listTransactions,
  newId,
  nowIso,
  refreshAggregateStmts,
  sortKey,
  linkTransferStmts,
  replaceSplits,
  splitsFor,
  unlinkTransferStmts,
  markTransferStmt,
  unmarkTransferStmt,
  updateTransactionFields,
  type TxnRow,
} from '../db';
import type { AppEnv } from '../env';
import { recordManualCategorisation, refreshSuggestions } from '../lib/categorize';
import { b64urlDecode, b64urlEncode } from '../lib/crypto';
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

/** Manual entry. Entered by hand, so already reviewed. */
transactions.post('/', async (c) => {
  const userId = c.get('userId');
  const b = await body(c, CreateTransactionBody);
  if (!(await getAccount(userId, c.env.DB, b.accountId)))
    throw new AppError(400, 'BAD_REQUEST', 'Unknown account');
  if (b.categoryId && !(await categoryIdsExist(userId, c.env.DB, [b.categoryId]))) {
    throw new AppError(400, 'BAD_REQUEST', 'Unknown category');
  }
  const id = await insertManualTransaction(userId, c.env.DB, {
    accountId: b.accountId,
    postedAt: b.postedAt,
    amountCents: b.amountCents,
    descriptor: b.descriptor,
    merchant: normalizeMerchant(b.descriptor),
    notes: b.notes ?? null,
  });
  if (b.categoryId) {
    const row = await getTransactionRow(userId, c.env.DB, id);
    if (!row) throw notFound();
    await replaceSplits(userId, c.env.DB, row, [
      { categoryId: b.categoryId, amountCents: b.amountCents },
    ]);
    // Entered by hand, so it teaches memory, but a rule offer belongs to the review flow.
    await recordManualCategorisation(c.env.DB, userId, txnRef(row), b.categoryId, {
      countTowardOffer: false,
    });
  }
  return c.json(await getTransaction(userId, c.env.DB, id), 201);
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
      const counts = row.is_transfer === 0 && row.review_state !== 'dropped';
      const delta = row.amount_cents - old.reduce((n, s) => n + s.amount_cents, 0);
      stmts.push(
        db.prepare('DELETE FROM split WHERE user_id = ?1 AND txn_id = ?2').bind(userId, row.id),
        db
          .prepare(
            'INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)',
          )
          .bind(newId(), userId, row.id, categoryId, row.amount_cents, periodId),
      );
      if (counts) stmts.push(flagClosedPeriodStmt(userId, db, periodId, delta));
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
  const splits = await splitsFor(userId, db, [a.id, b.id]);
  await db.batch([
    ...countingChangeStmts(userId, db, a, splits.get(a.id) ?? [], false),
    ...countingChangeStmts(userId, db, b, splits.get(b.id) ?? [], false),
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
  const splits = await splitsFor(userId, db, [a.id]);
  await db.batch([
    ...countingChangeStmts(userId, db, a, splits.get(a.id) ?? [], false),
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
  if (a.is_transfer === 1 && !a.transfer_pair_id) {
    const own = await splitsFor(userId, db, [a.id]);
    await db.batch([
      ...countingChangeStmts(userId, db, a, own.get(a.id) ?? [], true),
      unmarkTransferStmt(userId, db, a.id),
    ]);
    return c.json({ items: [await getTransaction(userId, db, a.id)] });
  }
  const b = a.transfer_pair_id ? await getTransactionRow(userId, db, a.transfer_pair_id) : null;
  if (!b) throw new AppError(409, 'CONFLICT', 'Not linked as a transfer');
  const splits = await splitsFor(userId, db, [a.id, b.id]);
  await db.batch([
    ...countingChangeStmts(userId, db, a, splits.get(a.id) ?? [], true),
    ...countingChangeStmts(userId, db, b, splits.get(b.id) ?? [], true),
    ...unlinkTransferStmts(userId, db, a.id, b.id),
  ]);
  return c.json({
    items: [await getTransaction(userId, db, a.id), await getTransaction(userId, db, b.id)],
  });
});
