import { describe, expect, it } from 'vitest';
import { within5Pct } from './amount';

describe('within5Pct', () => {
  it('measures one charge against the amount it is expected to be', () => {
    expect(within5Pct(10500, 10000)).toBe(true);
    expect(within5Pct(9500, 10000)).toBe(true);
    expect(within5Pct(10501, 10000)).toBe(false);
    expect(within5Pct(9499, 10000)).toBe(false);
  });
  it('the expected amount is the yardstick', () => {
    expect(within5Pct(10526, 10000)).toBe(false); // 5.26% over
    expect(within5Pct(10000, 10526)).toBe(true); // 4.99% under
  });
  it('works on signed amounts as they are', () => {
    expect(within5Pct(-10500, -10000)).toBe(true);
    expect(within5Pct(-10600, -10000)).toBe(false);
    expect(within5Pct(0, 0)).toBe(true);
  });
});
