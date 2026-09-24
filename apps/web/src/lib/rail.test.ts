import { describe, expect, it } from 'vitest';
import { railGeometry } from './rail';

const half = { elapsedDays: 15, totalDays: 30 };

describe('rail geometry (DESIGN-SYSTEM.md §6)', () => {
  it('no carry: allocated is the whole rail, spent fills from the left, tick at pace', () => {
    const g = railGeometry({
      carriedInCents: 0,
      plannedCents: 30_000,
      spentCents: 7_500,
      tick: half,
    });
    expect(g.carried).toBeNull();
    expect(g.allocated).toEqual({ start: 0, width: 100 });
    expect(g.spent).toEqual({ start: 0, width: 25 });
    expect(g.over).toBeNull();
    expect(g.tick).toBe(50);
  });

  it('negative carry visibly starts underwater; spending starts after the debt', () => {
    // −$40 carried, $300 planned → $260 available (the SPEC example).
    const g = railGeometry({
      carriedInCents: -4_000,
      plannedCents: 30_000,
      spentCents: 18_200,
      tick: half,
    });
    expect(g.carried).toMatchObject({ tone: 'deficit', start: 0 });
    expect(g.carried?.width).toBeCloseTo(13.33, 2);
    expect(g.spent.start).toBeCloseTo(13.33, 2);
    expect(g.spent.start + g.spent.width).toBeCloseTo((22_200 / 30_000) * 100, 6);
    expect(g.allocated.start + g.allocated.width).toBe(100);
    expect(g.tick).toBeCloseTo(((4_000 + 13_000) / 30_000) * 100, 6);
  });

  it('positive carry is a sage segment ahead of allocated', () => {
    const g = railGeometry({
      carriedInCents: 5_000,
      plannedCents: 15_000,
      spentCents: 0,
      tick: null,
    });
    expect(g.carried).toEqual({ start: 0, width: 25, tone: 'credit' });
    expect(g.allocated).toEqual({ start: 25, width: 75 });
    expect(g.tick).toBeNull();
  });

  it('overspend turns clay past available, and the rail rescales', () => {
    const g = railGeometry({
      carriedInCents: 0,
      plannedCents: 10_000,
      spentCents: 12_500,
      tick: half,
    });
    expect(g.spent).toEqual({ start: 0, width: 80 });
    expect(g.over).toEqual({ start: 80, width: 20 });
  });

  it('a deficit bigger than the plan: nothing available, every dollar spent is over', () => {
    const g = railGeometry({
      carriedInCents: -20_000,
      plannedCents: 10_000,
      spentCents: 5_000,
      tick: half,
    });
    expect(g.allocated.width).toBe(0);
    expect(g.spent.width).toBe(0);
    expect(g.over).toEqual({ start: 80, width: 20 });
    expect(g.tick).toBeNull();
  });

  it('empty category and refunds render without dividing by zero', () => {
    const g = railGeometry({ carriedInCents: 0, plannedCents: 0, spentCents: -500, tick: half });
    expect(g.spent.width).toBe(0);
    expect(g.allocated.width).toBe(0);
    expect(
      railGeometry({
        carriedInCents: 0,
        plannedCents: 100,
        spentCents: 0,
        tick: { elapsedDays: 0, totalDays: 0 },
      }).tick,
    ).toBeNull();
  });
});
