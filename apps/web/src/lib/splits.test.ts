import { describe, expect, it } from 'vitest';
import { categoryPortion, splitEmojis, splitRows, splitProblem, withRemainder } from './splits';

describe('category portion of a split', () => {
  const splits = [
    { categoryId: 'home', amountCents: 2_999 },
    { categoryId: 'kids', amountCents: 5_438 },
  ];
  it('is the part filed to that category', () => {
    expect(categoryPortion(splits, 'home')).toBe(2_999);
    expect(categoryPortion(splits, 'kids')).toBe(5_438);
  });
  it('sums several rows in the same category', () => {
    expect(categoryPortion([...splits, { categoryId: 'home', amountCents: 100 }], 'home')).toBe(
      3_099,
    );
  });
  it('is null when the transaction is not split across categories', () => {
    expect(categoryPortion([{ categoryId: 'home', amountCents: 8_437 }], 'home')).toBeNull();
    expect(categoryPortion([], 'home')).toBeNull();
  });
});

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

describe('split row emojis', () => {
  const emoji = (id: string) => ({ car: '🚙', kid: '👱', home: '🏚️', none: null })[id as 'car'];
  const parts = (...ids: string[]) => ids.map((categoryId) => ({ categoryId }));
  it('lists each category emoji in split order', () => {
    expect(splitEmojis(parts('car', 'kid', 'home'), emoji)).toEqual(['🚙', '👱', '🏚️']);
  });
  it('dedupes and skips categories without an emoji', () => {
    expect(splitEmojis(parts('car', 'none', 'car', 'kid'), emoji)).toEqual(['🚙', '👱']);
  });
});

describe('split list rows', () => {
  const base = { id: 't1', isTransfer: false };
  const splits = [
    { categoryId: 'home', amountCents: 2_999 },
    { categoryId: 'kids', amountCents: 5_438 },
  ];
  it('lists a split once per category with its own amount', () => {
    const rows = splitRows({ ...base, splits }, 1);
    expect(rows.map((r) => r.part)).toEqual(splits);
    expect(rows.map((r) => r.key)).toEqual(['t1:home', 't1:kids']);
    expect(rows.every((r) => r.t.id === 't1')).toBe(true);
  });
  it('merges rows in the same category', () => {
    const rows = splitRows(
      { ...base, splits: [...splits, { categoryId: 'home', amountCents: 1 }] },
      1,
    );
    expect(rows[0]?.part?.amountCents).toBe(3_000);
  });
  it('leaves unsplit, transfer and spread transactions as one row', () => {
    expect(splitRows({ ...base, splits: splits.slice(0, 1) }, 1)).toHaveLength(1);
    expect(splitRows({ ...base, isTransfer: true, splits }, 1)).toHaveLength(1);
    expect(splitRows({ ...base, splits }, 3)).toHaveLength(1);
    expect(splitRows({ ...base, splits }, 1)[0]?.key).not.toBe('t1');
  });
});
