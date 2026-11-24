import { describe, expect, it } from 'vitest';
import { classifyCategory, compareBudget, rateBp, splitRows, trailingRateBp } from './index';

// Every figure below is invented.
describe('classifyCategory', () => {
  it('keeps savings and retirement out of spending, and debt payments apart', () => {
    expect(classifyCategory('Savings')).toBe('savings');
    expect(classifyCategory('Emergency Fund')).toBe('savings');
    expect(classifyCategory('Roth IRA')).toBe('retirement');
    expect(classifyCategory('401k')).toBe('retirement');
    expect(classifyCategory('Mortgage')).toBe('debt');
    expect(classifyCategory('Student Loans')).toBe('debt');
    expect(classifyCategory('Groceries')).toBe('spending');
    expect(classifyCategory('Auto Insurance')).toBe('spending');
  });
  it('splits rows into the four', () => {
    expect(
      splitRows([
        { name: 'Groceries', cents: 100 },
        { name: 'Mortgage', cents: 200 },
        { name: 'Savings', cents: 30 },
        { name: 'IRA', cents: 4 },
        { name: 'Gym', cents: 5 },
      ]),
    ).toEqual({ spendingCents: 105, debtPaymentCents: 200, savingsCents: 30, retirementCents: 4 });
  });
});

describe('savings rate', () => {
  it('is a share of income in basis points, null without income', () => {
    expect(rateBp(184_000, 1_000_000)).toBe(1_840);
    expect(rateBp(5, 0)).toBeNull();
  });
  it('averages as total over total, so a thin month cannot swing it', () => {
    expect(
      trailingRateBp([
        { totalCents: 100_000, incomeCents: 1_000_000 },
        { totalCents: 0, incomeCents: 10_000 },
      ]),
    ).toBe(990);
    expect(trailingRateBp([])).toBeNull();
  });
});

describe('compareBudget', () => {
  it('counts only categories with a plan, and names the ones well over it', () => {
    const b = compareBudget([
      { name: 'Groceries', plannedCents: 60_000, spentCents: 87_000 },
      { name: 'Dining', plannedCents: 20_000, spentCents: 11_000 },
      { name: 'Coffee', plannedCents: 5_000, spentCents: 5_900 },
      { name: 'Gifts', plannedCents: 0, spentCents: 9_000 },
    ]);
    expect(b).toEqual({
      plannedCents: 85_000,
      spentCents: 103_900,
      over: [{ name: 'Groceries', plannedCents: 60_000, spentCents: 87_000 }],
    });
  });
});
