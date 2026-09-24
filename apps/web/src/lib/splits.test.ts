import { describe, expect, it } from 'vitest';
import { splitProblem, withRemainder } from './splits';

describe('split editor (SPEC §3.5)', () => {
  it('auto-computes the last row so the set sums exactly', () => {
    const rows = withRemainder(8_437, [{ categoryId: 'home', amountCents: 2_999 }], 'kids');
    expect(rows).toEqual([
      { categoryId: 'home', amountCents: 2_999 },
      { categoryId: 'kids', amountCents: 5_438 },
    ]);
    expect(rows.reduce((n, r) => n + r.amountCents, 0)).toBe(8_437);
  });

  it('works for refunds (negative totals)', () => {
    expect(
      withRemainder(-1_000, [{ categoryId: 'a', amountCents: -400 }], 'b').at(-1)?.amountCents,
    ).toBe(-600);
  });

  it('names what blocks saving', () => {
    expect(splitProblem(1_000, [{ categoryId: '', amountCents: 1_000 }])).toBe('missing_category');
    expect(
      splitProblem(1_000, [
        { categoryId: 'a', amountCents: 0 },
        { categoryId: 'b', amountCents: 1_000 },
      ]),
    ).toBe('zero_row');
    expect(
      splitProblem(1_000, [
        { categoryId: 'a', amountCents: 1_500 },
        { categoryId: 'b', amountCents: -500 },
      ]),
    ).toBe('remainder_flips_sign');
    expect(
      splitProblem(1_000, [
        { categoryId: 'a', amountCents: 400 },
        { categoryId: 'b', amountCents: 600 },
      ]),
    ).toBeNull();
    expect(
      splitProblem(0, [
        { categoryId: 'a', amountCents: 5 },
        { categoryId: 'b', amountCents: -5 },
      ]),
    ).toBeNull();
  });
});
