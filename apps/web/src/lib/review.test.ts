import { describe, expect, it } from 'vitest';
import { chipsFor, confidentCount, groupQueue, transferOffer, type QueueItem } from './review';

let n = 0;
const txn = (p: Partial<QueueItem>): QueueItem => ({
  id: `t${++n}`,
  accountId: 'a1',
  postedAt: '2026-09-10',
  amountCents: 1_000,
  descriptorRaw: 'X',
  merchantNormalized: 'X',
  merchantDisplay: null,
  notes: null,
  isPending: false,
  isTransfer: false,
  transferPairId: null,
  reviewState: 'needs_review',
  suggestedCategoryId: null,
  suggestionConfidence: 0,
  source: 'simplefin',
  sourceId: null,
  splits: [],
  createdAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-10T00:00:00Z',
  topCategoryIds: [],
  ...p,
});

describe('review queue grouping (SPEC §8)', () => {
  it('groups by date, newest first, with per-day totals', () => {
    const days = groupQueue([
      txn({ postedAt: '2026-09-09', amountCents: 500 }),
      txn({ postedAt: '2026-09-10', amountCents: 1_200 }),
      txn({ postedAt: '2026-09-10', amountCents: -300 }),
    ]);
    expect(days.map((d) => [d.date, d.totalCents, d.rows.length])).toEqual([
      ['2026-09-10', 900, 2],
      ['2026-09-09', 500, 1],
    ]);
  });

  it('renders a linked transfer as one row and keeps it out of the total', () => {
    const out = txn({
      id: 'o',
      accountId: 'chk',
      amountCents: 25_000,
      isTransfer: true,
      transferPairId: 'i',
      postedAt: '2026-09-10',
    });
    const inn = txn({
      id: 'i',
      accountId: 'card',
      amountCents: -25_000,
      isTransfer: true,
      transferPairId: 'o',
      postedAt: '2026-09-11',
    });
    const days = groupQueue([inn, out]);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: '2026-09-11', totalCents: 0 });
    expect(days[0]?.rows[0]).toMatchObject({ kind: 'transfer', out: { id: 'o' }, in: { id: 'i' } });
  });

  it('shows a transfer leg alone when its partner is not waiting', () => {
    const [day] = groupQueue([txn({ isTransfer: true, transferPairId: 'gone', amountCents: 800 })]);
    expect(day?.rows[0]?.kind).toBe('txn');
    expect(day?.totalCents).toBe(0);
  });

  it('bands by confidence; no stored suggestion is never pre-filled (§4.5)', () => {
    const [day] = groupQueue([
      txn({ id: 'z3', suggestedCategoryId: 'c', suggestionConfidence: 0.95 }),
      txn({ id: 'z2', suggestedCategoryId: 'c', suggestionConfidence: 0.7 }),
      txn({ id: 'z1', suggestedCategoryId: null, suggestionConfidence: 0.99 }),
    ]);
    expect(day?.rows.map((r) => (r.kind === 'txn' ? r.band : r.kind))).toEqual([
      'confident',
      'guess',
      'none',
    ]);
  });

  it('counts only confident, non-transfer suggestions for Accept all', () => {
    expect(
      confidentCount([
        txn({ suggestedCategoryId: 'c', suggestionConfidence: 0.9 }),
        txn({ suggestedCategoryId: 'c', suggestionConfidence: 0.89 }),
        txn({ suggestedCategoryId: 'c', suggestionConfidence: 0.99, isTransfer: true }),
      ]),
    ).toBe(1);
  });
});

describe('one-tap chips before Rise has learned anything', () => {
  const kinds = new Map<string, 'income' | 'expense'>([
    ['food', 'expense'],
    ['gas', 'expense'],
    ['fun', 'expense'],
    ['home', 'expense'],
    ['kids', 'expense'],
    ['pay', 'income'],
  ]);
  const ctx = {
    kinds,
    ordered: ['food', 'gas', 'fun', 'home', 'kids', 'pay'],
    frequent: ['home', 'gas'],
  };
  const row = (p: Partial<QueueItem>) => txn({ topCategoryIds: [], ...p });

  it('fills from the merchant, then most-used, then display order', () => {
    expect(chipsFor(row({ topCategoryIds: ['fun'] }), ctx)).toEqual(['fun', 'home', 'gas', 'food']);
  });
  it('skips the pre-filled suggestion, unknown and duplicate ids', () => {
    expect(
      chipsFor(row({ topCategoryIds: ['gone', 'gas'], suggestedCategoryId: 'home' }), ctx),
    ).toEqual(['gas', 'food', 'fun', 'kids']);
  });
  it('money in leads with income categories', () => {
    expect(chipsFor(row({ amountCents: -245_000 }), ctx)[0]).toBe('pay');
  });
  it('fills with neither transfer-like categories nor the catch-all, unless the merchant uses them', () => {
    const quiet = new Set(['home', 'gas']);
    expect(chipsFor(row({}), { ...ctx, quiet })).toEqual(['food', 'fun', 'kids']);
    expect(chipsFor(row({ topCategoryIds: ['gas'] }), { ...ctx, quiet }, 2)).toEqual([
      'gas',
      'food',
    ]);
  });
  it('works with no history at all', () => {
    expect(chipsFor(row({}), { ...ctx, frequent: [] }, 2)).toEqual(['food', 'gas']);
  });
});

describe('transfer offer for a lone leg', () => {
  it('names card payments, from either side', () => {
    expect(transferOffer(txn({ descriptorRaw: 'APPLECARD GSBANK PAYMENT' }), 'depository')).toBe(
      'card_payment',
    );
    expect(
      transferOffer(
        txn({ descriptorRaw: 'AUTOMATIC PAYMENT - THANK YOU', amountCents: -500 }),
        'credit',
      ),
    ).toBe('card_payment');
  });
  it('offers a plain transfer between bank accounts', () => {
    expect(transferOffer(txn({ descriptorRaw: 'USAA FUNDS TRANSFER DB' }), 'depository')).toBe(
      'transfer',
    );
  });
  it('stays quiet on purchases, zero rows and rows already linked', () => {
    expect(transferOffer(txn({ descriptorRaw: 'KROGER #512' }), 'credit')).toBeNull();
    expect(
      transferOffer(txn({ descriptorRaw: 'PAYMENT', amountCents: 0 }), 'depository'),
    ).toBeNull();
    expect(
      transferOffer(txn({ descriptorRaw: 'PAYMENT', isTransfer: true }), 'depository'),
    ).toBeNull();
  });
});
