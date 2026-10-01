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
