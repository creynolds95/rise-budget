import { describe, expect, it } from 'vitest';
import type { DetectedSeries } from './detect';
import { landingDate, upcomingOccurrences } from './upcoming';

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
const dates = (s: DetectedSeries, today: string, asOf: string | null = null, n = 3) =>
  upcomingOccurrences(s, today, n, asOf).map((o) => o.date);

describe('upcomingOccurrences', () => {
  it('on time: starts at its next date', () => {
    expect(dates(series({}), '2026-09-28')).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  });

  it('a late bill waiting on its charge still counts today, then the next cycles', () => {
    expect(dates(series({}), '2026-10-03')).toEqual(['2026-10-03', '2026-11-01', '2026-12-01']);
  });

  it('a bill a whole cycle late stops counting today (the missed note takes over)', () => {
    expect(dates(series({}), '2026-11-02')).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
  });

  it('a late paycheck with no balance date is not counted', () => {
    const pay = series({ expectedAmountCents: -230_840 });
    expect(dates(pay, '2026-10-03')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });

  it('a hand-added schedule never goes stale: past dates already happened', () => {
    const rent = series({ nextExpectedDate: '2026-03-01' });
    expect(dates(rent, '2026-10-03')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    const pay = series({
      cadence: 'semimonthly',
      expectedAmountCents: -230_840,
      nextExpectedDate: '2026-08-14',
      anchorDays: [15, 31],
    });
    // Oct 31 and Nov 15 fall on a weekend, so they pay the Friday before.
    expect(dates(pay, '2026-10-03')).toEqual(['2026-10-15', '2026-10-30', '2026-11-13']);
  });

  it('walking on keeps the day of month through a short month', () => {
    const s = series({ nextExpectedDate: '2026-01-31' });
    expect(dates(s, '2026-03-05')).toEqual(['2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('a late bill whose next cycle lands today counts once, not twice', () => {
    const s = series({ expectedAmountCents: 5_000, nextExpectedDate: '2027-01-30' });
    expect(upcomingOccurrences(s, '2027-02-28', 3)).toEqual([
      { date: '2027-02-28', amountCents: 5_000 },
      { date: '2027-03-30', amountCents: 5_000 },
      { date: '2027-04-30', amountCents: 5_000 },
    ]);
  });

  describe('stale balance brought forward by the rules', () => {
    const pay = series({ expectedAmountCents: -230_840, nextExpectedDate: '2026-10-02' });

    it('a paycheck dated after the balance date counts today, flagged expected', () => {
      // Bank last reported Thu Oct 1; the Fri Oct 2 paycheck has not shown. Today is Sat Oct 3.
      expect(upcomingOccurrences(pay, '2026-10-03', 2, '2026-10-01')).toEqual([
        { date: '2026-10-03', amountCents: -230_840, expectedNotSeen: true },
        { date: '2026-11-02', amountCents: -230_840 },
      ]);
    });

    it('a paycheck on or before the balance date is the bank’s to show: not counted', () => {
      expect(dates(pay, '2026-10-03', '2026-10-02', 1)).toEqual(['2026-11-02']);
    });

    it('a Sunday-dated paycheck lands the Friday before, so a Friday balance has it', () => {
      const sun = series({ expectedAmountCents: -100_000, nextExpectedDate: '2026-11-01' });
      expect(dates(sun, '2026-11-02', '2026-10-30', 1)).toEqual(['2026-12-01']);
      expect(dates(sun, '2026-11-02', '2026-10-29', 1)).toEqual(['2026-11-02']);
    });

    it('a hand-added bill past its date stays owed today until proof moves it on', () => {
      const rent = series({ nextExpectedDate: '2026-10-01' });
      expect(dates(rent, '2026-10-03', '2026-10-01', 2)).toEqual(['2026-10-03', '2026-11-01']);
    });
  });
});

describe('landingDate', () => {
  it('a bill moves to the next business day, a paycheck to the one before', () => {
    expect(landingDate('2027-07-04', 5_000)).toBe('2027-07-06'); // Sunday, observed Monday
    expect(landingDate('2027-07-04', -5_000)).toBe('2027-07-02'); // Friday
    expect(landingDate('2026-10-12', 5_000)).toBe('2026-10-13'); // Columbus Day
    expect(landingDate('2026-10-12', -5_000)).toBe('2026-10-09');
  });
});
