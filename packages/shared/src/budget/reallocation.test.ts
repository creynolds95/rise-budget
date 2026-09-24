import { describe, expect, it } from 'vitest';
import {
  buildReallocation,
  planAllocationChange,
  rankFundingCandidates,
  slack,
} from './reallocation';
import { slackCat } from './test-helpers';

const mid = { elapsedDays: 15, totalDays: 30 };

describe('slack', () => {
  it('linear: remaining − available × (1 − pace)', () => {
    // available 300, spent 100 → remaining 200; projected 150 → slack 50
    expect(
      slack(slackCat({ categoryId: 'eat', plannedCents: 30000, spentCents: 10000 }), mid),
    ).toBe(5000);
  });
  it('fixed, unposted: remaining − (planned − spent)', () => {
    expect(
      slack(
        slackCat({
          categoryId: 'rent',
          spendShape: 'fixed',
          carriedInCents: 2000,
          plannedCents: 150000,
        }),
        mid,
      ),
    ).toBe(2000);
  });
  it('fixed, posted: all remaining is slack', () => {
    expect(
      slack(
        slackCat({
          categoryId: 'rent',
          spendShape: 'fixed',
          plannedCents: 150000,
          spentCents: 145000,
          billPosted: true,
        }),
        mid,
      ),
    ).toBe(5000);
  });
});

describe('rankFundingCandidates', () => {
  it('ranks by slack desc, ties by id, excludes target and slack ≤ 0', () => {
    const fixedPosted = (id: string, rem: number) =>
      slackCat({ categoryId: id, spendShape: 'fixed', plannedCents: rem, billPosted: true });
    const out = rankFundingCandidates(
      'target',
      [
        fixedPosted('c', 500),
        fixedPosted('a', 500),
        fixedPosted('target', 9999),
        fixedPosted('big', 800),
        fixedPosted('b', 500),
        fixedPosted('zero', 0),
      ],
      mid,
    );
    expect(out).toEqual([
      { categoryId: 'big', slackCents: 800 },
      { categoryId: 'a', slackCents: 500 },
      { categoryId: 'b', slackCents: 500 },
      { categoryId: 'c', slackCents: 500 },
    ]);
  });
});

describe('planAllocationChange', () => {
  it('applies decreases and within-pool raises directly', () => {
    expect(
      planAllocationChange(
        { targetCategoryId: 't', oldPlannedCents: 500, newPlannedCents: 300, poolCents: 0 },
        [],
        mid,
      ),
    ).toEqual({
      kind: 'direct',
      deltaCents: -200,
    });
    expect(
      planAllocationChange(
        { targetCategoryId: 't', oldPlannedCents: 0, newPlannedCents: 1000, poolCents: 1000 },
        [],
        mid,
      ),
    ).toEqual({
      kind: 'direct',
      deltaCents: 1000,
    });
  });
  it('a negative pool contributes nothing', () => {
    expect(
      planAllocationChange(
        { targetCategoryId: 't', oldPlannedCents: 0, newPlannedCents: 1000, poolCents: -500 },
        [],
        mid,
      ),
    ).toMatchObject({ kind: 'needs_funding', shortfallCents: 1000 });
  });
});

describe('buildReallocation', () => {
  const planned = new Map([
    ['eat', 30000],
    ['fun', 10000],
  ]);
  const raise = {
    targetCategoryId: 'gas',
    oldPlannedCents: 20000,
    newPlannedCents: 30000,
    poolCents: 4000,
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
