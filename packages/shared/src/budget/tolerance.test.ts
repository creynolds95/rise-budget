import { describe, expect, it } from 'vitest';
import { applyTolerance } from './tolerance';

const t = (plannedCents: number, spentCents: number, carried = 0) =>
  applyTolerance({ plannedCents, availableCents: plannedCents + carried, spentCents });

describe('rounding tolerance', () => {
  it('over by under $0.50 on a whole-dollar plan is on budget', () => {
    expect(t(1600, 1623)).toEqual({ onBudget: true, remainingCents: 0, spentCents: 1600 });
  });
  it('under by under $0.50 is on budget too', () => {
    expect(t(1600, 1577)).toEqual({ onBudget: true, remainingCents: 0, spentCents: 1600 });
  });
  it('exactly $0.50 either way is on budget', () => {
    expect(t(1600, 1650).onBudget).toBe(true);
    expect(t(1600, 1550).onBudget).toBe(true);
  });
  it('$0.51 over behaves as before', () => {
    expect(t(1600, 1651)).toEqual({ onBudget: false, remainingCents: -51, spentCents: 1651 });
  });
  it('a plan with cents gets no tolerance', () => {
    expect(t(1650, 1670).remainingCents).toBe(-20);
  });
  it('a zero plan gets no tolerance', () => {
    expect(t(0, 20).remainingCents).toBe(-20);
  });
  it('measures against available, so carry counts', () => {
    expect(t(1600, 1623, -60).remainingCents).toBe(-83);
    expect(t(1600, 1600, 23).onBudget).toBe(true);
  });
});
