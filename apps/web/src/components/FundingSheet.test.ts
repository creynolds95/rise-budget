import { describe, expect, it } from 'vitest';
import { draftFunding } from './FundingSheet';

describe('funding draft', () => {
  it('takes from the most slack first until covered', () => {
    const d = draftFunding({
      categoryId: 't',
      plannedCents: 0,
      shortfallCents: 7_000,
      candidates: [
        { categoryId: 'a', slackCents: 5_000 },
        { categoryId: 'b', slackCents: 4_000 },
        { categoryId: 'c', slackCents: 1_000 },
      ],
    });
    expect([...d]).toEqual([
      ['a', 5_000],
      ['b', 2_000],
    ]);
  });
});
