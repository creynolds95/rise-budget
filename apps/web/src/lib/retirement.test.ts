import { describe, expect, it } from 'vitest';
import { claimants, DEFAULT_PLAN, fanView, retirementView, totalMonthly } from './retirement';

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

  it('an age with no years left shows no monthly gap instead of the whole target per month', () => {
    const v = retirementView(plan, 1_000_000, 50_000, 30);
    expect(v.neededCents).toBe(171_428_571);
    expect(v.gapMonthlyCents).toBeNull();
    // Already there with no years left: on track.
    expect(retirementView(plan, 200_000_000, 0, 30).gapMonthlyCents).toBe(0);
  });

  it('an age at or before today projects no growth', () => {
    const v = retirementView(plan, 1_000_000, 50_000, 28);
    expect(v.balanceCents).toBe(1_000_000);
    expect(v.series).toEqual([{ age: 30, balanceCents: 1_000_000 }]);
  });
});

describe('fan view', () => {
  it('bands start at today and run to the chosen age', () => {
    const f = fanView(plan, 10_000_000, 100_000, 65);
    expect(f[0]).toMatchObject({ age: 30, p10: 10_000_000, p90: 10_000_000 });
    expect(f[f.length - 1]?.age).toBe(65);
  });

  it('a retirement age before today gives a single point', () => {
    expect(fanView(plan, 1_000, 0, 20)).toHaveLength(1);
  });
});

describe('Social Security and life events', () => {
  it('lowers what the portfolio must cover, and sets aside the years before claiming', () => {
    const p = { ...plan, ssBenefitCents: 200_000, ssClaimAge: 67 };
    const plain = retirementView(plan, 10_000_000, 100_000, 65);
    const v = retirementView(p, 10_000_000, 100_000, 65);
    expect(v.ssMonthlyCents).toBe(200_000);
    expect(v.setAsideCents).toBe(2 * 12 * 200_000);
    // $3,000 a month from savings plus two years of checks held back.
    expect(v.neededCents).toBe(102_857_143 + 4_800_000);
    expect(v.incomeCents).toBe(
      Math.round(((v.balanceCents - 4_800_000) * 350) / 10_000 / 12) + 200_000,
    );
    expect(v.balanceCents).toBe(plain.balanceCents);
  });

  it('counts a spouse, starting when they reach their own claim age', () => {
    const p = {
      ...plan,
      ssBenefitCents: 200_000,
      spouse: { age: 28, ssBenefitCents: 0, ssClaimAge: 67 },
    };
    expect(claimants(p)).toEqual([
      { fraCents: 200_000, claimAge: 67, startsAtOwnerAge: 67 },
      { fraCents: 0, claimAge: 67, startsAtOwnerAge: 69 },
    ]);
    expect(retirementView(p, 0, 0, 70).ssMonthlyCents).toBe(300_000);
    expect(claimants(plan)).toEqual([]);
  });

  it('moves the projection for events before retiring and the need for events after', () => {
    const p = {
      ...plan,
      lifeEvents: [
        { label: 'Inheritance', age: 40, cents: 5_000_000 },
        { label: 'Roof', age: 70, cents: -2_000_000 },
      ],
    };
    const plain = retirementView(plan, 10_000_000, 100_000, 65);
    const v = retirementView(p, 10_000_000, 100_000, 65);
    expect(v.balanceCents).toBeGreaterThan(plain.balanceCents + 5_000_000);
    expect(v.neededCents).toBe((plain.neededCents ?? 0) + 2_000_000);
    expect(fanView(p, 10_000_000, 100_000, 65)).toHaveLength(36);
  });
});
