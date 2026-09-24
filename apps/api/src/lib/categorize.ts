import {
  categorize,
  firstMatchingRule,
  isAmbiguousMerchant,
  recordCategorisation,
  type Suggestion,
} from '@rise/shared/categorize';
import {
  bumpMemoryStmt,
  getMerchantMeta,
  listCategories,
  listNeedsReview,
  listRules,
  memoryFor,
  putMerchantMetaStmt,
  recurringCategoryFor,
  setSuggestionStmt,
  type UserId,
} from '../db';

/** Suggestions for a batch of transactions, loading shared context once. */
export async function suggestFor(
  db: D1Database,
  userId: UserId,
  txns: { id: string; descriptor: string; merchant: string }[],
): Promise<Map<string, Suggestion>> {
  const merchants = txns.map((t) => t.merchant);
  const [rules, categories, memory, recurring] = await Promise.all([
    listRules(userId, db),
    listCategories(userId, db),
    memoryFor(userId, db, merchants),
    recurringCategoryFor(userId, db, merchants),
  ]);
  return new Map(
    txns.map((t) => [
      t.id,
      categorize({
        descriptor: t.descriptor,
        merchant: t.merchant,
        rules,
        memory: memory.get(t.merchant) ?? [],
        recurringCategoryId: recurring.get(t.merchant) ?? null,
        categories,
      }),
    ]),
  );
}

/**
 * Re-run suggestions for everything waiting in the review queue (optionally one merchant).
 * Suggestions are not money: a suggestion never becomes a split until the user accepts it.
 */
export async function refreshSuggestions(
  db: D1Database,
  userId: UserId,
  merchant: string | null = null,
): Promise<void> {
  const rows = await listNeedsReview(userId, db, merchant);
  if (rows.length === 0) return;
  const s = await suggestFor(
    db,
    userId,
    rows.map((r) => ({ id: r.id, descriptor: r.descriptor_raw, merchant: r.merchant_normalized })),
  );
  await db.batch(
    rows.map((r) => {
      const x = s.get(r.id);
      return setSuggestionStmt(userId, db, r.id, x?.categoryId ?? null, x?.confidence ?? 0);
    }),
  );
}

export interface RuleOffer {
  merchant: string;
  categoryId: string;
}

/**
 * A manual categorisation by the user: count it in merchant memory, advance the rule-offer
 * streak, and refresh the queue for that merchant. `categoryId` is null for a split, which
 * teaches memory nothing and breaks the streak. Returns the offer to show, if any.
 */
export async function recordManualCategorisation(
  db: D1Database,
  userId: UserId,
  txn: { descriptor: string; merchant: string },
  categoryId: string | null,
  opts: { countTowardOffer: boolean } = { countTowardOffer: true },
): Promise<RuleOffer | null> {
  const [meta, rules] = await Promise.all([
    getMerchantMeta(userId, db, txn.merchant),
    listRules(userId, db),
  ]);
  const step = opts.countTowardOffer
    ? recordCategorisation(meta, categoryId, {
        ruleCovers: firstMatchingRule(rules, txn.descriptor, txn.merchant) !== null,
        ambiguous: isAmbiguousMerchant(txn.merchant),
      })
    : { state: meta, offer: false };
  await db.batch([
    ...(categoryId ? [bumpMemoryStmt(userId, db, txn.merchant, categoryId)] : []),
    putMerchantMetaStmt(userId, db, txn.merchant, { ...meta, ...step.state }),
  ]);
  await refreshSuggestions(db, userId, txn.merchant);
  return step.offer && categoryId ? { merchant: txn.merchant, categoryId } : null;
}
