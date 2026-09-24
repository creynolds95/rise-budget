import { describe, expect, it } from 'vitest';
import {
  addMonths,
  detectSeries,
  nextDate,
  steadyAmounts,
  typicalPostDay,
  type Occurrence,
} from './detect';

const o = (date: string, amountCents = 1_549, categoryId: string | null = null): Occurrence => ({
  date,
  amountCents,
  categoryId,
});

describe('recurring detection (SPEC §7)', () => {
  it('detects monthly from 3 occurrences and predicts the next', () => {
    const s = detectSeries([o('2026-06-07'), o('2026-07-07'), o('2026-08-08')], '2026-08-20');
    expect(s).toMatchObject({
      cadence: 'monthly',
      expectedAmountCents: 1_549,
      lastDate: '2026-08-08',
      nextExpectedDate: '2026-09-07',
      status: 'active',
      occurrences: 3,
    });
  });

  it('two occurrences are not a series', () => {
    expect(detectSeries([o('2026-07-07'), o('2026-08-07')], '2026-08-20')).toBeNull();
  });

  it('marks broken when the next charge is more than 7 days late', () => {
    const occ = [o('2026-05-07'), o('2026-06-07'), o('2026-07-07')];
    expect(detectSeries(occ, '2026-08-14')?.status).toBe('active');
    expect(detectSeries(occ, '2026-08-15')?.status).toBe('broken');
  });

  it('allows ±4 days of drift, not 5', () => {
    expect(
      detectSeries([o('2026-06-07'), o('2026-07-11'), o('2026-08-07')], '2026-08-10'),
    ).not.toBeNull();
    expect(
      detectSeries([o('2026-06-07'), o('2026-07-12'), o('2026-08-07')], '2026-08-10'),
    ).toBeNull();
  });

  it('keeps the anchor day through short months', () => {
    const s = detectSeries([o('2026-01-31'), o('2026-02-28'), o('2026-03-31')], '2026-04-01');
    expect(s?.nextExpectedDate).toBe('2026-04-30');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-30', 1, 31)).toBe('2026-12-31');
  });

  it('weekly, biweekly and annual cadences', () => {
    const weekly = ['2026-09-01', '2026-09-08', '2026-09-15'].map((d) => o(d, 2_000));
    expect(detectSeries(weekly, '2026-09-16')).toMatchObject({
      cadence: 'weekly',
      nextExpectedDate: '2026-09-22',
    });
    const pay = ['2026-08-07', '2026-08-21', '2026-09-04'].map((d) => o(d, -245_000));
    expect(detectSeries(pay, '2026-09-10')).toMatchObject({
      cadence: 'biweekly',
      nextExpectedDate: '2026-09-18',
    });
    const yearly = ['2024-03-02', '2025-03-01', '2026-03-03'].map((d) => o(d, 13_900));
    expect(detectSeries(yearly, '2026-04-01')).toMatchObject({
      cadence: 'annual',
      nextExpectedDate: '2027-03-02',
    });
    expect(nextDate('annual', '2026-02-28')).toBe('2027-02-28');
    // 11-day gaps fit weekly (off by 4) and biweekly (off by 3): the closer cadence wins.
    const ambiguous = ['2026-09-01', '2026-09-12', '2026-09-23'].map((d) => o(d, 2_000));
    expect(detectSeries(ambiguous, '2026-09-24')?.cadence).toBe('biweekly');
  });

  it('amounts within 5% of the median, or identical', () => {
    expect(steadyAmounts([10_000, 10_500, 9_500])).toBe(true);
    expect(steadyAmounts([10_000, 10_501, 9_500])).toBe(false);
    expect(steadyAmounts([100, 100, 100, 100])).toBe(true);
    expect(steadyAmounts([9_000, 16_000, 12_000])).toBe(false); // a utility bill varies too much
  });

  it('a price change: the recent run is the series, at the new price', () => {
    const occ = [
      o('2026-03-07', 1_399),
      o('2026-04-07', 1_399),
      o('2026-05-07', 1_549),
      o('2026-06-07', 1_549),
      o('2026-07-07', 1_549),
    ];
    expect(detectSeries(occ, '2026-07-10')).toMatchObject({
      expectedAmountCents: 1_549,
      occurrences: 3,
    });
  });

  it('irregular spending at one merchant is not a series; mixed signs never are', () => {
    const coffee = ['2026-09-01', '2026-09-03', '2026-09-10', '2026-09-11'].map((d) => o(d, 575));
    expect(detectSeries(coffee, '2026-09-12')).toBeNull();
    expect(
      detectSeries(
        [o('2026-06-07', 500), o('2026-07-07', -500), o('2026-08-07', 500)],
        '2026-08-08',
      ),
    ).toBeNull();
    expect(
      detectSeries([o('2026-06-07', 0), o('2026-07-07', 0), o('2026-08-07', 0)], '2026-08-08'),
    ).toBeNull();
  });

  it('carries the category once two charges share it', () => {
    const one = [o('2026-06-07', 1_549, 'subs'), o('2026-07-07'), o('2026-08-07')];
    expect(detectSeries(one, '2026-08-10')?.categoryId).toBeNull();
    const two = [
      o('2026-06-07', 1_549, 'fun'),
      o('2026-07-07', 1_549, 'subs'),
      o('2026-08-07', 1_549, 'subs'),
    ];
    expect(detectSeries(two, '2026-08-10')?.categoryId).toBe('subs');
    const none = [o('2026-06-07'), o('2026-07-07'), o('2026-08-07')];
    expect(detectSeries(none, '2026-08-10')?.categoryId).toBeNull();
  });

  it('feeds typical_post_day for monthly series only', () => {
    const monthly = detectSeries([o('2026-06-03'), o('2026-07-03'), o('2026-08-03')], '2026-08-10');
    expect(monthly && typicalPostDay(monthly)).toBe(3);
    const weekly = detectSeries(
      ['2026-09-01', '2026-09-08', '2026-09-15'].map((d) => o(d)),
      '2026-09-16',
    );
    expect(weekly && typicalPostDay(weekly)).toBeNull();
  });
});
