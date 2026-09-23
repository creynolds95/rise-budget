import { describe, expect, it } from 'vitest';
import { pool } from './pool';

describe('pool', () => {
  it('= expected income + returned surplus − Σ planned', () => {
    expect(
      pool({
        expectedIncomeCents: 500000,
        returnedSurplusPrevCents: 12000,
        plannedCents: [300000, 150000],
      }),
    ).toBe(62000);
  });

  it('a category-to-category move leaves the pool unchanged', () => {
    const before = pool({
      expectedIncomeCents: 500000,
      returnedSurplusPrevCents: 0,
      plannedCents: [30000, 60000],
    });
    const after = pool({
      expectedIncomeCents: 500000,
      returnedSurplusPrevCents: 0,
      plannedCents: [40000, 50000],
    });
    expect(after).toBe(before);
  });

  it('goes negative when over-allocated, never clamped', () => {
    expect(
      pool({ expectedIncomeCents: 100000, returnedSurplusPrevCents: 0, plannedCents: [124000] }),
    ).toBe(-24000);
  });
});
