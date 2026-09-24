import { describe, expect, it } from 'vitest';
import { projectCashFlow, type CashEvent } from './project';

describe('cash-to-payday projection', () => {
  it('finds the lowest point and free-to-move above the cushion', () => {
    const events: CashEvent[] = [
      { date: '2026-09-27', cashDeltaCents: -180_000, label: 'Mortgage' },
      { date: '2026-10-05', cashDeltaCents: 310_000, label: 'Payday' },
    ];
    const p = projectCashFlow(200_000, '2026-09-25', 50_000, events);
    expect(p.points).toEqual([
      { date: '2026-09-25', balanceCents: 200_000, label: 'Today' },
      { date: '2026-09-27', balanceCents: 20_000, label: 'Mortgage' },
      { date: '2026-10-05', balanceCents: 330_000, label: 'Payday' },
    ]);
    expect(p.lowestPoint).toEqual({ date: '2026-09-27', balanceCents: 20_000, label: 'Mortgage' });
    expect(p.freeToMoveCents).toBe(0); // below the $500 cushion already
  });

  it("free to move is the lowest balance above the cushion, not today's balance", () => {
    const events: CashEvent[] = [{ date: '2026-10-03', cashDeltaCents: -150_000, label: 'Rent' }];
    const p = projectCashFlow(500_000, '2026-09-25', 50_000, events);
    expect(p.freeToMoveCents).toBe(300_000); // 500,000 - 150,000 - 50,000
  });

  it('ignores past events and events before today', () => {
    const events: CashEvent[] = [{ date: '2026-09-01', cashDeltaCents: -999_999, label: 'Old' }];
    const p = projectCashFlow(100_000, '2026-09-25', 0, events);
    expect(p.points).toHaveLength(1);
    expect(p.lowestPoint.balanceCents).toBe(100_000);
  });

  it('with no events, today is the only (and lowest) point', () => {
    const p = projectCashFlow(100_000, '2026-09-25', 20_000, []);
    expect(p.points).toEqual([{ date: '2026-09-25', balanceCents: 100_000, label: 'Today' }]);
    expect(p.freeToMoveCents).toBe(80_000);
  });
});
