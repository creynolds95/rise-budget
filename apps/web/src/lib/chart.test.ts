import { describe, expect, it } from 'vitest';
import { allowsPercentChange, lineSegments, rangeStart } from './chart';

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

  it('handles empty, single and flat series', () => {
    expect(lineSegments([], 10, 10)).toEqual([]);
    expect(lineSegments([{ cents: 5, inferred: true }], 10, 10, 0)).toEqual([
      { dashed: true, points: [[5, 10]] },
    ]);
    expect(
      lineSegments(
        [
          { cents: 5, inferred: false },
          { cents: 5, inferred: false },
        ],
        10,
        10,
        0,
      )[0]?.points,
    ).toEqual([
      [0, 10],
      [10, 10],
    ]);
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
