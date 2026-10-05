import { describe, expect, it } from 'vitest';
import { nearDue, surplusMatch, type SurplusScheduleShape, type SurplusTxn } from './match';

const CHECKING = 'chk';
const SAVINGS = 'sav';
const CARD = 'card';
const cash = new Set([CHECKING, SAVINGS]);
const cards = new Set([CARD]);

const sched = (over: Partial<SurplusScheduleShape>): SurplusScheduleShape => ({
  merchant: 'NETFLIX',
  name: 'Netflix',
  amountCents: 1599,
  cadence: 'monthly',
  anchorDays: null,
  nextExpectedDate: '2026-10-15',
  isHandAdded: false,
  ...over,
});
const txn = (over: Partial<SurplusTxn>): SurplusTxn => ({
  merchant: 'NETFLIX',
  amountCents: 1599,
  date: '2026-09-15',
  accountId: CHECKING,
  isTransfer: false,
  pairAccountId: null,
  ...over,
});
const match = (t: SurplusTxn, s: SurplusScheduleShape[], sug = new Map<string, string>()) =>
  surplusMatch(t, s, sug, cash, cards);

describe('surplusMatch', () => {
  it('a charge from a tagged schedule’s merchant is tracked as it', () => {
    expect(match(txn({}), [sched({})])).toEqual({ state: 'tracked', name: 'Netflix' });
  });

  it('a tagged merchant’s charge of a different size is not', () => {
    expect(match(txn({ amountCents: 4999 }), [sched({})])).toEqual({ state: 'untracked' });
  });

  it('a refund from a tagged merchant is not', () => {
    expect(match(txn({ amountCents: -1599 }), [sched({})])).toEqual({ state: 'untracked' });
  });

  it('a card purchase never moves cash, so it is never tracked', () => {
    expect(match(txn({ accountId: CARD }), [sched({})])).toEqual({ state: 'untracked' });
  });

  it('a card payment and a move between cash accounts are never tracked', () => {
    const s = [sched({ merchant: 'PAYMENT', amountCents: 50000 })];
    const base = { merchant: 'PAYMENT', amountCents: 50000, isTransfer: true };
    expect(match(txn({ ...base, pairAccountId: CARD }), s)).toEqual({ state: 'untracked' });
    expect(match(txn({ ...base, pairAccountId: SAVINGS }), s)).toEqual({ state: 'untracked' });
  });

  it('a transfer out to a loan counts like a bill', () => {
    const s = [sched({ merchant: 'LOAN', name: 'Loan', amountCents: 30000 })];
    const t = txn({ merchant: 'LOAN', amountCents: 30000, isTransfer: true, pairAccountId: 'ln' });
    expect(match(t, s)).toEqual({ state: 'tracked', name: 'Loan' });
  });

  it('a hand-added schedule of the same amount due around then is a likely match', () => {
    const s = [
      sched({
        merchant: 'x|abc',
        name: 'Mortgage',
        amountCents: 180000,
        isHandAdded: true,
        nextExpectedDate: '2026-11-01',
      }),
    ];
    const t = txn({ merchant: 'MR COOPER', amountCents: 180000, date: '2026-10-02' });
    expect(match(t, s)).toEqual({ state: 'likely', name: 'Mortgage' });
    expect(match({ ...t, date: '2026-10-15' }, s)).toEqual({ state: 'untracked' });
    expect(match({ ...t, amountCents: 90000 }, s)).toEqual({ state: 'untracked' });
  });

  it('a tagged schedule for the merchant wins over a hand-added look-alike', () => {
    const s = [
      sched({ merchant: 'x|abc', name: 'Hand', isHandAdded: true }),
      sched({ amountCents: 9999 }),
    ];
    expect(match(txn({}), s)).toEqual({ state: 'untracked' });
  });

  it('a merchant sync suggested but not yet added reads as suggested', () => {
    const sug = new Map([['NETFLIX', 'Netflix']]);
    expect(match(txn({}), [], sug)).toEqual({ state: 'suggested', name: 'Netflix' });
    expect(match(txn({}), [])).toEqual({ state: 'untracked' });
  });
});

describe('nearDue', () => {
  it('weekly and biweekly step back and forward from any due date', () => {
    const w = sched({ cadence: 'weekly', nextExpectedDate: '2026-10-09' });
    expect(nearDue(w, '2026-09-25')).toBe(true);
    expect(nearDue(w, '2026-09-29')).toBe(true);
    const b = sched({ cadence: 'biweekly', nextExpectedDate: '2026-10-09' });
    expect(nearDue(b, '2026-09-11')).toBe(true);
    expect(nearDue(b, '2026-09-29')).toBe(true);
    expect(nearDue(b, '2026-10-30')).toBe(false);
  });

  it('semimonthly checks the nearest pay date', () => {
    const s = sched({
      cadence: 'semimonthly',
      anchorDays: [5, 20],
      nextExpectedDate: '2026-10-20',
    });
    expect(nearDue(s, '2026-10-02')).toBe(true);
    expect(nearDue(s, '2026-09-11')).toBe(false);
  });

  it('monthly keeps its day, across a year end', () => {
    const s = sched({ anchorDays: [31, 31], nextExpectedDate: '2026-10-31' });
    expect(nearDue(s, '2026-03-01')).toBe(true);
    expect(nearDue(s, '2026-02-15')).toBe(false);
    expect(nearDue(s, '2027-01-28')).toBe(true);
  });

  it('annual looks a year either side', () => {
    const s = sched({ cadence: 'annual', nextExpectedDate: '2027-03-10' });
    expect(nearDue(s, '2026-03-05')).toBe(true);
    expect(nearDue(s, '2026-09-10')).toBe(false);
  });
});
