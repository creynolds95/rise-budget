import { validateSplits } from '@rise/shared/budget';
import { allocateRefund, normalizeMerchant, refundFits } from '@rise/shared/categorize';
import { nextScheduled } from '@rise/shared/recurring';
import {
  BulkAcceptBody,
  CreateTransactionBody,
  PatchTransactionBody,
  RecurringCashWithdrawalBody,
  ReplaceSplitsBody,
  TransactionQuery,
  RefundLinkBody,
  SetTagsBody,
  TransferLinkBody,
  type RuleOffer,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  acceptSuggestions,
  categoryIdsExist,
  countOwnTags,
  deleteManualRuleStmt,
  deleteTransaction,
  ensureCatchallCategory,
  ensureTransferCategory,
  getAccount,
  getTransaction,
  getTransactionRow,
  getUser,
  insertManualTransaction,
  listAcceptable,
  listTransactions,
  reassignSplitStmts,
  refundedCents,
  seriesId,
  setRefundOf,
  setTxnTags,
  sortKey,
  totalTransactions,
  linkTransferStmts,
  movePostedAtStmts,
  replaceSplits,
  revertTransferLegStmts,
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

const parseQuery = (raw: Record<string, string>) => {
  const q = TransactionQuery.safeParse(raw);
  if (!q.success) throw new AppError(400, 'BAD_REQUEST', 'Invalid query', q.error.issues);
  return q.data;
};

const filtersOf = (f: ReturnType<typeof parseQuery>) => ({
  from: f.from,
  to: f.to,
  accountIds: f.account,
  categoryIds: f.category,
  notAccountIds: f.notAccount,
  notCategoryIds: f.notCategory,
  tagIds: f.tag,
  q: f.q,
  reviewState: f.reviewState,
  direction: f.direction,
  minCents: f.min,
  maxCents: f.max,
  sort: f.sort,
});

transactions.get('/', async (c) => {
  const f = parseQuery(c.req.query());
  const items = await listTransactions(
    c.get('userId'),
    c.env.DB,
    { ...filtersOf(f), after: decodeCursor(f.cursor) },
    PAGE + 1,
  );
  const page = items.slice(0, PAGE);
  const last = page.at(-1);
  return c.json({
    items: page,
    nextCursor: items.length > PAGE && last ? encodeCursor(sortKey(last, f.sort), last.id) : null,
  });
});

/** Running totals for the same filter as the list (Copilot-style). */
transactions.get('/totals', async (c) => {
  const f = parseQuery(c.req.query());
  return c.json(await totalTransactions(c.get('userId'), c.env.DB, filtersOf(f)));
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

/** Replace a transaction's tags. Labels only: no money moves. */
transactions.put('/:id/tags', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await getTransactionRow(userId, c.env.DB, id))) throw notFound();
  const tagIds = [...new Set((await body(c, SetTagsBody)).tagIds)];
  if ((await countOwnTags(userId, c.env.DB, tagIds)) !== tagIds.length)
    throw new AppError(400, 'BAD_REQUEST', 'Unknown tag');
  await setTxnTags(userId, c.env.DB, id, tagIds);
  return c.json(await getTransaction(userId, c.env.DB, id));
});

/** Remove a transaction for good. A linked transfer must be unlinked first. */
transactions.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const row = await getTransactionRow(userId, c.env.DB, c.req.param('id'));
  if (!row) throw notFound();
  if (row.transfer_pair_id)
    throw new AppError(409, 'CONFLICT', 'Unlink this transfer from the other side before deleting');
  if ((await refundedCents(userId, c.env.DB, row.id)) !== 0)
    throw new AppError(409, 'CONFLICT', 'Unlink its refund before deleting');
  await deleteTransaction(userId, c.env.DB, row);
  return c.body(null, 204);
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
 * `category`), so every row here is accepted: one batch (`acceptSuggestions`), then one
 * `refreshSuggestions` per distinct merchant.
 */
