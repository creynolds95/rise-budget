import { describe, expect, it } from 'vitest';
import { planStats, upToDollar } from './plan';

describe('planStats', () => {
  it('takes the six months before the one being planned', () => {
    const s = planStats(
      [
        { periodId: '2026-02', spentCents: 99_900 },
        { periodId: '2026-03', spentCents: 15_400 },
        { periodId: '2026-08', spentCents: 22_800 },
        { periodId: '2026-09', spentCents: 5_000 },
      ],
      '2026-09',
    );
    expect(s.bars.map((b) => b.periodId)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
    expect(s.lastMonthCents).toBe(22_800);
    expect(s.averageCents).toBe(Math.round((15_400 + 22_800) / 6));
  });

  it('averages only since spending began, so a new category is not diluted', () => {
    const s = planStats(
      [
        { periodId: '2026-07', spentCents: 10_000 },
        { periodId: '2026-08', spentCents: 20_000 },
      ],
      '2026-09',
    );
    expect(s.averageCents).toBe(15_000);
  });

  it('has no average without history', () => {
    expect(planStats([], '2026-09')).toMatchObject({ lastMonthCents: 0, averageCents: null });
  });
});

describe('upToDollar', () => {
  it('rounds up to whole dollars and never below zero', () => {
    expect(upToDollar(11_701)).toBe(11_800);
    expect(upToDollar(11_700)).toBe(11_700);
    expect(upToDollar(-500)).toBe(0);
  });
});
