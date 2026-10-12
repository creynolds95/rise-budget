import { describe, expect, it } from 'vitest';
import { compareSeries } from './whatif';

describe('compareSeries', () => {
  it('pads the shorter run with zero and ends on the later finish', () => {
    const r = compareSeries([300, 200, 100, 0], [300, 100, 0], '2026-10');
    expect(r.current).toEqual([300, 200, 100, 0]);
    expect(r.scenario).toEqual([300, 100, 0, 0]);
    expect(r.labels).toHaveLength(r.slots);
    expect(r.labels[0]).toBe('Oct 2026');
  });

  it('thins long runs to about 60 points but keeps the last month', () => {
    const long = Array.from({ length: 361 }, (_, i) => 360 - i);
    const r = compareSeries(long, long, '2026-10');
    expect(r.slots).toBeLessThanOrEqual(62);
    expect(r.current.at(-1)).toBe(0);
  });
});
