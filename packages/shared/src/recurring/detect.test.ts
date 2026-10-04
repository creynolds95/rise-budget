import { describe, expect, it } from 'vitest';
import {
  addMonths,
  advanceManualRule,
  detectSemimonthly,
  detectSeries,
  firstUpcoming,
  nextDate,
  nextScheduled,
  nextSemimonthlyDate,
  projectOccurrences,
  shiftWeekendToFriday,
  steadyAmounts,
  typicalPostDay,
  type ManualRule,
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
    expect(() => nextDate('semimonthly', '2026-09-05')).toThrow(/nextSemimonthlyDate/);
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

describe('semimonthly pay detection (5th & 20th, 1st & 15th, ...)', () => {
  it('shifts a weekend payday to the Friday before, never later', () => {
    expect(shiftWeekendToFriday('2026-06-20')).toBe('2026-06-19'); // Saturday
    expect(shiftWeekendToFriday('2026-07-05')).toBe('2026-07-03'); // Sunday
    expect(shiftWeekendToFriday('2026-06-05')).toBe('2026-06-05'); // Friday: unchanged
  });

  it('detects alternating 5th/20th pay, weekend shifts included, and predicts the next', () => {
    const occ = [
      '2026-04-03', // 5th, shifted from Sunday
      '2026-04-20',
      '2026-05-05',
      '2026-05-20',
      '2026-06-05',
      '2026-06-19', // 20th, shifted from Saturday
      '2026-07-03', // 5th, shifted from Sunday
    ].map((d) => o(d, -310_000));
    const s = detectSemimonthly(occ, '2026-07-10');
    expect(s).toMatchObject({
      cadence: 'semimonthly',
      anchorDays: [5, 20],
      lastDate: '2026-07-03',
      nextExpectedDate: '2026-07-20',
      status: 'active',
      occurrences: 7,
    });
  });

  it("predicts across a month boundary and honours the next month's own weekend shift", () => {
    expect(nextSemimonthlyDate('2026-07-20', [5, 20])).toBe('2026-08-05');
    // Aug 1st and 15th both fall on a Saturday (shifted to Jul 31 / Aug 14) and are already
    // past `from`, so the next payday rolls to September's unshifted 1st.
    expect(nextSemimonthlyDate('2026-08-14', [1, 15])).toBe('2026-09-01');
  });

  it('marks broken when the next payday is more than 7 days late', () => {
    const occ = [
      '2026-04-03',
      '2026-04-20',
      '2026-05-05',
      '2026-05-20',
      '2026-06-05',
      '2026-06-19',
      '2026-07-03',
    ].map((d) => o(d, -310_000));
    expect(detectSemimonthly(occ, '2026-07-27')?.status).toBe('active');
    expect(detectSemimonthly(occ, '2026-07-28')?.status).toBe('broken');
  });

  it('needs at least 4 occurrences', () => {
    const occ = ['2026-04-03', '2026-04-20', '2026-05-05'].map((d) => o(d, -310_000));
    expect(detectSemimonthly(occ, '2026-05-10')).toBeNull();
  });

  it('rejects a single cluster (not two anchors) and weekly noise', () => {
    const oneCluster = ['2026-05-05', '2026-05-07', '2026-05-09', '2026-05-11'].map((d) =>
      o(d, 500),
    );
    expect(detectSemimonthly(oneCluster, '2026-05-15')).toBeNull();
    const weekly = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].map((d) => o(d, 500));
    expect(detectSemimonthly(weekly, '2026-09-23')).toBeNull();
    // Every occurrence on the same day of month: no second anchor to cluster against.
    const sameDay = ['2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05'].map((d) => o(d, 500));
    expect(detectSemimonthly(sameDay, '2026-08-01')).toBeNull();
    // Good anchors (5th & 20th), but the charges themselves are far too close together.
    const tooClose = ['2026-01-05', '2026-01-06', '2026-01-20', '2026-02-05'].map((d) => o(d, 500));
    expect(detectSemimonthly(tooClose, '2026-02-10')).toBeNull();
    // Good anchors, but the charges span years apart instead of alternating monthly.
    const tooFarApart = ['2020-01-05', '2020-01-20', '2025-06-05', '2025-06-20'].map((d) =>
      o(d, 500),
    );
    expect(detectSemimonthly(tooFarApart, '2025-07-01')).toBeNull();
    // Otherwise-valid semimonthly dates, but the amounts aren't a real pay series.
    const mixedSign = [
      o('2026-01-05', 500),
      o('2026-01-20', -500),
      o('2026-02-05', 500),
      o('2026-02-20', 500),
    ];
    expect(detectSemimonthly(mixedSign, '2026-03-01')).toBeNull();
    const unsteady = [
      o('2026-01-05', 500),
      o('2026-01-20', 5_000),
      o('2026-02-05', 500),
      o('2026-02-20', 500),
    ];
    expect(detectSemimonthly(unsteady, '2026-03-01')).toBeNull();
  });

  it('carries the category once two charges share it, same as detectSeries', () => {
    const occ = [
      o('2026-04-03', -310_000, 'income'),
      o('2026-04-20', -310_000, 'income'),
      o('2026-05-05', -310_000, 'income'),
      o('2026-05-20', -310_000, 'income'),
    ];
    expect(detectSemimonthly(occ, '2026-05-25')?.categoryId).toBe('income');
  });
});

