import { describe, expect, it } from 'vitest';
import { chargeFlags, seriesRadar, type FlagCandidate } from './radar';

const o = (date: string, amountCents: number) => ({ date, amountCents, categoryId: null });

describe('seriesRadar', () => {
  it('notices a price that went up, for 60 days', () => {
    const occ = [o('2026-07-03', 1_599), o('2026-08-03', 1_599), o('2026-09-03', 1_799)];
    expect(seriesRadar(occ, 'monthly', '2026-10-08')).toEqual({
      previousAmountCents: 1_599,
      priceChangedOn: '2026-09-03',
      doubleChargedOn: null,
    });
    expect(seriesRadar(occ, 'monthly', '2026-11-03').priceChangedOn).toBeNull();
  });

  it('ignores a drop, a wobble inside 5%, and a single charge', () => {
    const t = '2026-10-08';
    expect(
      seriesRadar([o('2026-09-03', 1_799), o('2026-10-03', 1_599)], 'monthly', t),
    ).toMatchObject({ priceChangedOn: null });
    expect(
      seriesRadar([o('2026-09-03', 10_000), o('2026-10-03', 10_400)], 'monthly', t),
    ).toMatchObject({ priceChangedOn: null });
    expect(seriesRadar([o('2026-10-03', 999)], 'monthly', t)).toMatchObject({
      priceChangedOn: null,
      doubleChargedOn: null,
    });
  });

  it('notices two same-size charges inside one cycle, but never weekly', () => {
    const occ = [o('2026-08-03', 1_599), o('2026-09-03', 1_599), o('2026-09-05', 1_599)];
    expect(seriesRadar(occ, 'monthly', '2026-10-01').doubleChargedOn).toBe('2026-09-05');
    expect(seriesRadar(occ, 'monthly', '2026-12-01').doubleChargedOn).toBeNull();
    expect(seriesRadar(occ, 'weekly', '2026-10-01').doubleChargedOn).toBeNull();
    const apart = [o('2026-09-03', 1_599), o('2026-09-05', 2_599)];
    expect(seriesRadar(apart, 'monthly', '2026-10-01').doubleChargedOn).toBeNull();
  });
});

describe('chargeFlags', () => {
  let n = 0;
  const r = (date: string, amountCents: number, more: Partial<FlagCandidate> = {}) => ({
    id: `r${++n}`,
    date,
    amountCents,
    accountId: 'a',
    needsReview: false,
    ...more,
  });
  const today = '2026-10-08';

  it('flags the second of two same charges at one account within two days', () => {
    const a = r('2026-10-05', 4_250, { needsReview: true });
    const b = r('2026-10-06', 4_250, { needsReview: true });
    const flags = chargeFlags([b, a], today);
    expect(flags.get(b.id)).toBe('duplicate');
    expect(flags.has(a.id)).toBe(false);
  });

  it('leaves small repeats, other accounts and old rows alone', () => {
    const coffee = [r('2026-10-05', 550), r('2026-10-05', 550, { needsReview: true })];
    expect(chargeFlags(coffee, today).size).toBe(0);
    const other = [
      r('2026-10-05', 4_250),
      r('2026-10-06', 4_250, { accountId: 'b', needsReview: true }),
    ];
    expect(chargeFlags(other, today).get(other[1]?.id ?? '')).toBeUndefined();
    const old = [r('2026-09-01', 4_250), r('2026-09-02', 4_250, { needsReview: true })];
    expect(chargeFlags(old, today).size).toBe(0);
  });

  it('flags a charge far above the usual', () => {
    const hist = [r('2026-07-01', 4_000), r('2026-08-01', 4_500), r('2026-09-01', 5_000)];
    const big = r('2026-10-07', 16_000, { needsReview: true });
    expect(chargeFlags([...hist, big], today).get(big.id)).toBe('unusual');
    const ok = r('2026-10-07', 9_000, { needsReview: true });
    expect(chargeFlags([...hist, ok], today).size).toBe(0);
    const few = r('2026-10-07', 16_000, { needsReview: true });
    expect(chargeFlags([hist[0] as FlagCandidate, few], today).size).toBe(0);
  });

  it('flags a large first charge at a new merchant, never money in', () => {
    const first = r('2026-10-07', 45_000, { needsReview: true });
    expect(chargeFlags([first], today).get(first.id)).toBe('first_time');
    expect(chargeFlags([r('2026-10-07', 4_500, { needsReview: true })], today).size).toBe(0);
    expect(chargeFlags([r('2026-10-07', -45_000, { needsReview: true })], today).size).toBe(0);
  });
});

describe('seriesRadar with the new price twice', () => {
  it('dates the change from the first charge at the new price', () => {
    const occ = [o('2026-08-03', 1_599), o('2026-09-03', 1_799), o('2026-09-05', 1_799)];
    expect(seriesRadar(occ, 'monthly', '2026-09-20')).toEqual({
      previousAmountCents: 1_599,
      priceChangedOn: '2026-09-03',
      doubleChargedOn: '2026-09-05',
    });
  });
});
