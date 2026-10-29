import { describe, expect, it } from 'vitest';
import { coveredMonths, emergencyTargetCents, goalProgress, shareAccountBalance } from './progress';

describe('goal progress', () => {
  it('percent and remaining come from what is saved against the target', () => {
    const p = goalProgress({ savedCents: 250_000, targetCents: 1_000_000, monthlyCents: 50_000 });
    expect(p).toEqual({ pct: 25, remainingCents: 750_000, monthsToGo: 15 });
  });

  it('months to go round up: a partial last month still takes a month', () => {
    const p = goalProgress({ savedCents: 0, targetCents: 100_000, monthlyCents: 30_000 });
    expect(p.monthsToGo).toBe(4);
  });

  it('percent floors, so 99.9% never reads as done', () => {
    const p = goalProgress({ savedCents: 99_999, targetCents: 100_000, monthlyCents: 1 });
    expect(p.pct).toBe(99);
  });

  it('a reached goal is 100% with nothing left, even when overshot', () => {
    const p = goalProgress({ savedCents: 120_000, targetCents: 100_000, monthlyCents: 0 });
    expect(p).toEqual({ pct: 100, remainingCents: 0, monthsToGo: 0 });
  });

  it('no monthly amount means no date, not an infinite one', () => {
    const p = goalProgress({ savedCents: 0, targetCents: 100_000, monthlyCents: 0 });
    expect(p.monthsToGo).toBeNull();
  });

  it('a negative balance counts as nothing saved', () => {
    const p = goalProgress({ savedCents: -5_000, targetCents: 100_000, monthlyCents: 10_000 });
    expect(p).toEqual({ pct: 0, remainingCents: 100_000, monthsToGo: 10 });
  });

  it('a zero target is already met', () => {
    const p = goalProgress({ savedCents: 0, targetCents: 0, monthlyCents: 0 });
    expect(p).toEqual({ pct: 100, remainingCents: 0, monthsToGo: 0 });
  });
});

describe('emergency fund', () => {
  it('the target is months times monthly expenses', () => {
    expect(emergencyTargetCents(6, 400_000)).toBe(2_400_000);
  });

  it('months covered floor to a tenth', () => {
    expect(coveredMonths(1_000_000, 400_000)).toBe(2.5);
    expect(coveredMonths(1_199_999, 400_000)).toBe(2.9);
  });

  it('no expense figure or a negative balance gives no coverage to speak of', () => {
    expect(coveredMonths(1_000_000, 0)).toBeNull();
    expect(coveredMonths(-100, 400_000)).toBe(0);
  });
});

describe('shareAccountBalance', () => {
  it('one goal with no share set counts the whole balance', () => {
    expect(shareAccountBalance(40_000, [null])).toEqual([40_000]);
  });

  it('goals with no share set split the balance evenly instead of each counting all of it', () => {
    // Was [40_000, 40_000]: $800 of progress out of a $400 account.
    expect(shareAccountBalance(40_000, [null, null])).toEqual([20_000, 20_000]);
    // An odd cent goes to the earlier goal.
    expect(shareAccountBalance(100, [null, null, null])).toEqual([34, 33, 33]);
  });

  it('set shares come out first, in order, never past what is there; the rest is split', () => {
    expect(shareAccountBalance(40_000, [25_000, null, null])).toEqual([25_000, 7_500, 7_500]);
    expect(shareAccountBalance(40_000, [30_000, 30_000, null])).toEqual([30_000, 10_000, 0]);
    expect(shareAccountBalance(40_000, [90_000])).toEqual([40_000]);
  });

  it('a negative balance or no goals is nothing to share', () => {
    expect(shareAccountBalance(-5_000, [null, 1_000])).toEqual([0, 0]);
    expect(shareAccountBalance(5_000, [])).toEqual([]);
  });
});
