import { describe, expect, it } from 'vitest';
import {
  monthlyIncomeFor,
  neededBalanceFor,
  projectBalance,
  projectSeries,
  requiredMonthlyContribution,
} from './project';

describe('retirement projection (integer cents, real dollars)', () => {
  it('with no growth, balance is the start plus contributions', () => {
    expect(projectBalance(1_000_000, 50_000, 10, 0)).toBe(1_000_000 + 50_000 * 120);
  });

  it('with no contributions, 4% real growth compounds monthly', () => {
    // $100,000 for 10 years at 4%/yr compounded monthly = ~$149,083
    const b = projectBalance(10_000_000, 0, 10, 400);
    expect(b).toBeGreaterThan(14_900_000);
    expect(b).toBeLessThan(14_920_000);
  });

  it('contributions land at month end and also grow', () => {
    const b = projectBalance(0, 100_000, 1, 1200); // 1%/mo
    // 12 month-end deposits of $1,000 at 1%/mo = $12,682.50
    expect(b).toBeGreaterThan(1_268_000);
    expect(b).toBeLessThan(1_269_000);
  });

  it('zero years returns the start balance', () => {
    expect(projectBalance(777, 500, 0, 400)).toBe(777);
  });

  it('is always a whole number of cents', () => {
    expect(Number.isInteger(projectBalance(123_457, 7_919, 33, 400))).toBe(true);
  });

  it('monthly income is balance × withdrawal rate ÷ 12', () => {
    expect(monthlyIncomeFor(120_000_000, 350)).toBe(350_000); // $1.2M → $3,500/mo
    expect(monthlyIncomeFor(0, 350)).toBe(0);
  });

  it('needed balance inverts monthly income', () => {
    expect(neededBalanceFor(350_000, 350)).toBe(120_000_000);
  });

  it('series has one point per year, starting at year 0', () => {
    const s = projectSeries(1_000_000, 10_000, 3, 400);
    expect(s.map((p) => p.year)).toEqual([0, 1, 2, 3]);
    expect(s[0]?.balanceCents).toBe(1_000_000);
    expect(s[3]?.balanceCents).toBe(projectBalance(1_000_000, 10_000, 3, 400));
  });

  it('required contribution is 0 when the start already reaches the target', () => {
    expect(requiredMonthlyContribution(5_000_000, 1_000_000, 20, 400)).toBe(0);
  });

  it('required contribution reaches the target, and one cent less does not', () => {
    const target = 50_000_000;
    const c = requiredMonthlyContribution(5_000_000, target, 30, 400);
    expect(projectBalance(5_000_000, c, 30, 400)).toBeGreaterThanOrEqual(target);
    expect(projectBalance(5_000_000, c - 1, 30, 400)).toBeLessThan(target);
  });

  it('required contribution with no years left is the whole shortfall in one go', () => {
    expect(requiredMonthlyContribution(0, 100_000, 0, 400)).toBe(100_000);
  });
});
