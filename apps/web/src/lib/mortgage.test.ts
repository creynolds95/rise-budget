import { describe, expect, it } from 'vitest';
import type { DebtLoanPlan } from '@rise/shared/schemas';
import { equityOf, homeAccount, lineSeries, monthsFrom, mortgageView } from './mortgage';

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

  it('a saved payment under the interest stands in a full-term payment, so a date always shows', () => {
    const v = mortgageView({ ...loan, paymentCents: 79_400 }, 33_064_962, settings, '2026-10');
    expect(v.estimated).toBe(true);
    expect(v.paymentCents).toBe(195_592);
    expect(v.payoffPeriod).toBe('2056-10');
    expect(v.paidCount).toBe(0);
    expect(v.ytd).toBeNull();
    expect(
      mortgageView({ ...loan, paymentCents: 0 }, 33_064_962, settings, '2026-10').estimated,
    ).toBe(true);
    expect(v.monthsSooner).toBeNull();
  });

  it('a paid-off balance is not an estimate', () => {
    const v = mortgageView({ ...loan, paymentCents: 0 }, 0, settings, '2026-10');
    expect(v.estimated).toBe(false);
    expect(v.payoffPeriod).toBe('2026-10');
  });

  it('a due payment not yet in the balance is the first one, so the date lands a month sooner', () => {
    const v = mortgageView(loan, 33_064_962, settings, '2026-10', true);
    expect(v.payoffPeriod).toBe('2056-03');
    expect(v.paidCount).toBe(6);
    const lump = mortgageView(
      loan,
      33_064_962,
      { ...settings, mortgageLumps: [{ period: '2026-10', cents: 100_000 }] },
      '2026-10',
      true,
    );
    expect(lump.plan.rows[0]?.extraCents).toBe(100_000);
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

describe('home equity', () => {
  const acct = (id: string, name: string, balanceCents = 40_000_000, kind = 'other') => ({
    id,
    name,
    balanceCents,
    kind,
  });

  it('uses the picked account, else the one asset named like a home', () => {
    const list = [
      acct('a', 'Checking', 100, 'depository'),
      acct('h', 'Home value'),
      acct('c', 'Car'),
    ];
    expect(homeAccount(list, 'c')?.id).toBe('c');
    expect(homeAccount(list, null)?.id).toBe('h');
    expect(homeAccount(list, 'gone')?.id).toBe('h');
  });

  it('guesses nothing when zero or several accounts look like a home', () => {
    expect(homeAccount([acct('c', 'Car')], null)).toBeUndefined();
    expect(homeAccount([acct('h', 'House'), acct('p', 'Rental property')], null)).toBeUndefined();
    expect(homeAccount([acct('h', 'House', -5)], null)).toBeUndefined();
  });

  it('equity is value less owed, with its share of the value', () => {
    expect(equityOf(40_000_000, 33_064_962)).toEqual({ cents: 6_935_038, pct: 17 });
    expect(equityOf(0, 100)).toEqual({ cents: -100, pct: null });
  });
});
