import { describe, expect, it } from 'vitest';
import { growthSeries, invRangeStart, signedPct } from './investments';

describe('investments', () => {
  it('range starts', () => {
    expect(invRangeStart('1W', '2026-10-01')).toBe('2026-09-24');
    expect(invRangeStart('1M', '2026-10-01')).toBe('2026-09-01');
    expect(invRangeStart('YTD', '2026-10-01')).toBe('2026-01-01');
    expect(invRangeStart('1Y', '2026-10-01')).toBe('2025-10-01');
    expect(invRangeStart('6M', '2026-10-01')).toBe('2026-04-01');
  });
  it('range starts clamp to the target month’s last day', () => {
    expect(invRangeStart('1M', '2027-03-31')).toBe('2027-02-28');
    expect(invRangeStart('3M', '2026-05-31')).toBe('2026-02-28');
    expect(invRangeStart('6M', '2026-08-31')).toBe('2026-02-28');
    expect(invRangeStart('1M', '2028-03-30')).toBe('2028-02-29');
    expect(invRangeStart('3M', '2026-01-15')).toBe('2025-10-15');
  });
  it('rebases both lines and forward-fills weekends', () => {
    const pts = [
      { date: '2026-09-04', balanceCents: 100_000 },
      { date: '2026-09-05', balanceCents: 110_000 },
    ];
    const sp = [
      { date: '2026-09-03', level: 400_000 },
      { date: '2026-09-04', level: 410_000 },
    ];
    const g = growthSeries(pts, sp, '2026-09-04');
    expect(g[0]).toEqual({ date: '2026-09-04', portfolio: 0, sp500: 0 });
    expect(g[1]?.portfolio).toBeCloseTo(10);
    expect(g[1]?.sp500).toBe(0);
  });
  it('an account joining is not growth: its day links on the accounts already there', () => {
    // A flat $100k, then a $50k account appears: still 0%, not +50%.
    const pts = [
      { date: '2026-09-01', balanceCents: 100_000_00, joinedCents: 0 },
      { date: '2026-09-02', balanceCents: 150_000_00, joinedCents: 50_000_00 },
      { date: '2026-09-03', balanceCents: 150_000_00, joinedCents: 0 },
      // Then the whole $150k gains 10%.
      { date: '2026-09-04', balanceCents: 165_000_00, joinedCents: 0 },
    ];
    const g = growthSeries(pts, null, '2026-09-01');
    expect(g.map((p) => p.portfolio)).toEqual([0, 0, 0, expect.closeTo(10, 9)]);
  });
  it('a joining day still counts the old accounts’ own move', () => {
    const pts = [
      { date: '2026-09-01', balanceCents: 100_000_00 },
      // The old $100k rose 1% the day a $50k account joined.
      { date: '2026-09-02', balanceCents: 151_000_00, joinedCents: 50_000_00 },
    ];
    expect(growthSeries(pts, null, '2026-09-01')[1]?.portfolio).toBeCloseTo(1, 9);
  });
  it('a day after an empty balance links flat instead of dividing by zero', () => {
    const pts = [
      { date: '2026-09-01', balanceCents: 100_00 },
      { date: '2026-09-02', balanceCents: 0 },
      { date: '2026-09-03', balanceCents: 50_00, joinedCents: 50_00 },
    ];
    expect(growthSeries(pts, null, '2026-09-01').map((p) => p.portfolio)).toEqual([0, -100, -100]);
  });
  it('handles no data, no index, and a late first close', () => {
    expect(growthSeries([], null, '2026-01-01')).toEqual([]);
    expect(
      growthSeries([{ date: '2026-09-04', balanceCents: 5 }], null, '2026-01-01')[0]?.sp500,
    ).toBeNull();
    const g = growthSeries(
      [{ date: '2026-09-04', balanceCents: 5 }],
      [{ date: '2026-09-05', level: 10 }],
      '2026-09-01',
    );
    expect(g[0]?.sp500).toBeNull();
    expect(signedPct(1.234)).toBe('+1.23%');
    expect(signedPct(-0.5)).toBe('−0.50%');
  });
});
