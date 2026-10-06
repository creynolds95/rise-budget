import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN, monteCarloView, retirementView, totalMonthly } from './retirement';

const plan = { ...DEFAULT_PLAN, currentAge: 30, goalAge: 65, spendTargetCents: 500_000 };

describe('retirement view', () => {
  it('sums only contributions to listed accounts', () => {
    const p = {
      ...plan,
      contributions: [
        { accountId: 'a', monthlyCents: 100_000 },
        { accountId: 'b', monthlyCents: 50_000 },
        { accountId: 'gone', monthlyCents: 999 },
      ],
    };
    expect(totalMonthly(p, ['a', 'b'])).toBe(150_000);
  });

  it('projects balance, income and the gap to the goal', () => {
    const v = retirementView(plan, 10_000_000, 100_000, 65);
    expect(v.neededCents).toBe(171_428_571); // $5,000 × 12 ÷ 3.5%
    expect(v.incomeCents).toBe(Math.round((v.balanceCents * 350) / 10_000 / 12));
    expect(v.pctOfGoal).toBe(Math.round((v.incomeCents * 100) / 500_000));
    expect(v.gapMonthlyCents).toBeGreaterThanOrEqual(0);
    expect(v.series[0]).toEqual({ age: 30, balanceCents: 10_000_000 });
    expect(v.series.at(-1)).toEqual({ age: 65, balanceCents: v.balanceCents });
  });

  it('contributing the gap reaches the goal', () => {
    const v = retirementView(plan, 10_000_000, 100_000, 65);
    const lifted = retirementView(plan, 10_000_000, 100_000 + (v.gapMonthlyCents ?? 0), 65);
    expect(lifted.gapMonthlyCents).toBe(0);
    expect(lifted.balanceCents).toBeGreaterThanOrEqual(v.neededCents ?? 0);
  });

  it('has no goal-relative figures until a target is set', () => {
    const v = retirementView({ ...plan, spendTargetCents: 0 }, 1_000_000, 0, 65);
    expect(v.neededCents).toBeNull();
    expect(v.pctOfGoal).toBeNull();
    expect(v.gapMonthlyCents).toBeNull();
  });

  it('an age at or before today projects no growth', () => {
    const v = retirementView(plan, 1_000_000, 50_000, 28);
    expect(v.balanceCents).toBe(1_000_000);
    expect(v.series).toEqual([{ age: 30, balanceCents: 1_000_000 }]);
  });
});

describe('monte carlo view', () => {
  it('spans now to the horizon with ages and a retirement marker', () => {
    const v = monteCarloView({ ...plan, horizonAge: 90 }, 10_000_000, 100_000, 65);
    expect(v.series[0]).toMatchObject({ age: 30, year: 0 });
    expect(v.series.at(-1)?.age).toBe(90);
    expect(v.retireIndex).toBe(35);
    expect(v.successPct).toBeGreaterThanOrEqual(0);
    expect(v.successPct).toBeLessThanOrEqual(100);
  });

  it('never ends before retirement even if the horizon is set earlier', () => {
    const v = monteCarloView({ ...plan, horizonAge: 60 }, 0, 0, 70);
    expect(v.series.at(-1)?.age).toBe(70);
  });
});
