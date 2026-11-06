import { describe, expect, it } from 'vitest';
import { isLowRemaining } from './lowRemaining';

describe('isLowRemaining', () => {
  it('warns at or under 10% of planned', () => {
    expect(isLowRemaining(5000, 50000)).toBe(true); // exactly 10%
    expect(isLowRemaining(200, 1600)).toBe(false); // 12.5%
    expect(isLowRemaining(100, 1600)).toBe(true); // 6.25%
  });
  it('scales with the budget, not a fixed amount', () => {
    expect(isLowRemaining(1500, 200000)).toBe(true);
    expect(isLowRemaining(1500, 5000)).toBe(false);
  });
  it('never warns at zero, over, or with no plan', () => {
    expect(isLowRemaining(0, 10000)).toBe(false);
    expect(isLowRemaining(-100, 10000)).toBe(false);
    expect(isLowRemaining(100, 0)).toBe(false);
  });
});