transactions.post('/bulk-accept', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const by = await body(c, BulkAcceptBody);
  const rows = await listAcceptable(userId, db, by);
  const merchants = await acceptSuggestions(userId, db, rows);
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
 * Tie a refund to the purchase it reverses. The refund takes the purchase's category (spread
 * in proportion across its splits), so it offsets exactly what it undoes; partial refunds are
 * fine up to what's left. The tap is the confirmation; unlink leaves the categories as they are.
 */
transactions.post('/:id/refund-link', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const { originalTxnId } = await body(c, RefundLinkBody);
  const [refund, original] = await Promise.all([
    getTransactionRow(userId, db, c.req.param('id')),
    getTransactionRow(userId, db, originalTxnId),
  ]);
  if (!refund || !original) throw notFound();
  if (refund.refund_of_id) throw new AppError(409, 'CONFLICT', 'Already linked to a purchase');
  const asTxn = (r: TxnRow) => ({
    id: r.id,
    accountId: r.account_id,
    postedAt: r.posted_at,
    amountCents: r.amount_cents,
    isTransfer: r.is_transfer === 1,
  });
  if (!refundFits(asTxn(refund), asTxn(original), await refundedCents(userId, db, original.id)))
    throw new AppError(
      422,
      'BAD_REQUEST',
      'A refund must come after its purchase and be no more than what is left of it',
    );
  const originalSplits = (await splitsFor(userId, db, [original.id])).get(original.id) ?? [];
  if (originalSplits.length === 0)
    throw new AppError(409, 'CONFLICT', 'That purchase has no category yet');
  await replaceSplits(
    userId,
    db,
    refund,
    allocateRefund(
      refund.amount_cents,
      originalSplits.map((s) => ({ categoryId: s.category_id, amountCents: s.amount_cents })),
    ).filter((s) => s.amountCents !== 0),
  );
  await setRefundOf(userId, db, refund.id, original.id);
  return c.json(await getTransaction(userId, db, refund.id));
});

transactions.delete('/:id/refund-link', async (c) => {
  const userId = c.get('userId');
  const row = await getTransactionRow(userId, c.env.DB, c.req.param('id'));
  if (!row) throw notFound();
  if (!row.refund_of_id) throw new AppError(409, 'CONFLICT', 'Not linked to a purchase');
  await setRefundOf(userId, c.env.DB, row.id, null);
  return c.json(await getTransaction(userId, c.env.DB, row.id));
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
  // Only revert a leg's category if it's still the default Transfer category from link time
  // (A5) — a leg the user has since recategorized (e.g. to "Furniture") keeps that choice. A
  // deposit leg into a cash account goes to the income catch-all, like sync would file it (C2).
  const revertIfDefault = (leg: TxnRow) => revertTransferLegStmts(userId, db, leg, transferCat.id);
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
 * The owner's "Recurring Cash Withdrawal" tag (cash-to-payday tool, SPEC-adjacent): a real cash
 * auto-draft too new or too easily confused with a sibling to auto-detect from 3 charges.
 * Also used the same way for a paycheck (income transactions carry a negative amount_cents,
 * SPEC §1.1) too new or irregular for auto-detection to pick up on its own — e.g. the owner's
 * semimonthly schedule paid the 5th and 20th. One rule per merchant — tagging again from
 * another of its transactions replaces it.
 */
transactions.post('/:id/recurring-cash-withdrawal', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const row = await getTransactionRow(userId, db, c.req.param('id'));
  if (!row) throw notFound();
  const b = await body(c, RecurringCashWithdrawalBody);
  const user = await getUser(userId, db);
  const today = localToday(user?.timezone ?? 'America/Chicago');
  const anchorDays = b.anchorDays ?? null;
  const nextExpectedDate = nextScheduled(b.cadence, b.dueDate, anchorDays, today);
  await db.batch([
    upsertManualRuleStmt(
      userId,
      db,
      row.merchant_normalized,
      b.cadence,
      row.amount_cents,
      nextExpectedDate,
      anchorDays,
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
