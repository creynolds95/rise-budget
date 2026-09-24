import { describe, expect, it } from 'vitest';
import {
  PENDING_DROP_DAYS,
  pendingMatches,
  planAccountSync,
  withinTolerance,
  type IncomingWithMerchant,
  type StoredTxn,
} from './pending';
import { detectTransfers, pairConfidence, type TransferCandidate } from './transfers';
import { similarity, trigrams } from './trigram';

const stored = (over: Partial<StoredTxn> = {}): StoredTxn => ({
  id: 'row-1',
  sourceId: 'sf-1',
  postedAt: '2026-09-10',
  amountCents: 5_000,
  descriptor: 'SHELL OIL 5741',
  merchant: 'Shell',
  isPending: false,
  dropped: false,
  ...over,
});

const inc = (over: Partial<IncomingWithMerchant> = {}): IncomingWithMerchant => ({
  sourceId: 'sf-1',
  postedAt: '2026-09-10',
  amountCents: 5_000,
  descriptor: 'SHELL OIL 5741',
  merchant: 'Shell',
  pending: false,
  ...over,
});

describe('trigram similarity', () => {
  it('matches pg_trgm-style padding', () => {
    expect([...trigrams('Cat')].sort()).toEqual(['  c', ' ca', 'at ', 'cat']);
    expect(trigrams('--')).toEqual(new Set());
    expect(similarity('', '')).toBe(0);
    expect(similarity('QuikTrip', 'QuikTrip')).toBe(1);
    expect(similarity('QUIKTRIP 0412', 'QUIKTRIP 0412 TULSA')).toBeGreaterThan(0.6);
    expect(similarity('Shell', 'Kroger')).toBe(0);
  });
});

describe('pending → posted (SPEC §3.2)', () => {
  it('tolerance is max($1, 2%) of the pending amount', () => {
    expect(withinTolerance(5_000, 5_100)).toBe(true); // $1 on $50
    expect(withinTolerance(5_000, 5_101)).toBe(false);
    expect(withinTolerance(10_000, 10_200)).toBe(true); // 2% of $100
    expect(withinTolerance(10_000, 10_201)).toBe(false);
    expect(withinTolerance(-10_000, -9_800)).toBe(true);
  });

  it('matches within 7 days after the pending date only', () => {
    const p = stored({ isPending: true, sourceId: 'pend' });
    expect(pendingMatches(p, inc({ postedAt: '2026-09-17' }))).toBe(true);
    expect(pendingMatches(p, inc({ postedAt: '2026-09-18' }))).toBe(false);
    expect(pendingMatches(p, inc({ postedAt: '2026-09-09' }))).toBe(false);
    expect(pendingMatches(p, inc({ merchant: 'Kroger' }))).toBe(false);
    expect(pendingMatches(p, inc({ merchant: 'SHELL' }))).toBe(true); // trigram ≥ 0.8
  });

  it('#4 a fuel hold that posts for less updates the pending row in place (edge 4)', () => {
    const p = stored({ id: 'hold', sourceId: 'pend-9', isPending: true, amountCents: 10_000 });
    const q = inc({
      sourceId: 'post-9',
      postedAt: '2026-09-12',
      amountCents: 9_850,
      descriptor: 'SHELL OIL 5741 TULSA',
    });
    expect(planAccountSync([p], [q], '2026-09-12')).toEqual([
      { kind: 'update', id: 'hold', incoming: q, matchedPending: true },
    ]);
  });

  it('a tip beyond tolerance is a new row, and the pending one waits', () => {
    const p = stored({
      id: 'meal',
      sourceId: 'pend',
      isPending: true,
      merchant: 'Olive Garden',
      amountCents: 4_000,
    });
    const q = inc({ sourceId: 'post', merchant: 'Olive Garden', amountCents: 4_800 });
    expect(planAccountSync([p], [q], '2026-09-11')).toEqual([{ kind: 'insert', incoming: q }]);
  });

  it('prefers the closest amount, then the latest pending, when several could match', () => {
    const a = stored({ id: 'a', sourceId: 'pa', isPending: true, amountCents: 5_050 });
    const b = stored({ id: 'b', sourceId: 'pb', isPending: true, amountCents: 5_010 });
    const c = stored({
      id: 'c',
      sourceId: 'pc',
      isPending: true,
      amountCents: 5_010,
      postedAt: '2026-09-09',
    });
    const d = stored({ id: 'd', sourceId: 'pd', isPending: true, amountCents: 5_010 });
    const q = inc({ sourceId: 'q', amountCents: 5_000 });
    const ops = planAccountSync([a, c, d, b], [q], '2026-09-10');
    expect(ops).toEqual([{ kind: 'update', id: 'b', incoming: q, matchedPending: true }]);
  });

  it('a pending row still reported as pending is never matched to a posted one', () => {
    const p = stored({ id: 'p', sourceId: 'pend', isPending: true });
    const still = inc({ sourceId: 'pend', pending: true });
    const q = inc({ sourceId: 'post' });
    const ops = planAccountSync([p], [still, q], '2026-09-10');
    expect(ops).toEqual([{ kind: 'insert', incoming: q }]);
  });

  it('a new pending row is inserted, never matched', () => {
    const p = stored({ id: 'p', sourceId: 'old', isPending: true });
    const newPending = inc({ sourceId: 'new', pending: true });
    expect(planAccountSync([p], [newPending], '2026-09-10')).toEqual([
      { kind: 'insert', incoming: newPending },
    ]);
  });

  it(`drops a vanished pending row after ${PENDING_DROP_DAYS} days, not before`, () => {
    const p = stored({ id: 'p', sourceId: 'gone', isPending: true, postedAt: '2026-09-01' });
    expect(planAccountSync([p], [], '2026-09-14')).toEqual([]);
    expect(planAccountSync([p], [], '2026-09-15')).toEqual([{ kind: 'drop', id: 'p' }]);
    expect(planAccountSync([{ ...p, dropped: true }], [], '2026-10-15')).toEqual([]);
  });

  it('#12 re-running over the same window plans nothing (edge 12)', () => {
    const rows = [stored(), stored({ id: 'row-2', sourceId: 'sf-2', amountCents: 1_200 })];
    const again = [inc(), inc({ sourceId: 'sf-2', amountCents: 1_200 })];
    expect(planAccountSync(rows, again, '2026-09-20')).toEqual([]);
  });

  it('same id with any moved field refreshes in place; a dropped row that returns is restored', () => {
    const s = stored({ isPending: true });
    const posted = inc();
    expect(planAccountSync([s], [posted], '2026-09-10')).toEqual([
      { kind: 'update', id: 'row-1', incoming: posted, matchedPending: false },
    ]);
    for (const moved of [
      inc({ postedAt: '2026-09-11' }),
      inc({ amountCents: 5_001 }),
      inc({ descriptor: 'SHELL' }),
    ]) {
      expect(planAccountSync([stored()], [moved], '2026-09-10')).toHaveLength(1);
    }
    expect(planAccountSync([stored({ dropped: true })], [inc()], '2026-09-10')).toHaveLength(1);
  });

  it('manual rows without a source id are left alone', () => {
    expect(planAccountSync([stored({ sourceId: null })], [], '2026-12-31')).toEqual([]);
  });
});

