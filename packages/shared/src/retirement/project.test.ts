import { describe, expect, it } from 'vitest';
import {
  monthlyIncomeFor,
  neededBalanceFor,
  projectBalance,
  projectSeries,
  requiredMonthlyContribution,
  monthlyGrowth,
  monthlyRateE12,
} from './project';
import { mulDiv } from '../budget/money';

describe('retirement projection (integer cents, real dollars)', () => {
  it('with no growth, balance is the start plus contributions', () => {
    expect(projectBalance(1_000_000, 50_000, 10, 0)).toBe(1_000_000 + 50_000 * 120);
  });

  it('4% real growth is 4% a year, compounded monthly at the equivalent monthly rate', () => {
    // Not 4.074%: the monthly rate is (1.04)^(1/12) − 1, not 4% ÷ 12.
    expect(Math.abs(projectBalance(10_000_000, 0, 1, 400) - 10_400_000)).toBeLessThanOrEqual(1);
    // $100,000 for 10 years at 4%/yr = $148,024.43 (was ~$149,083 with 4% ÷ 12).
    expect(Math.abs(projectBalance(10_000_000, 0, 10, 400) - 14_802_443)).toBeLessThanOrEqual(5);
  });

  it('the monthly factor is exact for a 0% and a 10% year', () => {
    expect(monthlyRateE12(0)).toBe(0);
    // 1.1^(1/12) − 1 = 0.00797414042…
    expect(monthlyRateE12(1000)).toBe(7_974_140_429);
    expect(Math.abs(projectBalance(100_000_000, 0, 1, 1000) - 110_000_000)).toBeLessThanOrEqual(1);
  });

  it('monthly growth is exactly balance × rate ÷ 1e12, rounded half away from zero', () => {
    const rates = [0, monthlyRateE12(400), monthlyRateE12(1000), 999_999_999_999];
    const balances = [0, 1, 99_999, 100_000, 123_456_789, 98_765_432_101, -5_000_000, 2 ** 52];
    for (const r of rates) {
      for (const b of balances) expect(monthlyGrowth(b, r)).toBe(mulDiv(b, r, 1e12));
    }
    // Ties: half a cent rounds away from zero.
    expect(monthlyGrowth(1, 500_000_000_000)).toBe(1);
    expect(monthlyGrowth(-1, 500_000_000_000)).toBe(-1);
    expect(monthlyGrowth(1, 499_999_999_999)).toBe(0);
  });

  it('contributions land at month end and also grow', () => {
    const b = projectBalance(0, 100_000, 1, 1200); // 12%/yr ≈ 0.9489%/mo
    // 12 month-end deposits of $1,000: 1,000 × (1.12 − 1) ÷ 0.0094888 = $12,646.50
    expect(Math.abs(b - 1_264_650)).toBeLessThanOrEqual(2);
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
    const c = requiredMonthlyContribution(5_000_000, target, 30, 400) as number;
    expect(projectBalance(5_000_000, c, 30, 400)).toBeGreaterThanOrEqual(target);
    expect(projectBalance(5_000_000, c - 1, 30, 400)).toBeLessThan(target);
  });

  it('with no years left there is no monthly contribution that gets there', () => {
    // Was the bisection's upper bound: the whole target "per month".
    expect(requiredMonthlyContribution(0, 100_000, 0, 400)).toBeNull();
    expect(requiredMonthlyContribution(100_000, 100_000, 0, 400)).toBe(0);
  });
});
