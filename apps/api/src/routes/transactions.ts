import { validateSplits } from '@rise/shared/budget';
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
  categoryIdsExist,
  countingChangeStmts,
  getAccount,
  getTransaction,
  getTransactionRow,
  insertManualTransaction,
  listAcceptable,
  listTransactions,
  linkTransferStmts,
  replaceSplits,
  splitsFor,
  unlinkTransferStmts,
  updateTransactionFields,
  type TxnRow,
} from '../db';
import type { AppEnv } from '../env';
import { recordManualCategorisation } from '../lib/categorize';
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
    const [postedAt, id] = new TextDecoder().decode(b64urlDecode(cursor)).split('|');
    if (postedAt && id) return { postedAt, id };
  } catch {
    /* fall through */
  }
  throw new AppError(400, 'BAD_REQUEST', 'Invalid cursor');
}

const encodeCursor = (postedAt: string, id: string) =>
  b64urlEncode(new TextEncoder().encode(`${postedAt}|${id}`));

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
      accountId: f.account,
      categoryId: f.category,
      q: f.q,
      reviewState: f.reviewState,
      after: decodeCursor(f.cursor),
    },
    PAGE + 1,
  );
  const page = items.slice(0, PAGE);
  const last = page.at(-1);
  return c.json({
    items: page,
    nextCursor: items.length > PAGE && last ? encodeCursor(last.postedAt, last.id) : null,
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
 */
transactions.post('/bulk-accept', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const by = await body(c, BulkAcceptBody);
  const rows = await listAcceptable(userId, db, by);
  for (const row of rows) {
    const categoryId = row.suggested_category_id;
    if (!categoryId) continue;
    await replaceSplits(userId, db, row, [{ categoryId, amountCents: row.amount_cents }]);
    await updateTransactionFields(userId, db, row.id, { reviewState: 'reviewed' });
    await recordManualCategorisation(db, userId, txnRef(row), categoryId, {
      countTowardOffer: false,
    });
  }
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

/** Unlink: both legs go back to being ordinary transactions. */
transactions.delete('/:id/transfer-link', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const a = await getTransactionRow(userId, db, c.req.param('id'));
  if (!a) throw notFound();
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
