import { describe, expect, it } from 'vitest';
import { allocateRefund, refundFits, suggestRefundOriginals, type RefundTxn } from './refunds';

const t = (id: string, postedAt: string, amountCents: number, isTransfer = false): RefundTxn => ({
  id,
  accountId: 'a',
  postedAt,
  amountCents,
  isTransfer,
});
const buy = t('buy', '2026-09-01', 10_000);

describe('refundFits', () => {
  it('accepts a full or partial refund on or after the purchase', () => {
    expect(refundFits(t('r', '2026-09-10', -10_000), buy, 0)).toBe(true);
    expect(refundFits(t('r', '2026-09-01', -2_500), buy, 0)).toBe(true);
  });
  it('rejects wrong shapes', () => {
    expect(refundFits(buy, buy, 0)).toBe(false);
    expect(refundFits(t('r', '2026-09-10', -100, true), buy, 0)).toBe(false);
    expect(refundFits(t('r', '2026-09-10', -100), t('x', '2026-09-01', 100, true), 0)).toBe(false);
    expect(refundFits(t('r', '2026-09-10', 100), buy, 0)).toBe(false);
    expect(refundFits(t('r', '2026-09-10', -100), t('x', '2026-09-01', -100), 0)).toBe(false);
    expect(refundFits(t('r', '2026-08-31', -100), buy, 0)).toBe(false);
  });
  it('cannot refund more than is left', () => {
    expect(refundFits(t('r', '2026-09-10', -10_001), buy, 0)).toBe(false);
    expect(refundFits(t('r', '2026-09-10', -4_000), buy, 6_000)).toBe(true);
    expect(refundFits(t('r', '2026-09-10', -4_001), buy, 6_000)).toBe(false);
  });
});

describe('suggestRefundOriginals', () => {
  it('ranks exact amount first, then nearest date, and drops old or ill-fitting ones', () => {
    const refund = t('r', '2026-09-20', -5_000);
    const pool = [
      t('far', '2026-09-01', 5_000),
      t('near-big', '2026-09-18', 9_000),
      t('near-exact', '2026-09-18', 5_000),
      t('ancient', '2026-05-01', 5_000),
      t('tie-b', '2026-09-01', 5_000),
      t('small', '2026-09-18', 100),
    ];
    expect(suggestRefundOriginals(refund, pool, () => 0).map((o) => o.id)).toEqual([
      'near-exact',
      'far',
      'tie-b',
      'near-big',
    ]);
  });
});

describe('allocateRefund', () => {
  it('splits in proportion and sums exactly', () => {
    const splits = [
      { categoryId: 'a', amountCents: 6_000 },
      { categoryId: 'b', amountCents: 4_000 },
    ];
    expect(allocateRefund(-10_000, splits)).toEqual([
      { categoryId: 'a', amountCents: -6_000 },
      { categoryId: 'b', amountCents: -4_000 },
    ]);
    const odd = allocateRefund(-100, [
      { categoryId: 'a', amountCents: 1 },
      { categoryId: 'b', amountCents: 1 },
      { categoryId: 'c', amountCents: 1 },
    ]);
    expect(odd.reduce((s, x) => s + x.amountCents, 0)).toBe(-100);
    expect(odd.map((x) => x.amountCents)).toEqual([-34, -33, -33]);
  });
  it('is exact integer maths at any size (largest remainder, ties to the earlier split)', () => {
    // Shares of 1/3 each of an odd refund: the float version's remainders were 0.333…, the
    // integer one compares exact remainders; same answer, no float in sight.
    const big = allocateRefund(-9_007_199_254_740, [
      { categoryId: 'a', amountCents: 3_000_000_000_001 },
      { categoryId: 'b', amountCents: 3_000_000_000_001 },
      { categoryId: 'c', amountCents: 3_000_000_000_001 },
    ]);
    expect(big.map((x) => x.amountCents)).toEqual([
      -3_002_399_751_580, -3_002_399_751_580, -3_002_399_751_580,
    ]);
    expect(big.reduce((s, x) => s + x.amountCents, 0)).toBe(-9_007_199_254_740);
  });
  it('a negative split (a discount line) gets no share; the rest share by size', () => {
    expect(
      allocateRefund(-1_000, [
        { categoryId: 'a', amountCents: 3_000 },
        { categoryId: 'disc', amountCents: -500 },
        { categoryId: 'b', amountCents: 1_000 },
      ]).map((x) => x.amountCents),
    ).toEqual([-750, 0, -250]);
  });
  it('a single split takes all of it', () => {
    expect(allocateRefund(-250, [{ categoryId: 'a', amountCents: 999 }])).toEqual([
      { categoryId: 'a', amountCents: -250 },
    ]);
  });
});
