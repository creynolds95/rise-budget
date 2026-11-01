import { describe, expect, it } from 'vitest';
import { advanceHandAdded, type HandAddedRule, type ProofRow } from './handAdded';

const rent: HandAddedRule = {
  cadence: 'monthly',
  anchorDays: null,
  amountCents: 150_000,
  nextExpectedDate: '2026-10-31', // Saturday: taken Monday Nov 2
};
const row = (key: string, date: string, amountCents: number): ProofRow => ({
  key,
  date,
  amountCents,
});
const none = new Set<string>();

describe('advanceHandAdded', () => {
  it('stays owed with no proof, even days past its date', () => {
    expect(advanceHandAdded(rent, [], none, '2026-11-03')).toEqual({
      nextExpectedDate: '2026-10-31',
      claimedKey: null,
    });
  });

  it('a weekend bill stays owed through the weekend and moves on when the Monday charge posts', () => {
    const out = advanceHandAdded(rent, [row('a', '2026-11-02', 150_000)], none, '2026-11-02');
    expect(out).toEqual({ nextExpectedDate: '2026-11-30', claimedKey: 'a' });
  });

  it('a charge a week before the due date is not proof', () => {
    const early = [row('a', '2026-10-24', 150_000)];
    expect(advanceHandAdded(rent, early, none, '2026-10-26').claimedKey).toBeNull();
  });

  it('a charge dated one day early is proof (date slack)', () => {
    const slack = [row('a', '2026-10-30', 150_000)];
    expect(advanceHandAdded(rent, slack, none, '2026-10-31').claimedKey).toBe('a');
  });

  it('a variable-size charge outside 5% is not proof', () => {
    expect(advanceHandAdded(rent, [row('a', '2026-11-02', 170_000)], none, '2026-11-02')).toEqual({
      nextExpectedDate: '2026-10-31',
      claimedKey: null,
    });
  });

  it('a refund of the same size is not proof', () => {
    expect(
      advanceHandAdded(rent, [row('a', '2026-11-02', -150_000)], none, '2026-11-02').claimedKey,
    ).toBeNull();
  });

  it('a row another schedule already claimed proves nothing here', () => {
    const rows = [row('a', '2026-11-02', 150_000)];
    expect(advanceHandAdded(rent, rows, new Set(['a']), '2026-11-02').claimedKey).toBeNull();
  });

  it('takes the earliest of two matching rows and leaves the other', () => {
    const rows = [row('b', '2026-11-04', 150_000), row('a', '2026-11-02', 150_000)];
    expect(advanceHandAdded(rent, rows, none, '2026-11-04').claimedKey).toBe('a');
  });

  it('a paycheck is proven by a deposit up to 2 business days early (Sunday date, Friday deposit)', () => {
    const pay: HandAddedRule = {
      cadence: 'biweekly',
      anchorDays: null,
      amountCents: -200_000,
      nextExpectedDate: '2026-11-01',
    };
    const out = advanceHandAdded(pay, [row('p', '2026-10-29', -200_000)], none, '2026-11-02');
    expect(out).toEqual({ nextExpectedDate: '2026-11-15', claimedKey: 'p' });
    // Tuesday is 3 business days before the Friday landing: too early.
    expect(
      advanceHandAdded(pay, [row('p', '2026-10-27', -200_000)], none, '2026-11-02').claimedKey,
    ).toBeNull();
  });

  it('after a whole cycle with no proof it rolls to the next date so it never goes stale', () => {
    const out = advanceHandAdded(rent, [], none, '2026-12-05');
    expect(out).toEqual({ nextExpectedDate: '2026-12-31', claimedKey: null });
  });
});
