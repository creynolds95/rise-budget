import { firstMatchingRule, rankMemory, validateRule } from '@rise/shared/categorize';
import { CreateRuleBody, PatchMerchantBody } from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  categoryIdsExist,
  deleteRule,
  getMerchantMeta,
  getRule,
  insertRule,
  listRules,
  memoryFor,
  putMerchantMetaStmt,
  renameMerchantTxnsStmt,
  writeAudit,
} from '../db';
import type { AppEnv } from '../env';
import { refreshSuggestions } from '../lib/categorize';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';

export const rules = new Hono<AppEnv>();
export const merchants = new Hono<AppEnv>();

rules.get('/', async (c) => c.json(await listRules(c.get('userId'), c.env.DB)));

/**
 * SPEC §4.6: a rule is permanent and overrides everything, so it exists only because the
 * user said yes — this call is that yes. It changes suggestions in the queue, never splits.
 */
rules.post('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const b = await body(c, CreateRuleBody);
  const v = validateRule(b.matchType, b.matchValue);
  if (!v.ok) throw new AppError(400, 'BAD_REQUEST', v.message);
  if (!(await categoryIdsExist(userId, db, [b.categoryId])))
    throw new AppError(400, 'BAD_REQUEST', 'Unknown category');
  const rule = await insertRule(userId, db, b);
  await writeAudit(userId, db, 'rule.created', { type: 'rule', id: rule.id, detail: { ...b } });
  await refreshSuggestions(db, userId);
  return c.json(rule, 201);
});

rules.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const rule = await getRule(userId, db, c.req.param('id'));
  if (!rule || !(await deleteRule(userId, db, rule.id)))
    throw new AppError(404, 'NOT_FOUND', 'Rule not found');
  await writeAudit(userId, db, 'rule.deleted', { type: 'rule', id: rule.id, detail: { ...rule } });
  await refreshSuggestions(db, userId);
  return c.body(null, 204);
});

async function merchantView(db: D1Database, userId: string, merchant: string) {
  const [meta, memory, all] = await Promise.all([
    getMerchantMeta(userId, db, merchant),
    memoryFor(userId, db, [merchant]),
    listRules(userId, db),
  ]);
  const ranked = rankMemory(memory.get(merchant) ?? []);
  return {
    merchantNormalized: merchant,
    displayName: meta.displayName,
    suppressRuleOffer: meta.suppressed,
    memory: ranked,
    topCategoryIds: ranked.slice(0, 3).map((m) => m.categoryId),
    // Merchant-field rules only: descriptor rules depend on the individual transaction.
    rule: firstMatchingRule(
      all.filter((r) => r.matchField === 'merchant'),
      '',
      merchant,
    ),
  };
}

merchants.get('/:normalized', async (c) =>
  c.json(await merchantView(c.env.DB, c.get('userId'), c.req.param('normalized'))),
);

merchants.patch('/:normalized', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const merchant = c.req.param('normalized');
  const b = await body(c, PatchMerchantBody);
  const meta = await getMerchantMeta(userId, db, merchant);
  const next = {
    ...meta,
    ...(b.displayName !== undefined ? { displayName: b.displayName } : {}),
    ...(b.suppressRuleOffer !== undefined ? { suppressed: b.suppressRuleOffer } : {}),
  };
  await db.batch([
    putMerchantMetaStmt(userId, db, merchant, next),
    ...(b.displayName !== undefined
      ? [renameMerchantTxnsStmt(userId, db, merchant, b.displayName)]
      : []),
  ]);
  return c.json(await merchantView(db, userId, merchant));
});
