import { describe, expect, it } from 'vitest';
import { MAX_MONTHS, monthlyInterest, simulatePayoff, stepBalance, type DebtLoan } from './payoff';

const plain = { extraCents: 0, strategy: 'snowball', rollForward: true } as const;

describe('monthly interest and balance step', () => {
  it('interest is balance × APR ÷ 12, rounded to the cent', () => {
    expect(monthlyInterest(33_064_962, 5875)).toBe(161_881); // $330,649.62 at 5.875%
    expect(monthlyInterest(0, 5875)).toBe(0);
  });

  it('one payment moves a balance by interest minus the payment, never below zero', () => {
    // The mortgage statement: $331,000-ish balance, $1,968.11 principal + interest.
    expect(stepBalance(33_064_962, 5875, 196_811)).toBe(33_064_962 + 161_881 - 196_811);
    expect(stepBalance(10_000, 6000, 50_000)).toBe(0);
  });
});

describe('payoff simulation', () => {
  it('a single loan amortizes to the month the closed form predicts', () => {
    // $10,000 at 6% with $200/mo: n = -ln(1 - rB/P) / ln(1 + r) = 57.7, so 58 payments.
    const r = simulatePayoff(
      [{ id: 'a', balanceCents: 1_000_000, aprMilliPct: 6000, paymentCents: 20_000 }],
      plain,
    );
    expect(r.loans).toEqual([{ id: 'a', payoffMonth: 58, interestCents: 153_616 }]);
    expect(r.debtFreeMonth).toBe(58);
    expect(r.totalInterestCents).toBe(153_616);
  });

  it('the total owed starts at today and ends at zero', () => {
    const r = simulatePayoff(
      [{ id: 'a', balanceCents: 1_000_000, aprMilliPct: 6000, paymentCents: 20_000 }],
      plain,
    );
    expect(r.totalOwedByMonth).toHaveLength(59);
    expect(r.totalOwedByMonth[0]).toBe(1_000_000);
    expect(r.totalOwedByMonth.at(-1)).toBe(0);
  });

  it('a payment that never covers its interest never pays off', () => {
    const r = simulatePayoff(
      [{ id: 'a', balanceCents: 1_000_000, aprMilliPct: 12000, paymentCents: 5_000 }],
      plain,
    );
    expect(r.loans[0]?.payoffMonth).toBeNull();
    expect(r.debtFreeMonth).toBeNull();
    expect(r.totalOwedByMonth).toHaveLength(MAX_MONTHS + 1);
  });

  it('a loan already at zero is done and never touched', () => {
    const r = simulatePayoff(
      [
        { id: 'done', balanceCents: 0, aprMilliPct: 5000, paymentCents: 10_000 },
        { id: 'a', balanceCents: 100_000, aprMilliPct: 0, paymentCents: 10_000 },
      ],
      plain,
    );
    expect(r.loans[0]).toEqual({ id: 'done', payoffMonth: 0, interestCents: 0 });
    // The finished loan's payment is not counted as freed money: 10 payments, not 5.
    expect(r.loans[1]?.payoffMonth).toBe(10);
  });

  it('with nothing owed there is no debt-free month to wait for', () => {
    const r = simulatePayoff(
      [{ id: 'done', balanceCents: 0, aprMilliPct: 5000, paymentCents: 10_000 }],
      plain,
    );
    expect(r.debtFreeMonth).toBe(0);
    expect(r.totalOwedByMonth).toEqual([0]);
  });

  const two: DebtLoan[] = [
    { id: 'small', balanceCents: 100_000, aprMilliPct: 4000, paymentCents: 10_000 },
    { id: 'big', balanceCents: 500_000, aprMilliPct: 9000, paymentCents: 10_000 },
  ];

  it('snowball sends extra to the smallest balance first', () => {
    const r = simulatePayoff(two, { ...plain, extraCents: 10_000 });
    expect(r.loans.map((l) => l.payoffMonth)).toEqual([6, 22]);
    expect(r.totalInterestCents).toBe(51_064);
  });

  it('avalanche sends extra to the highest APR first and pays less interest', () => {
    const r = simulatePayoff(two, { ...plain, extraCents: 10_000, strategy: 'avalanche' });
    expect(r.loans.map((l) => l.payoffMonth)).toEqual([11, 22]);
    expect(r.totalInterestCents).toBe(49_848);
  });

  it('a finished loan’s payment rolls onto the next one only when carrying forward', () => {
    const rolled = simulatePayoff(two, plain);
    const dropped = simulatePayoff(two, { ...plain, rollForward: false });
    expect(rolled.loans.map((l) => l.payoffMonth)).toEqual([11, 34]);
    expect(dropped.loans.map((l) => l.payoffMonth)).toEqual([11, 62]);
  });

  it('extra bigger than the target flows on to the next loan the same month', () => {
    const r = simulatePayoff(
      [
        { id: 'a', balanceCents: 5_000, aprMilliPct: 0, paymentCents: 1_000 },
        { id: 'b', balanceCents: 20_000, aprMilliPct: 0, paymentCents: 1_000 },
      ],
      { ...plain, extraCents: 50_000 },
    );
    expect(r.loans.map((l) => l.payoffMonth)).toEqual([1, 1]);
    expect(r.debtFreeMonth).toBe(1);
  });

  it('ties break by account id so the order is stable', () => {
    const r = simulatePayoff(
      [
        { id: 'b', balanceCents: 10_000, aprMilliPct: 0, paymentCents: 0 },
        { id: 'a', balanceCents: 10_000, aprMilliPct: 0, paymentCents: 0 },
      ],
      { ...plain, extraCents: 1_000 },
    );
    expect(r.loans.map((l) => l.payoffMonth)).toEqual([20, 10]);
  });

  it('avalanche breaks equal rates by the smaller balance', () => {
    const r = simulatePayoff(
      [
        { id: 'a', balanceCents: 30_000, aprMilliPct: 5000, paymentCents: 0 },
        { id: 'b', balanceCents: 10_000, aprMilliPct: 5000, paymentCents: 0 },
      ],
      { ...plain, extraCents: 5_000, strategy: 'avalanche' },
    );
    expect(r.loans[1]?.payoffMonth).toBeLessThan(r.loans[0]?.payoffMonth ?? 0);
  });

  it('an empty list has nothing to simulate', () => {
    expect(simulatePayoff([], plain)).toEqual({
      loans: [],
      debtFreeMonth: 0,
      totalInterestCents: 0,
      totalOwedByMonth: [0],
    });
  });
});

