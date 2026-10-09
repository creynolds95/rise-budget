import { describe, expect, it } from 'vitest';
import { dailySeries, surplusTone, tooltipLines } from './surplus';

describe('surplus', () => {
  it('green above zero, clay below, ink at zero', () => {
    expect(surplusTone(1)).toBe('in');
    expect(surplusTone(-1)).toBe('over');
    expect(surplusTone(0)).toBe('ink');
  });
  const pts = [
    { date: '2026-10-09', balanceCents: 100000, label: 'Today' },
    { date: '2026-10-10', balanceCents: 90000, label: 'Rent' },
    { date: '2026-10-10', balanceCents: 85000, label: 'Water' },
    { date: '2026-10-12', balanceCents: 285000, label: 'Pay' },
  ];
  it('folds events into 14 end-of-day entries', () => {
    const d = dailySeries(pts);
    expect(d).toHaveLength(14);
    expect(d.map((x) => x.balanceCents)).toEqual([
      100000, 85000, 85000, 285000, 285000, 285000, 285000, 285000, 285000, 285000, 285000, 285000,
      285000, 285000,
    ]);
    expect(d.flatMap((x) => x.charges)).toEqual([
      { label: 'Rent', cents: -10000 },
      { label: 'Water', cents: -5000 },
    ]);
    expect(d.flatMap((x) => x.income)).toEqual([{ label: 'Pay', cents: 200000 }]);
  });
  it('no points, no days', () => {
    expect(dailySeries([])).toEqual([]);
  });
  it('tooltip caps at three lines and counts the rest', () => {
    const day = {
      date: 'x',
      balanceCents: 0,
      charges: [-1, -2, -3, -4].map((cents) => ({ label: 'c', cents })),
      income: [{ label: 'i', cents: 5 }],
    };
    expect(tooltipLines(day)).toMatchObject({ more: 2 });
    expect(tooltipLines(day).shown).toHaveLength(3);
    expect(tooltipLines({ ...day, charges: [], income: [] })).toEqual({ shown: [], more: 0 });
  });
});
