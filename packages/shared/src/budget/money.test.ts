import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocateByWeights, assertCents, isCents, MoneyError, mulDiv, sumCents } from './money';

describe('cents guards', () => {
  it('accepts safe integers only', () => {
    expect(isCents(125)).toBe(true);
    expect(isCents(-1)).toBe(true);
    expect(isCents(1.5)).toBe(false);
    expect(isCents(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isCents('1')).toBe(false);
    expect(assertCents(7)).toBe(7);
    expect(() => assertCents(0.1 + 0.2, 'x')).toThrow(MoneyError);
  });

  it('sums integers and rejects floats', () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([100, -25, 3])).toBe(78);
    expect(() => sumCents([1, 2.5])).toThrow(MoneyError);
  });
});

describe('mulDiv', () => {
  it('rounds half away from zero', () => {
    expect(mulDiv(100, 1, 3)).toBe(33);
    expect(mulDiv(200, 1, 3)).toBe(67);
    expect(mulDiv(5, 1, 2)).toBe(3);
    expect(mulDiv(-5, 1, 2)).toBe(-3);
    expect(mulDiv(5, -1, 2)).toBe(-3);
    expect(mulDiv(5, 1, -2)).toBe(-3);
    expect(mulDiv(-5, 1, -2)).toBe(3);
    expect(mulDiv(30_000, 15, 30)).toBe(15_000);
  });

  it('rejects non-integer or zero denominators', () => {
    expect(() => mulDiv(1, 1, 0)).toThrow(MoneyError);
    expect(() => mulDiv(1, 0.5, 2)).toThrow(MoneyError);
    expect(() => mulDiv(1, 1, 1.5)).toThrow(MoneyError);
  });
});

describe('allocateByWeights', () => {
  it('distributes remainders deterministically', () => {
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByWeights(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocateByWeights(10, [0, 1])).toEqual([0, 10]);
    expect(allocateByWeights(1, [1, 3])).toEqual([0, 1]);
  });

  it('rejects bad weights', () => {
    expect(() => allocateByWeights(100, [])).toThrow(MoneyError);
    expect(() => allocateByWeights(100, [-1, 2])).toThrow(MoneyError);
    expect(() => allocateByWeights(100, [0.5])).toThrow(MoneyError);
    expect(() => allocateByWeights(100, [0, 0])).toThrow(MoneyError);
  });

  it('never loses a penny across 10k random splits (T5 property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const parts = allocateByWeights(total, weights);
          expect(parts).toHaveLength(weights.length);
          expect(parts.every(Number.isSafeInteger)).toBe(true);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        },
      ),
      { numRuns: 10_000 },
    );
  });
});
