import { describe, expect, it } from 'vitest';
import { allowsPercentChange, lineSegments, rangeStart, sharedScalePaths, zeroY } from './chart';

describe('line segments', () => {
  it('splits measured and inferred runs; a step touching an inferred point is dashed', () => {
    const pts = [
      { cents: 0, inferred: false },
      { cents: 100, inferred: false },
      { cents: 200, inferred: true },
      { cents: 300, inferred: true },
      { cents: 400, inferred: false },
      { cents: 500, inferred: false },
    ];
    const segs = lineSegments(pts, 500, 100, 0);
    expect(segs.map((s) => [s.dashed, s.points.length])).toEqual([
      [false, 2],
      [true, 4],
      [false, 2],
    ]);
    expect(segs[0]?.points[0]).toEqual([0, 100]);
    expect(segs[2]?.points.at(-1)).toEqual([500, 0]);
  });

  it('handles empty, single and zero-flat series', () => {
    expect(lineSegments([], 10, 10)).toEqual([]);
    // Anchored at 0: a lone positive point sits at the top of the zero-to-value span.
    expect(lineSegments([{ cents: 5, inferred: true }], 10, 10, 0)).toEqual([
      { dashed: true, points: [[5, 0]] },
    ]);
    expect(
      lineSegments(
        [
          { cents: 0, inferred: false },
          { cents: 0, inferred: false },
        ],
        10,
        10,
        0,
      )[0]?.points,
    ).toEqual([
      [0, 5],
      [10, 5],
    ]);
  });

  it('anchors an all-negative series below the zero line, not spread across the whole chart', () => {
    const pts = [
      { cents: -3_000_00, inferred: false },
      { cents: -2_000_00, inferred: false },
    ];
    const segs = lineSegments(pts, 10, 10, 0);
    // Both points are well below 0, so both sit in the lower half of the chart.
    expect(segs[0]?.points[0]?.[1]).toBeGreaterThan(5);
    expect(segs[0]?.points.at(-1)?.[1]).toBeGreaterThan(5);
    // $0 is the top of an all-negative series' span — the line sits below it, visibly underwater.
    expect(zeroY(pts, 10, 0)).toBe(0);
  });
});

describe('ranges', () => {
  it('computes range starts, clamping month ends', () => {
    expect(rangeStart('1M', '2026-03-31')).toBe('2026-02-28');
    expect(rangeStart('3M', '2026-09-24')).toBe('2026-06-24');
    expect(rangeStart('6M', '2026-01-15')).toBe('2025-07-15');
    expect(rangeStart('YTD', '2026-09-24')).toBe('2026-01-01');
    expect(rangeStart('1Y', '2026-09-24')).toBe('2025-09-24');
    expect(rangeStart('ALL', '2026-09-24')).toBe('2023-09-24');
  });
  it('no percent change under three months', () => {
    expect(allowsPercentChange('1M')).toBe(false);
    expect(allowsPercentChange('3M')).toBe(true);
  });
});

describe('sharedScalePaths', () => {
  it('puts every series on one scale from zero to the overall max', () => {
    const [a, b] = sharedScalePaths(
      [
        [0, 50],
        [0, 50, 100],
      ],
      3,
      200,
      108,
    );
    expect(a?.points).toEqual([
      [0, 104],
      [100, 54],
    ]);
    expect(a?.last).toEqual([100, 54]);
    expect(b?.points.at(-1)).toEqual([200, 4]);
  });
  it('drops below the baseline when a refund makes a total negative', () => {
    const [s] = sharedScalePaths([[-100, 100]], 2, 10, 10, 0);
    expect(s?.points).toEqual([
      [0, 10],
      [10, 0],
    ]);
  });
  it('handles empty and flat input without dividing by zero', () => {
    expect(sharedScalePaths([[]], 30, 10, 10)).toEqual([{ points: [], last: null }]);
    expect(sharedScalePaths([[0]], 1, 10, 10, 0)).toEqual([{ points: [[5, 10]], last: [5, 10] }]);
  });
});
