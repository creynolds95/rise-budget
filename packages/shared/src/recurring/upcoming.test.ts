import { describe, expect, it } from 'vitest';
import type { DetectedSeries } from './detect';
import { upcomingOccurrences } from './upcoming';

const series = (over: Partial<DetectedSeries>): DetectedSeries => ({
  cadence: 'monthly',
  expectedAmountCents: 196_811,
  lastDate: '2026-09-01',
  nextExpectedDate: '2026-10-01',
  status: 'active',
  categoryId: null,
  occurrences: 0,
  anchorDays: null,
  ...over,
});
const dates = (s: DetectedSeries, today: string, waits: boolean, n = 3) =>
  upcomingOccurrences(s, today, n, waits).map((o) => o.date);

describe('upcomingOccurrences', () => {
  it('on time: starts at its next date', () => {
    expect(dates(series({}), '2026-09-28', true)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
    ]);
  });

  it('a late bill waiting on its charge still counts today, then the next cycles', () => {
    expect(dates(series({}), '2026-10-03', true)).toEqual([
      '2026-10-03',
      '2026-11-01',
      '2026-12-01',
    ]);
  });

  it('a bill a whole cycle late stops counting today (the missed note takes over)', () => {
    expect(dates(series({}), '2026-11-02', true)).toEqual([
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
  });

  it('a late paycheck is not counted until it lands', () => {
    const pay = series({ expectedAmountCents: -230_840 });
    expect(dates(pay, '2026-10-03', true)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });

  it('a hand-added schedule never goes stale: past dates already happened', () => {
    const rent = series({ nextExpectedDate: '2026-03-01' });
    expect(dates(rent, '2026-10-03', false)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    const pay = series({
      cadence: 'semimonthly',
      expectedAmountCents: -230_840,
      nextExpectedDate: '2026-08-14',
      anchorDays: [15, 31],
    });
    // Oct 31 and Nov 15 fall on a weekend, so they pay the Friday before.
    expect(dates(pay, '2026-10-03', false)).toEqual(['2026-10-15', '2026-10-30', '2026-11-13']);
  });

  it('walking on keeps the day of month through a short month', () => {
    const s = series({ nextExpectedDate: '2026-01-31' });
    expect(dates(s, '2026-03-05', false)).toEqual(['2026-03-31', '2026-04-30', '2026-05-31']);
  });
});
