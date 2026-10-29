import { describe, expect, it } from 'vitest';
import { spreadMonthsOf, spreadParts } from './spread';

describe('spreadParts', () => {
  it('splits evenly and puts the odd cents on the first month', () => {
    const parts = spreadParts(10_000, 3, '2026-11', 'c1');
    expect(parts).toEqual([
      { categoryId: 'c1', amountCents: 3_334, periodId: '2026-11' },
      { categoryId: 'c1', amountCents: 3_333, periodId: '2026-12' },
      { categoryId: 'c1', amountCents: 3_333, periodId: '2027-01' },
    ]);
  });

  it('always sums to the total, refunds included', () => {
    for (const total of [1, 99, -1_001, 120_000]) {
      for (const months of [1, 5, 12]) {
        const sum = spreadParts(total, months, '2026-10', 'c').reduce(
          (n, p) => n + p.amountCents,
          0,
        );
        expect(sum).toBe(total);
      }
    }
  });

  it('refuses a month count outside 1..12 or fractional cents', () => {
    expect(() => spreadParts(100, 0, '2026-10', 'c')).toThrow(RangeError);
    expect(() => spreadParts(100, 13, '2026-10', 'c')).toThrow(RangeError);
    expect(() => spreadParts(100, 2.5, '2026-10', 'c')).toThrow(RangeError);
    expect(() => spreadParts(1.5, 2, '2026-10', 'c')).toThrow();
  });
});

describe('spreadMonthsOf', () => {
  const s = (categoryId: string, periodId: string) => ({ categoryId, periodId });

  it('counts consecutive months of one category from the transaction month', () => {
    expect(spreadMonthsOf('2026-12', [s('a', '2027-01'), s('a', '2026-12')])).toBe(2);
  });

  it('is 1 for a single split, a category split, or a gap', () => {
    expect(spreadMonthsOf('2026-10', [s('a', '2026-10')])).toBe(1);
    expect(spreadMonthsOf('2026-10', [s('a', '2026-10'), s('b', '2026-10')])).toBe(1);
    expect(spreadMonthsOf('2026-10', [s('a', '2026-10'), s('b', '2026-11')])).toBe(1);
    expect(spreadMonthsOf('2026-10', [s('a', '2026-10'), s('a', '2026-12')])).toBe(1);
  });
});
