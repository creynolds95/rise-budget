import { describe, expect, it } from 'vitest';
import {
  averageCents,
  buildMoneyFlow,
  cumulativeSpend,
  monthlySeries,
  sameDayTotal,
  type MoneyFlowCategoryInput,
} from './index';

describe('cumulativeSpend', () => {
  it('runs a total across every day of the month', () => {
    const run = cumulativeSpend('2026-02', [
      { date: '2026-02-03', cents: 1_000 },
      { date: '2026-02-01', cents: 250 },
      { date: '2026-02-03', cents: 50 },
    ]);
    expect(run).toHaveLength(28);
    expect(run.slice(0, 4)).toEqual([250, 250, 1_300, 1_300]);
    expect(run.at(-1)).toBe(1_300);
  });

  it('stops at throughDay so the future is not drawn flat', () => {
    expect(
      cumulativeSpend(
        '2026-09',
        [
          { date: '2026-09-02', cents: 5 },
          { date: '2026-09-05', cents: 7 },
        ],
        3,
      ),
    ).toEqual([0, 5, 5]);
    expect(cumulativeSpend('2026-09', [], 0)).toEqual([]);
    expect(cumulativeSpend('2026-09', [], 99)).toHaveLength(30);
  });

  it('ignores days from other months and keeps refunds as negatives', () => {
    const run = cumulativeSpend('2026-09', [
      { date: '2026-08-31', cents: 9_999 },
      { date: '2026-09-01', cents: 2_000 },
      { date: '2026-09-02', cents: -500 },
      { date: '2026-10-01', cents: 9_999 },
    ]);
    expect(run.slice(0, 2)).toEqual([2_000, 1_500]);
    expect(run.at(-1)).toBe(1_500);
  });
});

describe('sameDayTotal', () => {
  const aug = cumulativeSpend('2026-08', [
    { date: '2026-08-10', cents: 100 },
    { date: '2026-08-31', cents: 900 },
  ]);
  it('reads the running total on the same day of the month', () => {
    expect(sameDayTotal(aug, 9)).toBe(0);
    expect(sameDayTotal(aug, 10)).toBe(100);
  });
  it('clamps to the last day when the earlier month was shorter', () => {
    const feb = cumulativeSpend('2026-02', [{ date: '2026-02-28', cents: 7 }]);
    expect(sameDayTotal(feb, 31)).toBe(7);
  });
  it('is zero before day one or with nothing recorded', () => {
    expect(sameDayTotal(aug, 0)).toBe(0);
    expect(sameDayTotal([], 12)).toBe(0);
  });
});

describe('monthlySeries', () => {
  it('fills months with no spending as zero, oldest first', () => {
    expect(
      monthlySeries('2026-07', '2026-10', [
        { periodId: '2026-10', cents: 40 },
        { periodId: '2026-08', cents: 20 },
        { periodId: '2026-06', cents: 99 },
      ]),
    ).toEqual([
      { periodId: '2026-07', cents: 0 },
      { periodId: '2026-08', cents: 20 },
      { periodId: '2026-09', cents: 0 },
      { periodId: '2026-10', cents: 40 },
    ]);
  });
  it('crosses a year boundary', () => {
    expect(monthlySeries('2025-12', '2026-01', []).map((m) => m.periodId)).toEqual([
      '2025-12',
      '2026-01',
    ]);
  });
  it('is empty when from is after to', () => {
    expect(monthlySeries('2026-10', '2026-09', [])).toEqual([]);
  });
});

describe('averageCents', () => {
  it('rounds half away from zero to whole cents', () => {
    expect(averageCents([100, 200])).toBe(150);
    expect(averageCents([1, 2])).toBe(2);
    expect(averageCents([1, 1, 2])).toBe(1);
  });
  it('is null with nothing to average', () => {
    expect(averageCents([])).toBeNull();
  });
});

describe('buildMoneyFlow', () => {
  const cat = (over: Partial<MoneyFlowCategoryInput>): MoneyFlowCategoryInput => ({
    categoryId: 'c1',
    categoryName: 'Category',
    groupId: 'g1',
    groupName: 'Group',
    groupKind: 'expense',
    spentCents: 0,
    ...over,
  });

  it('flows income through its group total into each category, with leftover', () => {
    const flow = buildMoneyFlow([
      cat({ categoryId: 'pay', categoryName: 'Paycheck', groupKind: 'income', spentCents: -1_000 }),
      cat({
        categoryId: 'gro',
        categoryName: 'Groceries',
        groupId: 'food',
        groupName: 'Food',
        spentCents: 300,
      }),
      cat({
        categoryId: 'res',
        categoryName: 'Restaurants',
        groupId: 'food',
        groupName: 'Food',
        spentCents: 200,
      }),
    ]);
    expect(flow.nodes.map((n) => n.id)).toEqual([
      'income',
      'cat:pay',
      'group:food',
      'cat:gro',
      'cat:res',
      'leftover',
    ]);
    expect(flow.links).toEqual([
      { source: 'income', target: 'group:food', valueCents: 500 },
      { source: 'cat:pay', target: 'income', valueCents: 1_000 },
      { source: 'group:food', target: 'cat:gro', valueCents: 300 },
      { source: 'group:food', target: 'cat:res', valueCents: 200 },
      { source: 'income', target: 'leftover', valueCents: 500 },
    ]);
  });

  it('skips an income category that earned nothing (a refund making it net-negative)', () => {
    const flow = buildMoneyFlow([cat({ groupKind: 'income', spentCents: 5 })]);
    expect(flow.nodes).toEqual([{ id: 'income', name: 'Income' }]);
    expect(flow.links).toEqual([]);
  });

  it('skips an expense category with nothing spent (a pure refund)', () => {
    const flow = buildMoneyFlow([cat({ spentCents: -50 })]);
    expect(flow.nodes).toEqual([{ id: 'income', name: 'Income' }]);
    expect(flow.links).toEqual([]);
  });

  it('has no leftover link when spending meets or exceeds income', () => {
    const flow = buildMoneyFlow([
      cat({ categoryId: 'pay', groupKind: 'income', spentCents: -100 }),
      cat({ categoryId: 'gro', spentCents: 150 }),
    ]);
    expect(flow.nodes.some((n) => n.id === 'leftover')).toBe(false);
  });
});
