import { describe, expect, it } from 'vitest';
import {
  applyForgiveness,
  computeCarryOut,
  computeMonthEnd,
  rollChain,
  type ChainCategory,
} from './rollover';
import { cat, chainCat, month } from './test-helpers';

describe('computeCarryOut', () => {
  it('a rollover category carries surplus and deficit', () => {
    expect(computeCarryOut('roll', 2500)).toBe(2500);
    expect(computeCarryOut('roll', -2500)).toBe(-2500);
  });
  it('any other category carries nothing', () => {
    expect(computeCarryOut('return_to_pool', 2500)).toBe(0);
    expect(computeCarryOut('return_to_pool', -2500)).toBe(0);
  });
});

describe('computeMonthEnd', () => {
  it('carries rollover categories only', () => {
    expect(
      computeMonthEnd([
        cat({ categoryId: 'groceries', plannedCents: 60000, spentCents: 55000 }),
        cat({
          categoryId: 'rent',
          rolloverPolicy: 'return_to_pool',
          plannedCents: 150000,
          spentCents: 145000,
        }),
      ]),
    ).toEqual([
      { categoryId: 'groceries', carriedInCents: 5000 },
      { categoryId: 'rent', carriedInCents: 0 },
    ]);
  });
});

describe('rollChain', () => {
  const months = [
    month({
      periodId: '2026-10',
      categories: [chainCat({ categoryId: 'eat', plannedCents: 30000, spentCents: 20000 })],
    }),
    month({
      periodId: '2026-11',
      categories: [chainCat({ categoryId: 'eat', plannedCents: 30000, spentCents: 50700 })],
    }),
    month({
      periodId: '2026-12',
      categories: [chainCat({ categoryId: 'eat', adjustCents: 10000 })],
    }),
  ];

  it('gives every month its carry-in, adjustments included', () => {
    expect(rollChain(months)).toEqual([
      { periodId: '2026-10', carriedIn: new Map([['eat', 0]]) },
      { periodId: '2026-11', carriedIn: new Map([['eat', 10000]]) },
      // 10000 + 30000 − 50700 = −10700, of which 10000 is forgiven in December.
      { periodId: '2026-12', carriedIn: new Map([['eat', -700]]) },
    ]);
  });

  it('a month that has not ended carries nothing forward', () => {
    // Viewing from November: October has ended and rolls; November is still running, so
    // December starts with October's carry (10000), not November's. December's adjustment
    // has no deficit to lift there, so it adds nothing.
    expect(rollChain(months, '2026-11')).toEqual([
      { periodId: '2026-10', carriedIn: new Map([['eat', 0]]) },
      { periodId: '2026-11', carriedIn: new Map([['eat', 10000]]) },
      { periodId: '2026-12', carriedIn: new Map([['eat', 10000]]) },
    ]);
    // Still in October: nothing has ended, so later months carry nothing.
    expect(rollChain(months, '2026-10').map((r) => r.carriedIn.get('eat'))).toEqual([0, 0, 0]);
  });

  // A forgiveness only ever brings a deficit up to zero. It must not turn into money later,
  // when the deficit it forgave shrinks (a recategorisation) or the category stops rolling.
  const forgiven = (oct: Partial<ChainCategory>) =>
    rollChain([
      month({
        periodId: '2026-10',
        categories: [chainCat({ categoryId: 'eat', spentCents: 10000, ...oct })],
      }),
      month({
        periodId: '2026-11',
        categories: [chainCat({ categoryId: 'eat', adjustCents: 10000, ...oct, spentCents: 0 })],
      }),
    ])[1]?.carriedIn.get('eat');

  it('a forgiveness zeroes the deficit it was written for', () => {
    expect(forgiven({})).toBe(0);
  });
  it('a forgiveness larger than the deficit now is capped at zero', () => {
    // October's overspend recategorised from $100 down to $60: November is 0, not +$40.
    expect(forgiven({ spentCents: 6000 })).toBe(0);
  });
  it('a forgiveness is not money when there is no deficit', () => {
    expect(forgiven({ spentCents: 0, plannedCents: 2500 })).toBe(2500);
  });
  it('a forgiveness on a category that stopped rolling adds nothing', () => {
    expect(forgiven({ rolloverPolicy: 'return_to_pool' })).toBe(0);
  });
  it('a forgiveness smaller than a deficit that later grew leaves the rest', () => {
    expect(forgiven({ spentCents: 15000 })).toBe(-5000);
  });

  it('applyForgiveness lifts a deficit to zero at most', () => {
    expect(applyForgiveness(-10000, 10000)).toBe(0);
    expect(applyForgiveness(-6000, 10000)).toBe(0);
    expect(applyForgiveness(2500, 10000)).toBe(2500);
    expect(applyForgiveness(-15000, 10000)).toBe(-5000);
    expect(applyForgiveness(0, -4000)).toBe(-4000);
  });

  it('is empty for no months and rejects a gap', () => {
    expect(rollChain([])).toEqual([]);
    expect(() => rollChain(months.filter((_, i) => i !== 1))).toThrow(RangeError);
  });
});
