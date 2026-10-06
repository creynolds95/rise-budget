import { describe, expect, it } from 'vitest';
import { computeCarryOut, computeMonthEnd, rollChain } from './rollover';
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
      categories: [
        chainCat({ categoryId: 'eat', plannedCents: 30000, spentCents: 20000, adjustCents: 700 }),
      ],
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
      { periodId: '2026-10', carriedIn: new Map([['eat', 700]]) },
      { periodId: '2026-11', carriedIn: new Map([['eat', 10700]]) },
      // 10700 + 30000 − 50700 = −10000, forgiven by +10000 in December.
      { periodId: '2026-12', carriedIn: new Map([['eat', 0]]) },
    ]);
  });

  it('a month that has not ended carries nothing forward', () => {
    // Viewing from November: October has ended and rolls; November is still running, so
    // December starts with October's carry (10700) plus its own adjustment, not November's.
    expect(rollChain(months, '2026-11')).toEqual([
      { periodId: '2026-10', carriedIn: new Map([['eat', 700]]) },
      { periodId: '2026-11', carriedIn: new Map([['eat', 10700]]) },
      { periodId: '2026-12', carriedIn: new Map([['eat', 20700]]) },
    ]);
    // Still in October: nothing has ended, so later months carry only their adjustments.
    expect(rollChain(months, '2026-10').map((r) => r.carriedIn.get('eat'))).toEqual([
      700, 0, 10000,
    ]);
  });

  it('is empty for no months and rejects a gap', () => {
    expect(rollChain([])).toEqual([]);
    expect(() => rollChain(months.filter((_, i) => i !== 1))).toThrow(RangeError);
  });
});
