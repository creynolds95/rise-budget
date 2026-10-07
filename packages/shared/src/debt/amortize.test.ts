import { describe, expect, it } from 'vitest';
import { amortize, levelPayment, paidSoFar } from './amortize';
import { MAX_MONTHS } from './payoff';
// A level-payment schedule: [principal, interest, ending balance] per payment, cents.
import schedule from './fixtures-mortgage-schedule.json';

const mortgage = {
  balanceCents: 25_000_000,
  aprMilliPct: 6000,
  paymentCents: 150_800,
  extraMonthlyCents: 0,
  lumps: [],
};

describe('amortization', () => {
  it('matches the schedule to the cent, every one of 354 payments', () => {
    const a = amortize(mortgage);
    expect(a.rows).toHaveLength(354);
    expect(a.rows.map((r) => [r.principalCents, r.interestCents, r.balanceCents])).toEqual(
      schedule,
    );
    expect(a.payoffMonth).toBe(354);
    expect(a.totalInterestCents).toBe(28_382_907); // $283,829.07
    const last = a.rows.at(-1);
    expect(last?.principalToDateCents).toBe(25_000_000);
    expect(last?.interestToDateCents).toBe(28_382_907);
  });

  it('extra every month finishes sooner and costs less interest', () => {
    const a = amortize({ ...mortgage, extraMonthlyCents: 20_000 });
    expect(a.payoffMonth).toBeLessThan(354);
    expect(a.totalInterestCents).toBeLessThan(28_382_907);
    expect(a.rows[0]?.extraCents).toBe(20_000);
    expect(a.rows[0]?.principalCents).toBe(25_800 + 20_000);
  });

  it('a one-time payment lands in its month only; two in one month add up', () => {
    const a = amortize({
      ...mortgage,
      lumps: [
        { month: 2, cents: 500_000 },
        { month: 2, cents: 100_000 },
      ],
    });
    expect(a.rows[0]?.extraCents).toBe(0);
    expect(a.rows[1]?.extraCents).toBe(600_000);
    expect(a.rows[2]?.extraCents).toBe(0);
    expect(a.payoffMonth).toBeLessThan(354);
  });

  it('extra never pays more than is owed', () => {
    const a = amortize({
      balanceCents: 100_000,
      aprMilliPct: 0,
      paymentCents: 10_000,
      extraMonthlyCents: 0,
      lumps: [{ month: 1, cents: 1_000_000 }],
    });
    expect(a.rows).toEqual([
      {
        month: 1,
        interestCents: 0,
        principalCents: 100_000,
        extraCents: 90_000,
        balanceCents: 0,
        principalToDateCents: 100_000,
        interestToDateCents: 0,
      },
    ]);
    expect(a.payoffMonth).toBe(1);
  });

  it('nothing owed is already paid off', () => {
    const a = amortize({ ...mortgage, balanceCents: 0 });
    expect(a.rows).toEqual([]);
    expect(a.payoffMonth).toBe(0);
    expect(a.totalInterestCents).toBe(0);
  });

  it('a payment under the interest never pays off, and the gap is owed', () => {
    const a = amortize({ ...mortgage, paymentCents: 100_000 });
    expect(a.payoffMonth).toBeNull();
    expect(a.rows).toHaveLength(MAX_MONTHS);
    expect(a.rows[0]?.interestCents).toBe(100_000);
    expect(a.rows[0]?.principalCents).toBe(0);
    expect(a.rows[0]?.balanceCents).toBe(25_000_000 + 125_000 - 100_000);
  });
});

describe('paid so far', () => {
  it("walks back six payments to the schedule's principal year to date", () => {
    // Six payments in: principal paid so far, and the rest of the payments went to interest.
    expect(paidSoFar(25_000_000, 6000, 150_800, 6)).toEqual({
      principalCents: 152_127,
      interestCents: 6 * 150_800 - 152_127,
    });
  });

  it('no payments, nothing paid', () => {
    expect(paidSoFar(25_000_000, 6000, 150_800, 0)).toEqual({
      principalCents: 0,
      interestCents: 0,
    });
  });

  it('a payment under the interest paid nothing down', () => {
    expect(paidSoFar(1_000_000, 12_000, 5_000, 2)).toEqual({
      principalCents: 0,
      interestCents: 10_000,
    });
  });
});

describe('level payment', () => {
  it("354 payments left on the schedule's balance is the schedule's payment", () => {
    expect(levelPayment(25_000_000, 6000, 354)).toBe(150_800);
  });

  it('the payment it returns pays the loan off in that many months', () => {
    const p = levelPayment(25_000_000, 6000, 360);
    expect(p).toBe(149_888);
    const a = amortize({ ...mortgage, paymentCents: p });
    expect(a.payoffMonth).toBe(360);
  });

  it('no interest is the balance split evenly, rounded up', () => {
    expect(levelPayment(100_000, 0, 3)).toBe(33_334);
  });
});
