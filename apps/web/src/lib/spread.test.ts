import { describe, expect, it } from 'vitest';
import { spreadMonths, spreadPart } from './spread';

const split = (periodId: string, amountCents: number, categoryId = 'c') => ({
  id: periodId,
  txnId: 't',
  categoryId,
  amountCents,
  periodId,
  sortOrder: 0,
});

describe('spread', () => {
  const t = {
    postedAt: '2026-11-20',
    splits: [split('2026-12', 3_333), split('2026-11', 3_334), split('2027-01', 3_333)],
  };
  it('counts the months', () => {
    expect(spreadMonths(t)).toBe(3);
    expect(spreadMonths({ postedAt: '2026-11-20', splits: [split('2026-11', 1)] })).toBe(1);
  });
  it('names the part a month draws', () => {
    expect(spreadPart(t, '2026-12')).toEqual({ index: 2, months: 3, amountCents: 3_333 });
    expect(spreadPart(t, '2027-02')).toBeNull();
    expect(
      spreadPart({ postedAt: '2026-11-20', splits: [split('2026-11', 1)] }, '2026-11'),
    ).toBeNull();
  });
});