describe('one-time lumps', () => {
  const loans: DebtLoan[] = [
    { id: 'big', balanceCents: 1_000_000, aprMilliPct: 3000, paymentCents: 20_000 },
    { id: 'small', balanceCents: 100_000, aprMilliPct: 5000, paymentCents: 5_000 },
  ];
  const base = simulatePayoff(loans, plain);

  it('paying a loan off now finishes it at month 0 and its payment moves on', () => {
    const r = simulatePayoff(loans, {
      ...plain,
      lumps: [{ month: 0, cents: 100_000, ids: ['small'] }],
    });
    expect(r.loans[1]).toEqual({ id: 'small', payoffMonth: 0, interestCents: 0 });
    expect(r.totalOwedByMonth[0]).toBe(1_000_000);
    expect(r.debtFreeMonth).toBeLessThan(base.debtFreeMonth ?? 0);
    expect(r.totalInterestCents).toBeLessThan(base.totalInterestCents);
  });

  it('without rollover the freed payment drops out', () => {
    const roll = simulatePayoff(loans, {
      ...plain,
      lumps: [{ month: 0, cents: 100_000, ids: ['small'] }],
    });
    const drop = simulatePayoff(loans, {
      ...plain,
      rollForward: false,
      lumps: [{ month: 0, cents: 100_000, ids: ['small'] }],
    });
    expect(drop.debtFreeMonth).toBeGreaterThan(roll.debtFreeMonth ?? 0);
  });

  it('a later lump lands after the month payments', () => {
    const r = simulatePayoff(loans, {
      ...plain,
      lumps: [{ month: 3, cents: 50_000, ids: ['big'] }],
    });
    const noLump = simulatePayoff(loans, plain);
    expect(r.totalOwedByMonth[2]).toBe(noLump.totalOwedByMonth[2]);
    expect(r.totalOwedByMonth[3]).toBe((noLump.totalOwedByMonth[3] ?? 0) - 50_000);
  });

  it('what a named loan cannot take spills to the rest by strategy', () => {
    const r = simulatePayoff(loans, {
      ...plain,
      lumps: [{ month: 0, cents: 150_000, ids: ['small'] }],
    });
    expect(r.loans[1]?.payoffMonth).toBe(0);
    expect(r.totalOwedByMonth[0]).toBe(950_000);
  });

  it('with no named loan the lump goes by the plan strategy, or its own', () => {
    const smallest = simulatePayoff(loans, { ...plain, lumps: [{ month: 0, cents: 100_000 }] });
    expect(smallest.loans[1]?.payoffMonth).toBe(0);
    const highest = simulatePayoff(loans, {
      ...plain,
      strategy: 'avalanche',
      lumps: [{ month: 0, cents: 100_000 }],
    });
    expect(highest.loans[1]?.payoffMonth).toBe(0);
    const own = simulatePayoff(loans, {
      ...plain,
      lumps: [{ month: 0, cents: 100_000, strategy: 'avalanche' }],
    });
    expect(own.totalOwedByMonth[0]).toBe(1_000_000);
  });

  it('naming an unknown or finished loan is ignored', () => {
    const r = simulatePayoff(loans, {
      ...plain,
      lumps: [
        { month: 0, cents: 100_000, ids: ['small'] },
        { month: 0, cents: 10_000, ids: ['small', 'nope'] },
      ],
    });
    expect(r.totalOwedByMonth[0]).toBe(990_000);
  });
});
