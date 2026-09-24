import { describe, expect, it } from 'vitest';
import {
  bandOf,
  categorize,
  firstMatchingRule,
  memoryConfidence,
  orderRules,
  rankMemory,
  ruleMatches,
  validateRule,
  type CategorizeInput,
  type RuleInput,
} from './engine';
import { resolveSeed } from './seeds';

const cats = [
  { id: 'gas', name: 'Gas' },
  { id: 'groc', name: 'Groceries' },
  { id: 'home', name: 'Home' },
  { id: 'kids', name: 'Kids' },
];

const rule = (over: Partial<RuleInput> = {}): RuleInput => ({
  id: 'r1',
  matchField: 'merchant',
  matchType: 'equals',
  matchValue: 'QuikTrip',
  categoryId: 'gas',
  priority: 0,
  createdAt: '2026-09-01T00:00:00Z',
  ...over,
});

const input = (over: Partial<CategorizeInput> = {}): CategorizeInput => ({
  descriptor: 'QT 1234 OUTSIDE TULSA OK',
  merchant: 'QuikTrip',
  rules: [],
  memory: [],
  recurringCategoryId: null,
  categories: cats,
  ...over,
});

describe('memory confidence (SPEC §4.2)', () => {
  it('applies the shrinkage term: n=1 ×0.50, n=5 ×0.83, n=20 ×0.95', () => {
    expect(memoryConfidence(1, 1)).toBe(0.5);
    expect(memoryConfidence(5, 5)).toBeCloseTo(0.8333, 4);
    expect(memoryConfidence(20, 20)).toBeCloseTo(0.9524, 4);
  });

  it('is p × shrinkage', () => {
    // p = 3/4, shrinkage = 4/5 → 0.6
    expect(memoryConfidence(3, 4)).toBeCloseTo(0.6, 10);
    expect(memoryConfidence(0, 0)).toBe(0);
  });
});

describe('bands (SPEC §4.5)', () => {
  it('splits at 0.90 and 0.60, inclusive', () => {
    expect(bandOf(0.9)).toBe('confident');
    expect(bandOf(0.8999)).toBe('guess');
    expect(bandOf(0.6)).toBe('guess');
    expect(bandOf(0.5999)).toBe('none');
  });
  it('exact rationals land on the right side of the line', () => {
    expect(bandOf(memoryConfidence(9, 9))).toBe('confident'); // 9/10
    expect(bandOf(memoryConfidence(3, 4))).toBe('guess'); // 3/5
  });
});

