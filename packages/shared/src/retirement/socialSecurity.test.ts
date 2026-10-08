import { describe, expect, it } from 'vitest';
import { monthlyBenefit, socialSecurity, splitLifeEvents } from './socialSecurity';

describe('monthlyBenefit (SSA claiming rules)', () => {
  it('takes 30% off at 62, nothing at 67, and adds 24% at 70', () => {
    expect(monthlyBenefit(200_000, 0, 62, 100)).toBe(140_000);
    expect(monthlyBenefit(200_000, 0, 65, 100)).toBe(173_333); // 24 months × 5/9%
    expect(monthlyBenefit(200_000, 0, 64, 100)).toBe(160_000);
    expect(monthlyBenefit(200_000, 0, 67, 100)).toBe(200_000);
    expect(monthlyBenefit(200_000, 0, 70, 100)).toBe(248_000);
  });

  it('pays half the spouse’s full benefit when that is more, with no credit for waiting', () => {
    expect(monthlyBenefit(40_000, 300_000, 67, 100)).toBe(150_000);
    expect(monthlyBenefit(40_000, 300_000, 70, 100)).toBe(150_000);
    expect(monthlyBenefit(40_000, 300_000, 62, 100)).toBe(97_500); // 35% off the spousal half
  });

  it('applies a haircut to what is paid', () => {
    expect(monthlyBenefit(200_000, 0, 67, 80)).toBe(160_000);
  });
});

describe('socialSecurity', () => {
  it('adds the household’s checks and what the portfolio bridges until each claim', () => {
    const ss = socialSecurity(
      [
        { fraCents: 200_000, claimAge: 67, startsAtOwnerAge: 67 },
        { fraCents: 100_000, claimAge: 67, startsAtOwnerAge: 69 },
      ],
      65,
      100,
    );
    expect(ss.monthlyCents).toBe(300_000);
    expect(ss.bridgeCents).toBe(2 * 12 * 200_000 + 4 * 12 * 100_000);
    expect(socialSecurity([{ fraCents: 0, claimAge: 67, startsAtOwnerAge: 67 }], 70, 100)).toEqual({
      monthlyCents: 0,
      bridgeCents: 0,
    });
  });
});

describe('splitLifeEvents', () => {
  it('puts earlier events in the projection and later ones on what is needed', () => {
    const r = splitLifeEvents(
      [
        { age: 30, cents: 1_000 },
        { age: 32, cents: -5_000 },
        { age: 32, cents: 2_000 },
        { age: 35, cents: -40_000 },
        { age: 70, cents: 10_000 },
        { age: 20, cents: 99 },
      ],
      30,
      35,
    );
    expect(r.lumps).toEqual([1_000, 0, -3_000, 0, 0]);
    expect(r.afterCents).toBe(40_000 - 10_000);
  });
});
