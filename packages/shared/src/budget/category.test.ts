import { describe, expect, it } from 'vitest';
import { categoryMath, spentFrom } from './category';
import { categoryDefaults } from './defaults';
import { remainderForLastSplit, validateSplits } from './splits';

const line = (
  amountCents: number,
  o: Partial<{ isTransfer: boolean; isDropped: boolean }> = {},
) => ({
  amountCents,
  isTransfer: false,
  isDropped: false,
  ...o,
});

describe('spent', () => {
  it('sums splits, excluding transfers and dropped pendings', () => {
    expect(
      spentFrom([
        line(5000),
        line(-1200),
        line(9999, { isTransfer: true }),
        line(700, { isDropped: true }),
      ]),
    ).toBe(3800);
    expect(spentFrom([])).toBe(0);
  });
});

describe('categoryMath', () => {
  it('available = carried + planned; remaining = available − spent', () => {
    expect(categoryMath({ carriedInCents: -4000, plannedCents: 30000, spentCents: 18200 })).toEqual(
      {
        availableCents: 26000,
        spentCents: 18200,
        remainingCents: 7800,
      },
    );
  });
});

describe('category defaults', () => {
  it('bills return to pool and are fixed; discretionary rolls and is linear', () => {
    expect(categoryDefaults({ isBill: true })).toEqual({
      rolloverPolicy: 'return_to_pool',
      spendShape: 'fixed',
    });
    expect(categoryDefaults({ isBill: false })).toEqual({
      rolloverPolicy: 'roll',
      spendShape: 'linear',
    });
  });
  it('explicit choices win', () => {
    expect(
      categoryDefaults({ isBill: true, rolloverPolicy: 'roll', spendShape: 'linear' }),
    ).toEqual({
      rolloverPolicy: 'roll',
      spendShape: 'linear',
    });
  });
});

describe('splits', () => {
  it('accepts an exact sum and computes the remainder row', () => {
    expect(
      validateSplits(4599, [
        { categoryId: 'a', amountCents: 2000 },
        { categoryId: 'b', amountCents: 2599 },
      ]),
    ).toEqual({ ok: true });
    expect(remainderForLastSplit(4599, [2000, 1500])).toBe(1099);
  });
  it('rejects an empty split set', () => {
    expect(validateSplits(100, [])).toEqual({ ok: false, code: 'NO_SPLITS' });
  });
});
