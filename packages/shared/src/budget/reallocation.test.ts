import { describe, expect, it } from 'vitest';
import { buildReallocation } from './reallocation';

describe('buildReallocation', () => {
  const planned = new Map([
    ['eat', 30000],
    ['fun', 10000],
  ]);
  const raise = {
    targetCategoryId: 'gas',
    oldPlannedCents: 20000,
    newPlannedCents: 30000,
  };

  it('logs a decrease as money returned to the pool', () => {
    expect(buildReallocation({ ...raise, newPlannedCents: 15000 }, [], planned)).toEqual({
      ok: true,
      plannedDeltas: [{ categoryId: 'gas', deltaCents: -5000 }],
      rows: [{ fromCategoryId: 'gas', toCategoryId: null, amountCents: 5000 }],
    });
  });

  it('a no-op change writes nothing', () => {
    expect(buildReallocation({ ...raise, newPlannedCents: 20000 }, [], planned)).toEqual({
      ok: true,
      plannedDeltas: [],
      rows: [],
    });
  });

  it('funds from categories, then the pool', () => {
    expect(
      buildReallocation(raise, [{ fromCategoryId: 'eat', amountCents: 6000 }], planned),
    ).toEqual({
      ok: true,
      plannedDeltas: [
        { categoryId: 'gas', deltaCents: 10000 },
        { categoryId: 'eat', deltaCents: -6000 },
      ],
      rows: [
        { fromCategoryId: 'eat', toCategoryId: 'gas', amountCents: 6000 },
        { fromCategoryId: null, toCategoryId: 'gas', amountCents: 4000 },
      ],
    });
  });

  it('a raise past the pool still commits: the pool covers it and goes negative', () => {
    expect(buildReallocation(raise, [], planned)).toEqual({
      ok: true,
      plannedDeltas: [{ categoryId: 'gas', deltaCents: 10000 }],
      rows: [{ fromCategoryId: null, toCategoryId: 'gas', amountCents: 10000 }],
    });
  });

  it('fully category-funded raises add no pool row', () => {
    const r = buildReallocation(raise, [{ fromCategoryId: 'eat', amountCents: 10000 }], planned);
    expect(r.ok && r.rows).toEqual([
      { fromCategoryId: 'eat', toCategoryId: 'gas', amountCents: 10000 },
    ]);
  });

  it.each([
    [
      'decrease with funding',
      { ...raise, newPlannedCents: 10000 },
      [{ fromCategoryId: 'eat', amountCents: 1 }],
    ],
    ['self-funding', raise, [{ fromCategoryId: 'gas', amountCents: 1 }]],
    [
      'duplicate source',
      raise,
      [
        { fromCategoryId: 'eat', amountCents: 1 },
        { fromCategoryId: 'eat', amountCents: 1 },
      ],
    ],
    ['non-positive amount', raise, [{ fromCategoryId: 'eat', amountCents: 0 }]],
    ['unknown source', raise, [{ fromCategoryId: 'nope', amountCents: 1 }]],
    ['more than planned', raise, [{ fromCategoryId: 'fun', amountCents: 10001 }]],
    ['more than the increase', raise, [{ fromCategoryId: 'eat', amountCents: 10001 }]],
  ])('rejects %s', (_label, change, funding) => {
    expect(buildReallocation(change, funding, planned)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FUNDING' },
    });
  });
});