describe('projecting a series forward (cash-to-payday)', () => {
  it('projects a monthly bill at its expected amount', () => {
    const s = detectSeries([o('2026-06-07'), o('2026-07-07'), o('2026-08-08')], '2026-08-20');
    expect(s).not.toBeNull();
    expect(projectOccurrences(s as NonNullable<typeof s>, 3)).toEqual([
      { date: '2026-09-07', amountCents: 1_549 },
      { date: '2026-10-07', amountCents: 1_549 },
      { date: '2026-11-07', amountCents: 1_549 },
    ]);
  });

  it('projects a semimonthly paycheck, alternating anchors', () => {
    const occ = [
      '2026-04-03',
      '2026-04-20',
      '2026-05-05',
      '2026-05-20',
      '2026-06-05',
      '2026-06-19',
      '2026-07-03',
    ].map((d) => o(d, -310_000));
    const s = detectSemimonthly(occ, '2026-07-10');
    expect(s).not.toBeNull();
    expect(projectOccurrences(s as NonNullable<typeof s>, 3)).toEqual([
      { date: '2026-07-20', amountCents: -310_000 },
      { date: '2026-08-05', amountCents: -310_000 },
      { date: '2026-08-20', amountCents: -310_000 },
    ]);
  });
});

describe('manual cash-withdrawal rules (Caleb: mortgage/student loans too new to auto-detect)', () => {
  it('walks a monthly anchor forward to the first date on or after today', () => {
    expect(firstUpcoming('monthly', '2026-09-01', null, '2026-09-25')).toBe('2026-10-01');
    // Already in the future: stays put.
    expect(firstUpcoming('monthly', '2026-10-15', null, '2026-09-25')).toBe('2026-10-15');
    // Lands exactly on today: stays put (the loop condition is strictly less-than).
    expect(firstUpcoming('monthly', '2026-09-25', null, '2026-09-25')).toBe('2026-09-25');
  });

  it('walks a semimonthly anchor forward using both days', () => {
    expect(firstUpcoming('semimonthly', '2026-09-05', [5, 20], '2026-09-25')).toBe('2026-10-05');
  });

  const rule = (over: Partial<ManualRule> = {}): ManualRule => ({
    cadence: 'monthly',
    anchorDays: null,
    expectedAmountCents: 106_054,
    nextExpectedDate: '2026-10-01',
    ...over,
  });

  it('stays active and unchanged with no confirming charge yet, before the grace period', () => {
    expect(advanceManualRule(rule(), [], '2026-10-02')).toEqual({
      nextExpectedDate: '2026-10-01',
      status: 'active',
    });
  });

  it('goes broken 3+ days late with nothing confirming it', () => {
    expect(advanceManualRule(rule(), [], '2026-10-04')).toEqual({
      nextExpectedDate: '2026-10-01',
      status: 'broken',
    });
  });

  it('a confirming charge rolls the due date to the next month and stays active', () => {
    const occ: Occurrence[] = [{ date: '2026-10-01', amountCents: 106_054, categoryId: null }];
    expect(advanceManualRule(rule(), occ, '2026-10-02')).toEqual({
      nextExpectedDate: '2026-11-01',
      status: 'active',
    });
  });

  it('a charge outside the amount tolerance does not confirm it', () => {
    const occ: Occurrence[] = [{ date: '2026-10-01', amountCents: 200_000, categoryId: null }];
    expect(advanceManualRule(rule(), occ, '2026-10-04').status).toBe('broken');
  });

  it('a charge with the wrong sign does not confirm it', () => {
    const occ: Occurrence[] = [{ date: '2026-10-01', amountCents: -106_054, categoryId: null }];
    expect(advanceManualRule(rule(), occ, '2026-10-04').status).toBe('broken');
  });

  it('a charge more than a week before a monthly due date is too early to confirm it', () => {
    const occ: Occurrence[] = [{ date: '2026-09-20', amountCents: 106_054, categoryId: null }];
    expect(advanceManualRule(rule(), occ, '2026-10-04').status).toBe('broken');
  });

  it('rolls through more than one cycle when several charges confirm in order', () => {
    const occ: Occurrence[] = [
      { date: '2026-10-01', amountCents: 106_054, categoryId: null },
      { date: '2026-11-02', amountCents: 106_054, categoryId: null },
    ];
    // The late Nov 2 charge paid the Nov 1 due date; December stays on the 1st.
    expect(advanceManualRule(rule(), occ, '2026-11-03')).toEqual({
      nextExpectedDate: '2026-12-01',
      status: 'active',
    });
  });

  it('ignores a stray extra charge once a later one has already confirmed the cycle', () => {
    // The 10-05 charge is within tolerance of the *original* due date but stale once 10-01
    // (sorted first) has already rolled `next` forward to 11-01 — it must be skipped, not
    // treated as confirming yet another cycle.
    const occ: Occurrence[] = [
      { date: '2026-10-01', amountCents: 106_054, categoryId: null },
      { date: '2026-10-05', amountCents: 106_054, categoryId: null },
      { date: '2026-11-01', amountCents: 106_054, categoryId: null },
    ];
    expect(advanceManualRule(rule(), occ, '2026-11-02')).toEqual({
      nextExpectedDate: '2026-12-01',
      status: 'active',
    });
  });

  it('a paycheck that lands early moves on to the next payday, not back to the one it paid', () => {
    // Caleb, 2026-10-04: paid Friday Oct 2 for Monday Oct 5; Surplus still expected it on the 5th.
    const occ: Occurrence[] = [{ date: '2026-10-02', amountCents: -289_039, categoryId: null }];
    const r = rule({
      cadence: 'semimonthly',
      anchorDays: [5, 20],
      nextExpectedDate: '2026-10-05',
      expectedAmountCents: -289_038,
    });
    expect(advanceManualRule(r, occ, '2026-10-03')).toEqual({
      nextExpectedDate: '2026-10-20',
      status: 'active',
    });
  });

  it('a bill paid up to a week early pays that month', () => {
    const occ: Occurrence[] = [{ date: '2026-09-24', amountCents: 106_054, categoryId: null }];
    expect(advanceManualRule(rule(), occ, '2026-09-25')).toEqual({
      nextExpectedDate: '2026-11-01',
      status: 'active',
    });
  });

  it('a weekly charge only matches up to 3 days early, never the week before', () => {
    const r = rule({ cadence: 'weekly', nextExpectedDate: '2026-10-08' });
    const at = (date: string) =>
      advanceManualRule(r, [{ date, amountCents: 106_054, categoryId: null }], '2026-10-06')
        .nextExpectedDate;
    expect(at('2026-10-05')).toBe('2026-10-15');
    expect(at('2026-10-04')).toBe('2026-10-08');
  });

  it('a bill that posts late keeps its due day', () => {
    // Due Friday Oct 2, posted Monday Oct 5: November's is still due the 2nd, not the 5th.
    const occ: Occurrence[] = [{ date: '2026-10-05', amountCents: 106_054, categoryId: null }];
    const r = rule({ nextExpectedDate: '2026-10-02' });
    expect(advanceManualRule(r, occ, '2026-10-06').nextExpectedDate).toBe('2026-11-02');
  });

  it('an early monthly charge keeps the scheduled day', () => {
    const occ: Occurrence[] = [{ date: '2026-09-29', amountCents: 106_054, categoryId: null }];
    expect(advanceManualRule(rule(), occ, '2026-09-30').nextExpectedDate).toBe('2026-11-01');
  });

  it('advances a semimonthly manual rule from its confirming charge', () => {
    const occ: Occurrence[] = [{ date: '2026-10-05', amountCents: 1_000, categoryId: null }];
    const r = rule({
      cadence: 'semimonthly',
      anchorDays: [5, 20],
      nextExpectedDate: '2026-10-05',
      expectedAmountCents: 1_000,
    });
    expect(advanceManualRule(r, occ, '2026-10-06')).toEqual({
      nextExpectedDate: '2026-10-20',
      status: 'active',
    });
  });
});

