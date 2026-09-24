import type { MemoryCount, OfferState } from '@rise/shared/categorize';
import { Rule } from '@rise/shared/schemas';
import { newId, nowIso, type UserId } from './util';

// ── rules (SPEC §4.1) ─────────────────────────────────────────────────────────

interface RuleRow {
  id: string;
  match_field: string;
  match_type: string;
  match_value: string;
  category_id: string;
  priority: number;
  created_at: string;
}

const toRule = (r: RuleRow): Rule =>
  Rule.parse({
    id: r.id,
    matchField: r.match_field,
    matchType: r.match_type,
    matchValue: r.match_value,
    categoryId: r.category_id,
    priority: r.priority,
    createdAt: r.created_at,
  });

export async function listRules(userId: UserId, db: D1Database): Promise<Rule[]> {
  const { results } = await db
    .prepare('SELECT * FROM rule WHERE user_id = ?1 ORDER BY priority DESC, created_at, id')
    .bind(userId)
    .all<RuleRow>();
  return results.map(toRule);
}

export async function getRule(userId: UserId, db: D1Database, id: string): Promise<Rule | null> {
  const row = await db
    .prepare('SELECT * FROM rule WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id)
    .first<RuleRow>();
  return row ? toRule(row) : null;
}

export async function insertRule(
  userId: UserId,
  db: D1Database,
  r: Omit<Rule, 'id' | 'createdAt'>,
): Promise<Rule> {
  const rule: Rule = { ...r, id: newId(), createdAt: nowIso() };
  await db
    .prepare(
      `INSERT INTO rule (id, user_id, match_field, match_type, match_value, category_id, priority, created_at)
       VALUES (?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      userId,
      rule.id,
      rule.matchField,
      rule.matchType,
      rule.matchValue,
      rule.categoryId,
      rule.priority,
      rule.createdAt,
    )
    .run();
  return rule;
}

export async function deleteRule(userId: UserId, db: D1Database, id: string): Promise<boolean> {
  const r = await db
    .prepare('DELETE FROM rule WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id)
    .run();
  return r.meta.changes > 0;
}

// ── merchant memory (SPEC §4.2) ───────────────────────────────────────────────

export async function memoryFor(
  userId: UserId,
  db: D1Database,
  merchants: string[],
): Promise<Map<string, MemoryCount[]>> {
  const out = new Map<string, MemoryCount[]>();
  if (merchants.length === 0) return out;
  const { results } = await db
    .prepare(
      `SELECT merchant_normalized, category_id, count, last_used_at FROM merchant_memory
       WHERE user_id = ?1 AND merchant_normalized IN (SELECT value FROM json_each(?2))`,
    )
    .bind(userId, JSON.stringify([...new Set(merchants)]))
    .all<{
      merchant_normalized: string;
      category_id: string;
      count: number;
      last_used_at: string | null;
    }>();
  for (const r of results) {
    const m: MemoryCount = {
      categoryId: r.category_id,
      count: r.count,
      lastUsedAt: r.last_used_at,
    };
    out.set(r.merchant_normalized, [...(out.get(r.merchant_normalized) ?? []), m]);
  }
  return out;
}

/** Counting is silent and reversible (SPEC §4.6); it never changes money. */
export function bumpMemoryStmt(
  userId: UserId,
  db: D1Database,
  merchant: string,
  categoryId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO merchant_memory (user_id, merchant_normalized, category_id, count, last_used_at)
       VALUES (?1, ?2, ?3, 1, ?4)
       ON CONFLICT (user_id, merchant_normalized, category_id)
       DO UPDATE SET count = count + 1, last_used_at = excluded.last_used_at`,
    )
    .bind(userId, merchant, categoryId, nowIso());
}

// ── merchant meta: rename + rule-offer state (SPEC §4.6, §4.7) ─────────────────

export interface MerchantMetaRow extends OfferState {
  displayName: string | null;
}

export async function getMerchantMeta(
  userId: UserId,
  db: D1Database,
  merchant: string,
): Promise<MerchantMetaRow> {
  const row = await db
    .prepare(
      `SELECT display_name, suppress_rule_offer, consecutive_same, consecutive_cat_id FROM merchant_meta
       WHERE user_id = ?1 AND merchant_normalized = ?2`,
    )
    .bind(userId, merchant)
    .first<{
      display_name: string | null;
      suppress_rule_offer: number;
      consecutive_same: number;
      consecutive_cat_id: string | null;
    }>();
  return {
    displayName: row?.display_name ?? null,
    suppressed: row?.suppress_rule_offer === 1,
    consecutiveSame: row?.consecutive_same ?? 0,
    consecutiveCategoryId: row?.consecutive_cat_id ?? null,
  };
}

export function putMerchantMetaStmt(
  userId: UserId,
  db: D1Database,
  merchant: string,
  m: MerchantMetaRow,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO merchant_meta (user_id, merchant_normalized, display_name, suppress_rule_offer, consecutive_same, consecutive_cat_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (user_id, merchant_normalized) DO UPDATE SET
         display_name = excluded.display_name,
         suppress_rule_offer = excluded.suppress_rule_offer,
         consecutive_same = excluded.consecutive_same,
         consecutive_cat_id = excluded.consecutive_cat_id`,
    )
    .bind(
      userId,
      merchant,
      m.displayName,
      m.suppressed ? 1 : 0,
      m.consecutiveSame,
      m.consecutiveCategoryId,
    );
}

export async function displayNamesFor(
  userId: UserId,
  db: D1Database,
  merchants: string[],
): Promise<Map<string, string>> {
  if (merchants.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT merchant_normalized, display_name FROM merchant_meta
       WHERE user_id = ?1 AND display_name IS NOT NULL
         AND merchant_normalized IN (SELECT value FROM json_each(?2))`,
    )
    .bind(userId, JSON.stringify([...new Set(merchants)]))
    .all<{ merchant_normalized: string; display_name: string }>();
  return new Map(results.map((r) => [r.merchant_normalized, r.display_name]));
}

/** A rename applies to every past transaction too (SPEC §4.7). */
export function renameMerchantTxnsStmt(
  userId: UserId,
  db: D1Database,
  merchant: string,
  displayName: string | null,
): D1PreparedStatement {
  return db
    .prepare(
      'UPDATE txn SET merchant_display = ?3, updated_at = ?4 WHERE user_id = ?1 AND merchant_normalized = ?2',
    )
    .bind(userId, merchant, displayName, nowIso());
}

// ── recurring (SPEC §4.3) ─────────────────────────────────────────────────────

export async function recurringCategoryFor(
  userId: UserId,
  db: D1Database,
  merchants: string[],
): Promise<Map<string, string>> {
  if (merchants.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT merchant_normalized, category_id FROM recurring_series
       WHERE user_id = ?1 AND status = 'active' AND category_id IS NOT NULL
         AND merchant_normalized IN (SELECT value FROM json_each(?2))
       ORDER BY updated_at`,
    )
    .bind(userId, JSON.stringify([...new Set(merchants)]))
    .all<{ merchant_normalized: string; category_id: string }>();
  return new Map(results.map((r) => [r.merchant_normalized, r.category_id]));
}

// ── suggestions on the review queue ───────────────────────────────────────────

export interface QueueRow {
  id: string;
  descriptor_raw: string;
  merchant_normalized: string;
}

export async function listNeedsReview(
  userId: UserId,
  db: D1Database,
  merchant: string | null,
): Promise<QueueRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, descriptor_raw, merchant_normalized FROM txn
       WHERE user_id = ?1 AND review_state = 'needs_review' AND (?2 IS NULL OR merchant_normalized = ?2)`,
    )
    .bind(userId, merchant)
    .all<QueueRow>();
  return results;
}

export function setSuggestionStmt(
  userId: UserId,
  db: D1Database,
  txnId: string,
  categoryId: string | null,
  confidence: number,
): D1PreparedStatement {
  return db
    .prepare(
      'UPDATE txn SET suggested_category_id = ?3, suggestion_confidence = ?4 WHERE user_id = ?1 AND id = ?2',
    )
    .bind(userId, txnId, categoryId, confidence);
}
