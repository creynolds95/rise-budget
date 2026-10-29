import { describe, expect, it } from 'vitest';
import { planFollowMoves, type FollowRule, type FollowTxn } from './match';

const rule = (over: Partial<FollowRule> = {}): FollowRule => ({
  accountId: 'sav',
  match: 'apple gs',
  since: '2026-10-01',
  ...over,
});
const txn = (over: Partial<FollowTxn> = {}): FollowTxn => ({
  id: 't1',
  accountId: 'chk',
  postedAt: '2026-10-05',
  amountCents: 50_000,
  text: 'ach transfer apple gs savings',
  ...over,
});

describe('planFollowMoves', () => {
  it('a matching outflow from checking raises the followed account by that amount', () => {
    expect(planFollowMoves([rule()], [txn()])).toEqual([
      { txnId: 't1', accountId: 'sav', deltaCents: 50_000, postedAt: '2026-10-05' },
    ]);
  });

  it('an inflow (money back from savings) lowers it', () => {
    expect(planFollowMoves([rule()], [txn({ amountCents: -20_000 })])[0]?.deltaCents).toBe(-20_000);
  });

  it('ignores rows before the rule started, so history never changes silently', () => {
    expect(planFollowMoves([rule()], [txn({ postedAt: '2026-09-30' })])).toEqual([]);
    expect(planFollowMoves([rule()], [txn({ postedAt: '2026-10-01' })])).toHaveLength(1);
  });

  it('ignores rows whose text does not contain the match, and the followed account itself', () => {
    expect(planFollowMoves([rule()], [txn({ text: 'netflix' })])).toEqual([]);
    expect(planFollowMoves([rule()], [txn({ accountId: 'sav' })])).toEqual([]);
  });

  it('ignores a zero amount', () => {
    expect(planFollowMoves([rule()], [txn({ amountCents: 0 })])).toEqual([]);
  });

  it('uses each row once: the first rule that matches wins', () => {
    const moves = planFollowMoves([rule({ accountId: 'a' }), rule({ accountId: 'b' })], [txn()]);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.accountId).toBe('a');
  });

  it('handles several rows and rules', () => {
    const moves = planFollowMoves(
      [rule(), rule({ accountId: 'hsa', match: 'hsa deposit' })],
      [txn(), txn({ id: 't2', text: 'hsa deposit', amountCents: 10_000 })],
    );
    expect(moves.map((m) => [m.txnId, m.accountId])).toEqual([
      ['t1', 'sav'],
      ['t2', 'hsa'],
    ]);
  });
});
