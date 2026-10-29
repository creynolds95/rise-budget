import { describe, expect, it } from 'vitest';
import {
  anyNearDue,
  balanceOverdue,
  handAddedArrival,
  learnLag,
  seenInBalance,
  type BalanceReading,
  type BalanceRule,
  type BalanceTxn,
} from './inBalance';

const TODAY = '2026-10-14';
const snaps = (...r: [string, number][]) =>
  new Map<string, BalanceReading[]>([
    ['chk', r.map(([asOf, balanceCents]) => ({ asOf, balanceCents }))],
  ]);
const rule = (id: string, amountCents: number, dueOn = TODAY, extra: Partial<BalanceRule> = {}) =>
  ({ id, amountCents, dueOn, lagDays: null, seenDue: null, ...extra }) satisfies BalanceRule;
const txn = (postedAt: string, amountCents: number, isPending = false): BalanceTxn => ({
  accountId: 'chk',
  postedAt,
  amountCents,
  isPending,
});
const ids = (r: { id: string }[]) => r.map((x) => x.id);

describe('seenInBalance', () => {
  // The owner's day: the bank took both bills, Rise had neither row yet.
  it('sees two bills the balance already paid that Rise has no rows for', () => {
    const out = seenInBalance(
      snaps(['2026-10-10', 232_670], ['2026-10-14', 93_516]),
      [],
      [rule('loan', 106_054), rule('gym', 33_100), rule('pay', -300_000, '2026-10-20')],
      TODAY,
    );
    expect(out).toEqual([
      { id: 'loan', dueOn: TODAY, twice: false },
      { id: 'gym', dueOn: TODAY, twice: false },
    ]);
  });

  it('sees nothing when the balance has not moved past its transactions', () => {
    const out = seenInBalance(
      snaps(['2026-10-10', 200_000], ['2026-10-14', 190_000]),
      [txn('2026-10-12', 10_000)],
      [rule('loan', 106_054)],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it('counts nothing as seen when the gap fits no bill', () => {
    const out = seenInBalance(
      snaps(['2026-10-10', 200_000], ['2026-10-14', 150_000]),
      [],
      [rule('loan', 106_054)],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it('counts neither of two same-sized bills when only one left', () => {
    const out = seenInBalance(
      snaps(['2026-10-10', 200_000], ['2026-10-14', 150_000]),
      [],
      [rule('a', 50_000), rule('b', 50_000)],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it('flags a bill the balance moved by twice', () => {
    const out = seenInBalance(
      snaps(['2026-10-10', 200_000], ['2026-10-14', 133_800]),
      [],
      [rule('gym', 33_100)],
      TODAY,
    );
    expect(out).toEqual([{ id: 'gym', dueOn: TODAY, twice: true }]);
  });

  it('stays cautious when a pending row may or may not be in the balance', () => {
    const out = seenInBalance(
      snaps(['2026-10-10', 200_000], ['2026-10-14', 166_900]),
      [txn('2026-10-14', 33_100, true)],
      [rule('gym', 33_100)],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it('sees an unrelated pending row the balance already holds', () => {
    // Balance takes pending: the gap is the pending row plus the bill.
    const out = seenInBalance(
      snaps(['2026-10-10', 200_000], ['2026-10-14', 161_900]),
      [txn('2026-10-13', 5_000, true)],
      [rule('gym', 33_100)],
      TODAY,
    );
    expect(ids(out)).toEqual(['gym']);
  });

  it('sees a paycheck that landed early', () => {
    const out = seenInBalance(
      snaps(['2026-10-10', 100_000], ['2026-10-14', 400_000]),
      [],
      [rule('pay', -300_000, '2026-10-16')],
      TODAY,
    );
    expect(ids(out)).toEqual(['pay']);
  });

  it('only looks a learned lag past the grace days', () => {
    const late = rule('loan', 106_054, '2026-10-09');
    const args = [snaps(['2026-10-01', 300_000], ['2026-10-14', 193_946]), []] as const;
    expect(seenInBalance(...args, [late], TODAY)).toEqual([]);
    expect(ids(seenInBalance(...args, [{ ...late, lagDays: 3 }], TODAY))).toEqual(['loan']);
  });

  it('keeps one seen before until its row comes, even when the gap no longer fits', () => {
    const seen = rule('loan', 106_054, '2026-10-14', { seenDue: '2026-10-14' });
    const out = seenInBalance(
      snaps(['2026-10-10', 300_000], ['2026-10-16', 100_000]),
      [],
      [seen],
      '2026-10-16',
    );
    expect(out).toEqual([{ id: 'loan', dueOn: '2026-10-14', twice: false }]);
  });

  it('keeps one seen before when there is no older balance to compare', () => {
    const seen = rule('loan', 106_054, '2026-10-14', { seenDue: '2026-10-14' });
    expect(ids(seenInBalance(snaps(['2026-10-14', 1]), [], [seen], TODAY))).toEqual(['loan']);
    expect(seenInBalance(snaps(['2026-10-14', 1]), [], [rule('loan', 5)], TODAY)).toEqual([]);
  });

  it('lets go of a seen date long past', () => {
    const old = rule('loan', 106_054, '2026-09-01', { seenDue: '2026-09-01' });
    expect(seenInBalance(snaps(['2026-08-01', 1], ['2026-10-14', 1]), [], [old], TODAY)).toEqual(
      [],
    );
  });

  it('reads only transactions between the two balances', () => {
    const out = seenInBalance(
      snaps(['2026-10-08', 999_999], ['2026-10-10', 200_000], ['2026-10-13', 166_900]),
      [
        txn('2026-10-09', 1_000),
        txn('2026-10-14', 2_000),
        { ...txn('2026-10-12', 0), accountId: 'sav' },
      ],
      [rule('gym', 33_100)],
      TODAY,
    );
    expect(ids(out)).toEqual(['gym']);
  });

  it('sums every cash account, judged from the stalest balance, in any order', () => {
    const two = new Map<string, BalanceReading[]>([
      [
        'chk',
        [
          { asOf: '2026-10-14', balanceCents: 50_000 },
          { asOf: '2026-10-08', balanceCents: 83_100 },
        ],
      ],
      [
        'sav',
        [
          { asOf: '2026-10-08', balanceCents: 10_000 },
          { asOf: '2026-10-10', balanceCents: 10_000 },
        ],
      ],
    ]);
    // Savings last reported the 10th: a bill due the 14th is too far ahead of it to weigh.
    expect(seenInBalance(two, [], [rule('gym', 33_100)], TODAY)).toEqual([]);
    expect(ids(seenInBalance(two, [], [rule('gym', 33_100, '2026-10-12')], TODAY))).toEqual([
      'gym',
    ]);
  });

  it('needs a balance for every cash account, and a schedule with an amount', () => {
    const none = new Map<string, BalanceReading[]>([['chk', []]]);
    expect(seenInBalance(none, [], [rule('gym', 33_100)], TODAY)).toEqual([]);
    expect(seenInBalance(new Map(), [], [rule('gym', 33_100)], TODAY)).toEqual([]);
    expect(seenInBalance(snaps(['2026-10-14', 0]), [], [rule('zero', 0)], TODAY)).toEqual([]);
  });

  it('weighs at most eight schedules, soonest first', () => {
    const many = Array.from({ length: 10 }, (_, i) => rule(`r${i}`, 1_000 * (i + 1)));
    const out = seenInBalance(
      snaps(['2026-10-10', 100_000], ['2026-10-14', 99_000]),
      [],
      many,
      TODAY,
    );
    expect(ids(out)).toEqual(['r0']);
  });
});

describe('anyNearDue', () => {
  it('is true only around a due date, or for one already seen', () => {
    expect(anyNearDue([{ dueOn: '2026-10-17', seenDue: null }], TODAY)).toBe(true);
    expect(anyNearDue([{ dueOn: '2026-10-18', seenDue: null }], TODAY)).toBe(false);
    expect(anyNearDue([{ dueOn: '2026-10-02', seenDue: null }], TODAY)).toBe(true);
    expect(anyNearDue([{ dueOn: '2026-10-01', seenDue: null }], TODAY)).toBe(false);
    expect(anyNearDue([{ dueOn: '2026-12-01', seenDue: '2026-10-01' }], TODAY)).toBe(true);
  });
});

describe('learnLag', () => {
  it('starts from the first sample and averages after, within bounds', () => {
    expect(learnLag(null, 2)).toBe(2);
    expect(learnLag(2, 3)).toBe(3);
    expect(learnLag(1, -4)).toBe(1);
    expect(learnLag(null, 40)).toBe(7);
  });
});

describe('balanceOverdue', () => {
  it('waits the grace days, or one past the learned lag', () => {
    expect(balanceOverdue('2026-10-14', null, '2026-10-15')).toBe(false);
    expect(balanceOverdue('2026-10-14', null, '2026-10-16')).toBe(true);
    expect(balanceOverdue('2026-10-14', 3, '2026-10-17')).toBe(false);
    expect(balanceOverdue('2026-10-14', 3, '2026-10-18')).toBe(true);
  });
});

describe('handAddedArrival', () => {
  it('takes the first row of about its amount from just before its due date', () => {
    const rows = [
      { postedAt: '2026-09-14', amountCents: 106_054 },
      { postedAt: '2026-10-16', amountCents: 106_000 },
      { postedAt: '2026-10-15', amountCents: 50 },
      { postedAt: '2026-10-17', amountCents: 106_054 },
    ];
    expect(handAddedArrival({ amountCents: 106_054, dueOn: TODAY }, rows)).toBe(rows[1]);
    expect(handAddedArrival({ amountCents: -106_054, dueOn: TODAY }, rows)).toBeNull();
  });
});