describe('last day of the month (day 31 pins a rule to the month end)', () => {
  it('a monthly rule pinned to 31 lands on each month end', () => {
    const series = {
      cadence: 'monthly' as const,
      expectedAmountCents: -100_000,
      lastDate: '2026-01-31',
      nextExpectedDate: '2026-01-31',
      status: 'active' as const,
      categoryId: null,
      occurrences: 0,
      anchorDays: [31, 31] as [number, number],
    };
    expect(projectOccurrences(series, 3).map((o) => o.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('firstUpcoming and advanceManualRule keep the pinned day', () => {
    expect(firstUpcoming('monthly', '2026-10-31', [31, 31], '2026-11-05')).toBe('2026-11-30');
    const rule: ManualRule = {
      cadence: 'monthly',
      anchorDays: [31, 31],
      expectedAmountCents: 100_000,
      nextExpectedDate: '2026-02-28',
    };
    const occ: Occurrence[] = [{ date: '2026-02-27', amountCents: 100_000, categoryId: null }];
    expect(advanceManualRule(rule, occ, '2026-03-01').nextExpectedDate).toBe('2026-03-31');
  });

  it('a twice-a-month rule on the 15th and the last day shifts weekends back', () => {
    expect(nextSemimonthlyDate('2026-01-15', [15, 31])).toBe('2026-01-30');
    expect(nextSemimonthlyDate('2026-01-30', [15, 31])).toBe('2026-02-13');
  });
});

describe('nextScheduled', () => {
  it('twice a month: the next of the two days, weekend-shifted, never before today', () => {
    expect(nextScheduled('semimonthly', '2026-10-01', [15, 31], '2026-10-01')).toBe('2026-10-15');
    expect(nextScheduled('semimonthly', '2026-10-01', [1, 15], '2026-10-01')).toBe('2026-10-01');
  });
  it('monthly pinned to a day, including the last day', () => {
    expect(nextScheduled('monthly', '2026-10-01', [31, 31], '2026-10-01')).toBe('2026-10-31');
    expect(nextScheduled('monthly', '2026-10-01', [15, 15], '2026-10-20')).toBe('2026-11-15');
  });
  it('anything else walks from the given date', () => {
    expect(nextScheduled('weekly', '2026-09-24', null, '2026-10-01')).toBe('2026-10-01');
    expect(nextScheduled('monthly', '2026-09-01', null, '2026-09-25')).toBe('2026-10-01');
  });
});
