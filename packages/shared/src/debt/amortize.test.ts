import { describe, expect, it } from 'vitest';
import { amortize, paidSoFar } from './amortize';
import { MAX_MONTHS } from './payoff';
// The servicer's schedule from 11/2026: [principal, interest, ending balance] per payment, cents.
import statement from './fixtures-mortgage-pdf.json';

const mortgage = {
  balanceCents: 33_064_962,
  aprMilliPct: 5875,
  paymentCents: 196_811,
  extraMonthlyCents: 0,
  lumps: [],
};

describe('amortization', () => {
  it("matches the servicer's schedule to the cent, every one of 354 payments", () => {
    const a = amortize(mortgage);
    expect(a.rows).toHaveLength(354);
    expect(a.rows.map((r) => [r.principalCents, r.interestCents, r.balanceCents])).toEqual(
      statement,
    );
    expect(a.payoffMonth).toBe(354);
    expect(a.totalInterestCents).toBe(36_605_669); // $366,056.69
    const last = a.rows.at(-1);
    expect(last?.principalToDateCents).toBe(33_064_962);
    expect(last?.interestToDateCents).toBe(36_605_669);
  });

  it('extra every month finishes sooner and costs less interest', () => {
    const a = amortize({ ...mortgage, extraMonthlyCents: 20_000 });
    expect(a.payoffMonth).toBeLessThan(354);
    expect(a.totalInterestCents).toBeLessThan(36_605_669);
    expect(a.rows[0]?.extraCents).toBe(20_000);
    expect(a.rows[0]?.principalCents).toBe(34_930 + 20_000);
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
    expect(a.rows[0]?.balanceCents).toBe(33_064_962 + 161_881 - 100_000);
  });
});

describe('paid so far', () => {
  it("walks back six payments to the statement's principal year to date", () => {
    // The servicer shows $2,060.38 principal this year; its interest adds the closing's odd days.
    expect(paidSoFar(33_064_962, 5875, 196_811, 6)).toEqual({
      principalCents: 206_038,
      interestCents: 6 * 196_811 - 206_038,
    });
  });

  it('no payments, nothing paid', () => {
    expect(paidSoFar(33_064_962, 5875, 196_811, 0)).toEqual({
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
