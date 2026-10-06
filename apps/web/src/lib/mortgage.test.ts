import { describe, expect, it } from 'vitest';
import type { DebtLoanPlan } from '@rise/shared/schemas';
import { lineSeries, monthsFrom, mortgageView } from './mortgage';

const loan: DebtLoanPlan = {
  accountId: 'm',
  aprMilliPct: 5875,
  paymentCents: 196_811,
  dueDay: 1,
  group: 'mortgage',
  appliedThrough: '2026-10',
  merchant: '',
};
const settings = { mortgageExtraCents: 0, mortgageLumps: [], mortgageTermMonths: 360 };

describe('mortgage view', () => {
  it("lines up with the servicer's statement", () => {
    const v = mortgageView(loan, 33_064_962, settings, '2026-10');
    expect(v.payoffPeriod).toBe('2056-04');
    expect(v.paidCount).toBe(6);
    expect(v.ytd).toEqual({ principalCents: 206_038, interestCents: 6 * 196_811 - 206_038 });
    expect(v.monthsSooner).toBeNull();
    expect(v.interestSavedCents).toBeNull();
  });

  it('extra payments move the date and save interest; one-time ones count by month', () => {
    const v = mortgageView(
      loan,
      33_064_962,
      {
        ...settings,
        mortgageExtraCents: 10_000,
        mortgageLumps: [{ period: '2027-01', cents: 1_000_000 }],
      },
      '2026-10',
    );
    expect(v.monthsSooner).toBeGreaterThan(0);
    expect(v.interestSavedCents).toBeGreaterThan(0);
    expect(v.plan.rows[2]?.extraCents).toBe(1_010_000);
  });

  it('a past or current month lump goes in the next payment', () => {
    const v = mortgageView(
      loan,
      33_064_962,
      { ...settings, mortgageLumps: [{ period: '2026-01', cents: 500_000 }] },
      '2026-10',
    );
    expect(v.plan.rows[0]?.extraCents).toBe(500_000);
  });

  it('a payment that never pays off has no date and no payments counted', () => {
    const v = mortgageView({ ...loan, paymentCents: 100_000 }, 33_064_962, settings, '2026-10');
    expect(v.payoffPeriod).toBeNull();
    expect(v.paidCount).toBe(0);
    expect(v.ytd).toBeNull();
    expect(v.monthsSooner).toBeNull();
  });

  it('counts months between periods', () => {
    expect(monthsFrom('2026-10', '2027-01')).toBe(3);
  });

  it('thins the series to ~60 points ending at the last month, balance first', () => {
    const v = mortgageView(loan, 33_064_962, settings, '2026-10');
    const s = lineSeries(v.plan, 33_064_962);
    expect(s.balance[0]).toBe(33_064_962);
    expect(s.balance.at(-1)).toBe(0);
    expect(s.principal.at(-1)).toBe(33_064_962);
    expect(s.months.at(-1)).toBe(354);
    expect(s.balance.length).toBeLessThanOrEqual(62);
    expect(lineSeries({ rows: [], payoffMonth: 0, totalInterestCents: 0 }, 0).months).toEqual([0]);
  });
});
