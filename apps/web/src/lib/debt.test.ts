import { describe, expect, it } from 'vitest';
import type { DebtLoanPlan, DebtPlan } from '@rise/shared/schemas';
import {
  DEFAULT_DEBT_PLAN,
  aprFromText,
  aprToText,
  dueSuggestions,
  groupView,
  owedCents,
  planLoans,
} from './debt';

const loan = (over: Partial<DebtLoanPlan> = {}): DebtLoanPlan => ({
  accountId: 'a',
  aprMilliPct: 5250,
  paymentCents: 20_000,
  dueDay: 14,
  group: 'student',
  appliedThrough: '2026-09',
  merchant: '',
  ...over,
});
const acct = (over: Record<string, unknown> = {}) => ({
  id: 'a',
  name: 'Loan A',
  source: 'manual' as const,
  balanceCents: -1_000_000,
  archivedAt: null,
  ...over,
});
const plan = (loans: DebtLoanPlan[]): DebtPlan => ({ ...DEFAULT_DEBT_PLAN, loans });

describe('amounts and rates', () => {
  it('owed is the positive side of a negative liability balance', () => {
    expect(owedCents(-123_456)).toBe(123_456);
    expect(owedCents(0)).toBe(0);
    expect(owedCents(5_000)).toBe(0);
  });

  it('rates round-trip through thousandths of a percent', () => {
    expect(aprToText(5875)).toBe('5.875');
    expect(aprFromText('5.875')).toBe(5875);
    expect(aprFromText(' 4.5% ')).toBe(4500);
    expect(aprFromText('')).toBeNull();
    expect(aprFromText('abc')).toBeNull();
    expect(aprFromText('-1')).toBeNull();
    expect(aprFromText('101')).toBeNull();
  });
});

describe('group view', () => {
  const loans = [
    { plan: loan({ accountId: 'a' }), name: 'A', owedCents: 500_000 },
    { plan: loan({ accountId: 'b', paymentCents: 10_000 }), name: 'B', owedCents: 300_000 },
    { plan: loan({ accountId: 'c' }), name: 'Paid', owedCents: 0 },
  ];
  const opts = { extraCents: 0, strategy: 'snowball' as const, rollForward: true };

  it('dates each loan from next month and marks finished loans done', () => {
    const v = groupView(loans, opts, '2026-10');
    expect(v.owedCents).toBe(800_000);
    expect(v.rows[2]).toMatchObject({ done: true, payoffPeriod: '2026-10' });
    expect(v.rows[0]?.payoffPeriod).not.toBeNull();
    expect(v.debtFreePeriod).toBe(
      v.rows
        .map((r) => r.payoffPeriod)
        .sort()
        .at(-1),
    );
    expect(v.monthsSooner).toBeNull();
    expect(v.interestSavedCents).toBeNull();
  });

  it('extra money brings the date in and saves interest', () => {
    const v = groupView(loans, { ...opts, extraCents: 20_000 }, '2026-10');
    expect(v.monthsSooner).toBeGreaterThan(0);
    expect(v.interestSavedCents).toBeGreaterThan(0);
  });

  it('a loan with no payment has no date, and so the group has none', () => {
    const v = groupView(
      [{ plan: loan({ paymentCents: 0 }), name: 'A', owedCents: 100_000 }],
      opts,
      '2026-10',
    );
    expect(v.rows[0]?.payoffPeriod).toBeNull();
    expect(v.debtFreePeriod).toBeNull();
  });

  it('extra with no baseline date reports no months sooner', () => {
    const v = groupView(
      [{ plan: loan({ paymentCents: 0 }), name: 'A', owedCents: 100_000 }],
      { ...opts, extraCents: 10_000 },
      '2026-10',
    );
    expect(v.monthsSooner).toBeNull();
    expect(v.interestSavedCents).toBeNull();
    expect(v.debtFreePeriod).not.toBeNull();
  });
});

describe('monthly payment suggestions', () => {
  it('suggests the post-payment balance once the due day has passed', () => {
    const [s] = dueSuggestions(plan([loan()]), [acct()], '2026-10-14');
    expect(s).toMatchObject({ beforeCents: 1_000_000, name: 'Loan A' });
    // $10,000 at 5.25%: $43.75 interest, $200 payment.
    expect(s?.afterCents).toBe(1_000_000 + 4_375 - 20_000);
  });

  it('waits for the due day', () => {
    expect(dueSuggestions(plan([loan()]), [acct()], '2026-10-13')).toEqual([]);
  });

  it('a 31st due day lands on the last day of a short month', () => {
    const p = plan([loan({ dueDay: 31, appliedThrough: '2026-10' })]);
    expect(dueSuggestions(p, [acct()], '2026-11-29')).toEqual([]);
    expect(dueSuggestions(p, [acct()], '2026-11-30')).toHaveLength(1);
  });

  it('does not suggest a month already applied or skipped', () => {
    const p = plan([loan({ appliedThrough: '2026-10' })]);
    expect(dueSuggestions(p, [acct()], '2026-10-20')).toEqual([]);
  });

  it('ignores synced, archived, missing, paid-off and payment-less loans', () => {
    const p = plan([loan()]);
    expect(dueSuggestions(p, [acct({ source: 'simplefin' })], '2026-10-20')).toEqual([]);
    expect(dueSuggestions(p, [acct({ archivedAt: '2026-01-01T00:00:00Z' })], '2026-10-20')).toEqual(
      [],
    );
    expect(dueSuggestions(p, [], '2026-10-20')).toEqual([]);
    expect(dueSuggestions(p, [acct({ balanceCents: 0 })], '2026-10-20')).toEqual([]);
    expect(dueSuggestions(plan([loan({ paymentCents: 0 })]), [acct()], '2026-10-20')).toEqual([]);
  });
});

describe('plan loans', () => {
  it('matches loans to accounts by group and drops archived or missing ones', () => {
    const p = plan([
      loan({ accountId: 'a' }),
      loan({ accountId: 'm', group: 'mortgage' }),
      loan({ accountId: 'gone' }),
      loan({ accountId: 'old' }),
    ]);
    const accounts = [
      acct({ id: 'a' }),
      acct({ id: 'm', name: 'Mortgage', balanceCents: -33_000_000 }),
      acct({ id: 'old', archivedAt: '2026-01-01T00:00:00Z' }),
    ];
    expect(planLoans(p, accounts, 'student')).toEqual([
      { plan: p.loans[0], name: 'Loan A', owedCents: 1_000_000 },
    ]);
    expect(planLoans(p, accounts, 'mortgage').map((l) => l.owedCents)).toEqual([33_000_000]);
  });
});
