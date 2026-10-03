import { describe, expect, it } from 'vitest';
import { dueDateIn, isDue, planAutoApply, type AutoLoan, type AutoTxn } from './autoapply';
import { stepBalance } from './payoff';

const loan = (id: string, over: Partial<AutoLoan> = {}): AutoLoan => ({
  accountId: id,
  aprMilliPct: 3660,
  paymentCents: 4_114,
  dueDay: 1,
  appliedThrough: '2026-10',
  owedCents: 195_827,
  ...over,
});
const debit = (
  id: string,
  postedAt: string,
  amountCents: number,
  accountId = 'checking',
): AutoTxn => ({
  id,
  accountId,
  postedAt,
  amountCents,
});

describe('when a payment is due', () => {
  it('is due on or after its day, once, while something is owed', () => {
    expect(isDue(loan('a'), '2026-11-01')).toBe(true);
    expect(isDue(loan('a'), '2026-10-31')).toBe(false); // November not yet
    expect(isDue(loan('a', { appliedThrough: '2026-11' }), '2026-11-05')).toBe(false);
    expect(isDue(loan('a', { owedCents: 0 }), '2026-11-05')).toBe(false);
    expect(isDue(loan('a', { paymentCents: 0 }), '2026-11-05')).toBe(false);
  });

  it('a 31st due day lands on the last day of a short month', () => {
    expect(dueDateIn('2026-11', 31)).toBe('2026-11-30');
    expect(dueDateIn('2026-12', 14)).toBe('2026-12-14');
    expect(isDue(loan('a', { dueDay: 31, appliedThrough: '2026-10' }), '2026-11-29')).toBe(false);
    expect(isDue(loan('a', { dueDay: 31, appliedThrough: '2026-10' }), '2026-11-30')).toBe(true);
  });
});

describe('matching debits to loan payments', () => {
  it('a debit of exactly the payment applies that loan, dated the day it posted', () => {
    const r = planAutoApply([loan('a')], [debit('t1', '2026-11-02', 4_114)], '2026-11-03');
    expect(r).toEqual([
      {
        accountId: 'a',
        beforeCents: 195_827,
        afterCents: stepBalance(195_827, 3660, 4_114),
        asOf: '2026-11-02',
        txnId: 't1',
      },
    ]);
  });

  it('one debit equal to the sum of loans sharing a due day pays them all', () => {
    const loans = [
      loan('a', { paymentCents: 5_489, owedCents: 266_322 }),
      loan('b', { paymentCents: 4_114 }),
    ];
    const r = planAutoApply(loans, [debit('lump', '2026-11-01', 9_603)], '2026-11-01');
    expect(r.map((x) => [x.accountId, x.txnId])).toEqual([
      ['a', 'lump'],
      ['b', 'lump'],
    ]);
  });

  it('without a lump debit, each loan matches a debit of its own payment', () => {
    const loans = [loan('a', { paymentCents: 5_489 }), loan('b', { paymentCents: 4_114 })];
    const txns = [debit('x', '2026-11-01', 4_114), debit('y', '2026-11-01', 5_489)];
    const r = planAutoApply(loans, txns, '2026-11-01');
    expect(r.map((x) => [x.accountId, x.txnId])).toEqual([
      ['a', 'y'],
      ['b', 'x'],
    ]);
  });

  it('a loan with no matching debit is left for the user', () => {
    const loans = [loan('a', { paymentCents: 5_489 }), loan('b', { paymentCents: 4_114 })];
    const r = planAutoApply(loans, [debit('x', '2026-11-01', 4_114)], '2026-11-01');
    expect(r.map((x) => x.accountId)).toEqual(['b']);
  });

  it('a single debit pays only one of two loans with the same payment', () => {
    const loans = [loan('a'), loan('b')];
    const r = planAutoApply(loans, [debit('x', '2026-11-01', 4_114)], '2026-11-01');
    expect(r).toHaveLength(1);
  });

  it('ignores near misses, refunds, loan-account rows, and debits outside the window', () => {
    const txns = [
      debit('off', '2026-11-01', 4_115),
      debit('refund', '2026-11-01', -4_114),
      debit('own', '2026-11-01', 4_114, 'a'),
      debit('early', '2026-10-27', 4_114), // before the 3-day allowance for a Nov 1 due date
      debit('future', '2026-11-04', 4_114), // after today
    ];
    expect(planAutoApply([loan('a')], txns, '2026-11-03')).toEqual([]);
  });

  it('a payment that posted a couple of days early still counts', () => {
    const r = planAutoApply([loan('a')], [debit('t', '2026-10-29', 4_114)], '2026-11-01');
    expect(r.map((x) => x.txnId)).toEqual(['t']);
  });

  it('loans on different due days match independently', () => {
    const loans = [loan('a'), loan('b', { dueDay: 14, paymentCents: 17_046 })];
    const txns = [debit('t1', '2026-11-01', 4_114), debit('t2', '2026-11-14', 17_046)];
    expect(planAutoApply(loans, txns, '2026-11-01').map((x) => x.accountId)).toEqual(['a']);
    expect(planAutoApply(loans, txns, '2026-11-14').map((x) => x.accountId)).toEqual(['a', 'b']);
  });

  it('with the same date, the earlier-id debit is taken first', () => {
    const txns = [debit('z', '2026-11-01', 4_114), debit('b', '2026-11-01', 4_114)];
    expect(planAutoApply([loan('a')], txns, '2026-11-01')[0]?.txnId).toBe('b');
  });

  it('an earlier debit is taken before a later one', () => {
    const txns = [debit('b', '2026-11-02', 4_114), debit('z', '2026-11-01', 4_114)];
    expect(planAutoApply([loan('a')], txns, '2026-11-02')[0]?.txnId).toBe('z');
  });
});
