import { validateSplits } from '@rise/shared/budget';
import { normalizeMerchant } from '@rise/shared/categorize';
import {
  CreateTransactionBody,
  PatchTransactionBody,
  ReplaceSplitsBody,
  TransactionQuery,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  categoryIdsExist,
  getAccount,
  getTransaction,
  getTransactionRow,
  insertManualTransaction,
  listTransactions,
  replaceSplits,
  updateTransactionFields,
} from '../db';
import type { AppEnv } from '../env';
import { b64urlDecode, b64urlEncode } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';

export const transactions = new Hono<AppEnv>();

const PAGE = 50;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Transaction not found');

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
  if (b.categoryId) {
    if (!(await categoryIdsExist(userId, c.env.DB, [b.categoryId])))
      throw new AppError(400, 'BAD_REQUEST', 'Unknown category');
    await replaceSplits(userId, c.env.DB, row, [
      { categoryId: b.categoryId, amountCents: row.amount_cents },
    ]);
  }
  await updateTransactionFields(userId, c.env.DB, id, b);
  return c.json(await getTransaction(userId, c.env.DB, id));
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
  await replaceSplits(userId, c.env.DB, row, splits);
  return c.json(await getTransaction(userId, c.env.DB, id));
});
