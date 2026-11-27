import { describe, expect, it } from 'vitest';
import type { ViewCategory } from '@rise/shared/budget';
import { overBudgetItems } from './overBudget';

const row = (id: string, plannedCents: number, spentCents: number, extra = {}): ViewCategory =>
  ({
    categoryId: id,
    groupKind: 'expense',
    plannedCents,
    carriedInCents: 0,
    availableCents: plannedCents,
    spentCents,
    ...extra,
  }) as ViewCategory;

describe('overBudgetItems', () => {
  const all = () => true;

  it('lists only categories past what is available, worst first', () => {
    const out = overBudgetItems(
      [row('a', 10_000, 5_000), row('b', 10_000, 15_000), row('c', 10_000, 30_000)],
      all,
    );
    expect(out.map((o) => o.categoryId)).toEqual(['c', 'b']);
    expect(out.map((o) => o.remainingCents)).toEqual([-20_000, -5_000]);
  });

  it('counts a fixed category once its bill pushes it over', () => {
    const out = overBudgetItems([row('rent', 100_000, 110_000, { spendShape: 'fixed' })], all);
    expect(out).toEqual([{ categoryId: 'rent', remainingCents: -10_000 }]);
  });

  it('counts carry as available', () => {
    const r = row('a', 10_000, 15_000, { carriedInCents: 6_000, availableCents: 16_000 });
    expect(overBudgetItems([r], all)).toEqual([]);
  });

  it('skips income, unbudgeted categories and exactly-on-budget', () => {
    const out = overBudgetItems(
      [
        row('inc', 10_000, -20_000, { groupKind: 'income' }),
        row('xfer', 0, 5_000),
        row('even', 10_000, 10_000),
      ],
      (id) => id !== 'xfer',
    );
    expect(out).toEqual([]);
  });
});