const row = (over: Partial<TransferCandidate>): TransferCandidate => ({
  id: 'x',
  accountId: 'checking',
  accountKind: 'depository',
  postedAt: '2026-09-10',
  amountCents: 50_000,
  ...over,
});

describe('transfer detection (SPEC §3.3, §3.4)', () => {
  const fromChecking = row({ id: 'chk', amountCents: 84_500 });
  const toCard = row({
    id: 'card',
    accountId: 'apple-card',
    accountKind: 'credit',
    amountCents: -84_500,
    postedAt: '2026-09-11',
  });

  it('#3 a credit-card payment from checking pairs as a high-confidence transfer (edge 3)', () => {
    expect(detectTransfers([fromChecking, toCard])).toEqual([
      { a: 'card', b: 'chk', confidence: 'high', dayGap: 1 },
    ]);
  });

  it('medium: two depository accounts, or more than a day apart', () => {
    const toSavings = row({ id: 'sav', accountId: 'savings', amountCents: -84_500 });
    expect(pairConfidence(fromChecking, toSavings)).toBe('medium');
    expect(pairConfidence(fromChecking, { ...toCard, postedAt: '2026-09-13' })).toBe('medium');
  });

  it('rejects same account, unequal amounts, zero, and gaps over 4 days', () => {
    expect(pairConfidence(fromChecking, { ...toCard, accountId: 'checking' })).toBeNull();
    expect(pairConfidence(fromChecking, { ...toCard, amountCents: -84_501 })).toBeNull();
    expect(
      pairConfidence(row({ amountCents: 0 }), row({ id: 'y', accountId: 'z', amountCents: 0 })),
    ).toBeNull();
    expect(pairConfidence(fromChecking, { ...toCard, postedAt: '2026-09-15' })).toBeNull();
    expect(pairConfidence(fromChecking, { ...toCard, postedAt: '2026-09-14' })).toBe('medium');
  });

  it('each row pairs at most once, best match first, independent of order', () => {
    const toSavings = row({
      id: 'sav',
      accountId: 'savings',
      amountCents: -84_500,
      postedAt: '2026-09-10',
    });
    const later = row({
      id: 'card2',
      accountId: 'apple-card',
      accountKind: 'credit',
      amountCents: -84_500,
      postedAt: '2026-09-12',
    });
    const expected = [{ a: 'card', b: 'chk', confidence: 'high', dayGap: 1 }];
    expect(detectTransfers([fromChecking, toSavings, later, toCard])).toEqual(expected);
    expect(detectTransfers([toCard, later, toSavings, fromChecking])).toEqual(expected);
  });

  it('ties break on date gap, then ids', () => {
    const out = row({ id: 'o', amountCents: 1_000 });
    const in1 = row({ id: 'i2', accountId: 's1', amountCents: -1_000, postedAt: '2026-09-12' });
    const in2 = row({ id: 'i1', accountId: 's2', amountCents: -1_000, postedAt: '2026-09-12' });
    const in3 = row({ id: 'i0', accountId: 's3', amountCents: -1_000, postedAt: '2026-09-13' });
    expect(detectTransfers([out, in1, in2, in3])).toEqual([
      { a: 'i1', b: 'o', confidence: 'medium', dayGap: 2 },
    ]);
    const out2 = row({ id: 'o2', amountCents: 1_000 });
    expect(detectTransfers([out, out2, in1])).toEqual([
      { a: 'i2', b: 'o', confidence: 'medium', dayGap: 2 },
    ]);
  });
});