describe('rule matching (SPEC §4.1)', () => {
  it('contains / equals are case- and whitespace-insensitive', () => {
    expect(ruleMatches(rule({ matchType: 'contains', matchValue: 'quik' }), '', 'QuikTrip')).toBe(
      true,
    );
    expect(ruleMatches(rule({ matchValue: ' quiktrip ' }), '', 'QuikTrip')).toBe(true);
    expect(ruleMatches(rule({ matchValue: 'Quik' }), '', 'QuikTrip')).toBe(false);
  });
  it('matches the raw descriptor when asked', () => {
    const r = rule({ matchField: 'descriptor', matchType: 'contains', matchValue: 'tulsa' });
    expect(ruleMatches(r, 'QT 1234 TULSA OK', 'QuikTrip')).toBe(true);
    expect(ruleMatches(r, 'QT 1234 OKC OK', 'QuikTrip')).toBe(false);
  });
  it('regex is case-insensitive; a broken pattern never matches', () => {
    expect(ruleMatches(rule({ matchType: 'regex', matchValue: '^quik' }), '', 'QuikTrip')).toBe(
      true,
    );
    expect(ruleMatches(rule({ matchType: 'regex', matchValue: '(' }), '', 'QuikTrip')).toBe(false);
  });
  it('orders by priority, then age, then id', () => {
    const a = rule({ id: 'a', priority: 1, createdAt: '2026-09-02T00:00:00Z' });
    const b = rule({ id: 'b', priority: 1, createdAt: '2026-09-01T00:00:00Z' });
    const c = rule({ id: 'c', priority: 5 });
    const d = rule({ id: 'd', priority: 1, createdAt: '2026-09-01T00:00:00Z' });
    expect(orderRules([a, d, b, c]).map((r) => r.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(firstMatchingRule([a, c], '', 'Shell')).toBeNull();
  });
  it('validates patterns before they are saved', () => {
    expect(validateRule('equals', 'x')).toEqual({ ok: true });
    expect(validateRule('contains', '  ').ok).toBe(false);
    expect(validateRule('regex', '^QT\\b')).toEqual({ ok: true });
    expect(validateRule('regex', '(')).toMatchObject({ ok: false });
    expect(validateRule('regex', 'a'.repeat(201))).toMatchObject({ ok: false });
  });
});

describe('categorize precedence (SPEC §4)', () => {
  it('rules beat memory', () => {
    const s = categorize(
      input({
        rules: [rule({ categoryId: 'home' })],
        memory: [{ categoryId: 'gas', count: 20, lastUsedAt: null }],
      }),
    );
    expect(s).toMatchObject({
      categoryId: 'home',
      layer: 'rule',
      confidence: 1,
      band: 'confident',
      ruleId: 'r1',
    });
    expect(s.topCategoryIds).toEqual(['gas']);
  });

  it('memory below 0.60 returns no pre-fill but offers the top categories', () => {
    const s = categorize(input({ memory: [{ categoryId: 'gas', count: 1, lastUsedAt: null }] }));
    expect(s).toMatchObject({ categoryId: null, layer: 'memory', confidence: 0.5, band: 'none' });
    expect(s.topCategoryIds).toEqual(['gas']);
  });

  it('memory in the guess band pre-fills, flagged', () => {
    const s = categorize(input({ memory: [{ categoryId: 'gas', count: 2, lastUsedAt: null }] }));
    expect(s).toMatchObject({ categoryId: 'gas', band: 'guess' });
  });

  it('memory beats recurring; recurring beats seeds', () => {
    expect(
      categorize(
        input({
          memory: [{ categoryId: 'home', count: 4, lastUsedAt: null }],
          recurringCategoryId: 'gas',
        }),
      ),
    ).toMatchObject({ categoryId: 'home', layer: 'memory' });
    expect(categorize(input({ recurringCategoryId: 'home' }))).toMatchObject({
      categoryId: 'home',
      layer: 'recurring',
      confidence: 0.95,
      band: 'confident',
    });
  });

  it('a keyword seed never pre-fills; it becomes the one-tap button', () => {
    expect(categorize(input())).toMatchObject({
      categoryId: null,
      layer: 'seed',
      confidence: 0.5,
      band: 'none',
      topCategoryIds: ['gas'],
    });
  });

  it('nothing matches: no suggestion', () => {
    expect(categorize(input({ merchant: 'ACME WIDGETS', descriptor: 'ACME WIDGETS' }))).toEqual({
      categoryId: null,
      confidence: 0,
      layer: null,
      band: 'none',
      ruleId: null,
      topCategoryIds: [],
    });
  });

  it('ignores rules, memory and series that point at categories the user no longer has', () => {
    const s = categorize(
      input({
        merchant: 'ACME',
        rules: [rule({ matchValue: 'ACME', categoryId: 'gone' })],
        memory: [{ categoryId: 'gone', count: 9, lastUsedAt: null }],
        recurringCategoryId: 'gone',
      }),
    );
    expect(s.layer).toBeNull();
  });

  it('Amazon Marketplace is never guessed: top categories only, rules still apply', () => {
    const memory = [
      { categoryId: 'home', count: 12, lastUsedAt: '2026-09-01T00:00:00Z' },
      { categoryId: 'kids', count: 12, lastUsedAt: '2026-09-10T00:00:00Z' },
      { categoryId: 'groc', count: 3, lastUsedAt: null },
      { categoryId: 'gas', count: 1, lastUsedAt: null },
    ];
    const s = categorize(
      input({ merchant: 'Amazon Marketplace', descriptor: 'AMZN Mktp US*2K1AB', memory }),
    );
    expect(s).toMatchObject({ categoryId: null, band: 'none', layer: null });
    expect(s.topCategoryIds).toEqual(['kids', 'home', 'groc']);
    const withRule = categorize(
      input({
        merchant: 'Amazon Marketplace',
        memory,
        rules: [rule({ matchValue: 'Amazon Marketplace', categoryId: 'home' })],
      }),
    );
    expect(withRule.categoryId).toBe('home');
  });
});

describe('merchant memory ranking', () => {
  it('orders by count, then recency, then id; drops zero counts', () => {
    expect(
      rankMemory([
        { categoryId: 'b', count: 2, lastUsedAt: null },
        { categoryId: 'a', count: 2, lastUsedAt: null },
        { categoryId: 'z', count: 0, lastUsedAt: '2026-09-01T00:00:00Z' },
        { categoryId: 'c', count: 2, lastUsedAt: '2026-01-01T00:00:00Z' },
      ]).map((m) => m.categoryId),
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('keyword seeds (SPEC §4.4)', () => {
  it('resolve against the user’s own category names', () => {
    expect(resolveSeed('Shell', cats)).toBe('gas');
    expect(resolveSeed('Kroger', cats)).toBe('groc');
    expect(resolveSeed('Starbucks', cats)).toBeNull(); // no dining category yet
    expect(resolveSeed('Starbucks', [...cats, { id: 'eat', name: ' eating out ' }])).toBe('eat');
  });
  it('fall through to later candidate names', () => {
    expect(resolveSeed('Netflix', [{ id: 'fun', name: 'Entertainment' }])).toBe('fun');
  });
});
