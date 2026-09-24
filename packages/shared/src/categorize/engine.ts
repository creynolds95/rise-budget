import { isAmbiguousMerchant } from './normalize';
import { resolveSeed } from './seeds';

/**
 * Categorisation (SPEC §4). Pure. Four layers in priority order; the first that produces a
 * category wins. The result is only ever a suggestion: nothing is applied until the user
 * accepts it.
 */

export type MatchField = 'descriptor' | 'merchant';
export type MatchType = 'contains' | 'equals' | 'regex';

export interface RuleInput {
  id: string;
  matchField: MatchField;
  matchType: MatchType;
  matchValue: string;
  categoryId: string;
  priority: number;
  createdAt: string;
}

export interface MemoryCount {
  categoryId: string;
  count: number;
  lastUsedAt: string | null;
}

export interface CategorizeInput {
  descriptor: string;
  merchant: string;
  rules: readonly RuleInput[];
  /** Merchant memory rows for this merchant only. */
  memory: readonly MemoryCount[];
  /** Category of the detected recurring series this transaction belongs to, if any. */
  recurringCategoryId: string | null;
  /** The user's active categories. Anything pointing elsewhere is ignored. */
  categories: readonly { id: string; name: string }[];
}

export type Layer = 'rule' | 'memory' | 'recurring' | 'seed';
/** SPEC §4.5: confident ≥ 0.90 (bulk-acceptable), guess 0.60–0.90, none < 0.60. */
export type Band = 'confident' | 'guess' | 'none';

export interface Suggestion {
  /** Pre-filled category, or null when nothing clears 0.60. */
  categoryId: string | null;
  confidence: number;
  layer: Layer | null;
  band: Band;
  ruleId: string | null;
  /** The merchant's most-used categories, for one-tap buttons when nothing is pre-filled. */
  topCategoryIds: string[];
}

export const CONFIDENT = 0.9;
export const PREFILL = 0.6;
export const RECURRING_CONFIDENCE = 0.95;
export const SEED_CONFIDENCE = 0.5;

export function bandOf(confidence: number): Band {
  if (confidence >= CONFIDENT) return 'confident';
  if (confidence >= PREFILL) return 'guess';
  return 'none';
}

const upper = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();

export function ruleMatches(rule: RuleInput, descriptor: string, merchant: string): boolean {
  const value = rule.matchField === 'descriptor' ? descriptor : merchant;
  switch (rule.matchType) {
    case 'contains':
      return upper(value).includes(upper(rule.matchValue));
    case 'equals':
      return upper(value) === upper(rule.matchValue);
    case 'regex':
      try {
        return new RegExp(rule.matchValue, 'i').test(value);
      } catch {
        return false;
      }
  }
}

/** Highest priority first; ties go to the older rule so adding a rule never reorders others. */
export function orderRules<T extends RuleInput>(rules: readonly T[]): T[] {
  return [...rules].sort(
    (a, b) =>
      b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export function firstMatchingRule<T extends RuleInput>(
  rules: readonly T[],
  descriptor: string,
  merchant: string,
): T | null {
  return orderRules(rules).find((r) => ruleMatches(r, descriptor, merchant)) ?? null;
}

export const MAX_REGEX_LENGTH = 200;

/** Checked when a rule is created, so a bad pattern never reaches matching. */
export function validateRule(
  matchType: MatchType,
  matchValue: string,
): { ok: true } | { ok: false; message: string } {
  if (matchValue.trim() === '') return { ok: false, message: 'Match value is empty' };
  if (matchType !== 'regex') return { ok: true };
  if (matchValue.length > MAX_REGEX_LENGTH)
    return { ok: false, message: `Pattern is longer than ${MAX_REGEX_LENGTH} characters` };
  try {
    new RegExp(matchValue, 'i');
    return { ok: true };
  } catch {
    return { ok: false, message: 'Pattern is not a valid regular expression' };
  }
}

/** Memory ordered by count, then most recently used. */
export function rankMemory(memory: readonly MemoryCount[]): MemoryCount[] {
  return memory
    .filter((m) => m.count > 0)
    .sort(
      (a, b) =>
        b.count - a.count ||
        (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') ||
        a.categoryId.localeCompare(b.categoryId),
    );
}

/**
 * SPEC §4.2: `p · (1 − 1/(1+n))`, which simplifies to `count(top) / (n + 1)`.
 * The shrinkage keeps one observation from becoming certainty.
 */
export function memoryConfidence(topCount: number, total: number): number {
  return total <= 0 ? 0 : topCount / (total + 1);
}

export function categorize(input: CategorizeInput): Suggestion {
  const active = new Set(input.categories.map((c) => c.id));
  const memory = rankMemory(input.memory.filter((m) => active.has(m.categoryId)));
  const topCategoryIds = memory.slice(0, 3).map((m) => m.categoryId);
  const result = (
    layer: Layer,
    categoryId: string,
    confidence: number,
    ruleId: string | null = null,
  ): Suggestion => {
    const band = bandOf(confidence);
    return {
      categoryId: band === 'none' ? null : categoryId,
      confidence,
      layer,
      band,
      ruleId,
      topCategoryIds,
    };
  };

  const rule = firstMatchingRule(
    input.rules.filter((r) => active.has(r.categoryId)),
    input.descriptor,
    input.merchant,
  );
  if (rule) return result('rule', rule.categoryId, 1, rule.id);

  // Marketplace purchases carry no signal about what was in the box: never guess.
  if (isAmbiguousMerchant(input.merchant)) {
    return {
      categoryId: null,
      confidence: 0,
      layer: null,
      band: 'none',
      ruleId: null,
      topCategoryIds,
    };
  }

  const top = memory[0];
  if (top) {
    const total = memory.reduce((n, m) => n + m.count, 0);
    return result('memory', top.categoryId, memoryConfidence(top.count, total));
  }

  if (input.recurringCategoryId && active.has(input.recurringCategoryId)) {
    return result('recurring', input.recurringCategoryId, RECURRING_CONFIDENCE);
  }

  const seed = resolveSeed(input.merchant, input.categories);
  if (seed) return { ...result('seed', seed, SEED_CONFIDENCE), topCategoryIds: [seed] };

  return {
    categoryId: null,
    confidence: 0,
    layer: null,
    band: 'none',
    ruleId: null,
    topCategoryIds,
  };
}
