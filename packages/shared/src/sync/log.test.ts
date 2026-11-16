import { describe, expect, it } from 'vitest';
import { explainSyncOps } from './log';
import { maskAccounts, redactText, sensitiveNames } from './redact';
import type { IncomingWithMerchant, StoredTxn, SyncOp } from './pending';

const stored = (over: Partial<StoredTxn> = {}): StoredTxn => ({
  id: 'row-1',
  sourceId: 'sf-pending-1',
  postedAt: '2026-09-10',
  amountCents: 5_000,
  descriptor: 'SHELL',
  merchant: 'Shell',
  isPending: true,
  dropped: false,
  ...over,
});
const inc = (over: Partial<IncomingWithMerchant> = {}): IncomingWithMerchant => ({
  sourceId: 'sf-1',
  postedAt: '2026-09-10',
  amountCents: 5_000,
  descriptor: 'SHELL',
  merchant: 'Shell',
  pending: false,
  ...over,
});

describe('explainSyncOps', () => {
  it('names the reason for each op and summarises the account', () => {
    const s = [stored(), stored({ id: 'row-2', sourceId: 'x2', isPending: false })];
    const i = [inc(), inc({ sourceId: 'x2' }), inc({ sourceId: 'brand-new', pending: true })];
    const ops: SyncOp[] = [
      { kind: 'update', id: 'row-1', incoming: i[0] as IncomingWithMerchant, matchedPending: true },
      { kind: 'insert', incoming: i[2] as IncomingWithMerchant },
    ];
    const { events, summary } = explainSyncOps(
      s,
      i,
      ops,
      ['new-1'],
      ['gone-id-123456'],
      '2026-09-12',
    );
    expect(events.map((e) => e.kind)).toEqual([
      'pending_to_posted',
      'insert',
      'skip_deleted',
      'summary',
    ]);
    expect(events[1]).toMatchObject({
      txnId: 'new-1',
      isPending: true,
      sourceTail: 'rand-new'.slice(-6),
    });
    expect(events[2]?.sourceTail).toBe('123456');
    expect(summary).toMatchObject({
      sent: 3,
      inserted: 1,
      pendingToPosted: 1,
      unchanged: 1,
      skippedDeleted: 1,
      sentPending: 1,
      sentPendingCents: 5_000,
      storedPending: 1,
      pendingNotSent: 0,
    });
  });

  it('tells a same-id pending flip from a plain update and records what changed', () => {
    const s = [
      stored({ sourceId: 'same' }),
      stored({ id: 'row-2', sourceId: 'b', isPending: false }),
    ];
    const a = inc({ sourceId: 'same' });
    const b = inc({ sourceId: 'b', amountCents: 6_000 });
    const ops: SyncOp[] = [
      { kind: 'update', id: 'row-1', incoming: a, matchedPending: false },
      { kind: 'update', id: 'row-2', incoming: b, matchedPending: false },
    ];
    const { events } = explainSyncOps(s, [a, b], ops, [], [], '2026-09-12');
    expect(events[0]).toMatchObject({
      kind: 'pending_to_posted',
      reason: expect.stringContaining('same bank id'),
    });
    expect(events[1]).toMatchObject({ kind: 'update', detail: { amountCents: [5_000, 6_000] } });
  });

  it('records a drop with its age, and counts pending rows the bank stopped sending', () => {
    const s = [
      stored({ postedAt: '2026-09-01' }),
      stored({ id: 'row-3', sourceId: 'y', postedAt: '2026-09-11' }),
    ];
    const ops: SyncOp[] = [{ kind: 'drop', id: 'row-1' }];
    const { events, summary } = explainSyncOps(s, [], ops, [], [], '2026-09-20');
    expect(events[0]).toMatchObject({ kind: 'drop', detail: { ageDays: 19 } });
    expect(summary.pendingNotSent).toBe(1); // row-3: still pending, not sent, not yet dropped
  });
});

describe('masking', () => {
  const accts = [
    {
      id: 'b',
      kind: 'credit',
      name: 'Rewards Visa',
      institutionName: 'Fictional Bank',
      createdAt: '2026-02-01',
    },
    {
      id: 'a',
      kind: 'depository',
      name: 'Checking',
      nickname: 'Rent money',
      institutionName: 'Fictional Bank',
      createdAt: '2026-01-01',
    },
    {
      id: 'c',
      kind: 'loan',
      name: 'Auto',
      institutionName: 'Other Lender',
      createdAt: '2026-03-01',
    },
  ];

  it('gives stable codes in the order accounts were added, one letter per bank', () => {
    const m = maskAccounts(accts);
    expect(m.get('a')).toMatchObject({ code: 'acct-1', bank: 'Bank A' });
    expect(m.get('b')).toMatchObject({ code: 'acct-2', bank: 'Bank A' });
    expect(m.get('c')).toMatchObject({ code: 'acct-3', bank: 'Bank B' });
  });

  it('strips known names and long digit runs from text', () => {
    const names = sensitiveNames(accts);
    const out = redactText('Connection to fictional bank for "Rent money" 123456789 failed', names);
    expect(out).toBe('Connection to [name] for "[name]" # failed');
  });
});

describe('explainSyncOps edge cases', () => {
  it('records every kind of change, and tolerates an op whose stored row is gone', () => {
    const s = [stored({ sourceId: 'old', isPending: false, dropped: true })];
    const i = inc({
      sourceId: 'new',
      postedAt: '2026-09-11',
      amountCents: 4_000,
      descriptor: 'OTHER',
      pending: true,
    });
    const ops: SyncOp[] = [
      { kind: 'update', id: 'row-1', incoming: i, matchedPending: false },
      { kind: 'update', id: 'ghost', incoming: inc(), matchedPending: false },
      { kind: 'drop', id: 'ghost' },
      { kind: 'insert', incoming: inc({ sourceId: '' }) },
    ];
    const { events } = explainSyncOps(s, [i], ops, [], [], '2026-09-12');
    expect(events[0]?.detail).toEqual({
      postedAt: ['2026-09-10', '2026-09-11'],
      amountCents: [5_000, 4_000],
      descriptor: true,
      pending: [false, true],
      restoredFromDropped: true,
      newSourceId: true,
    });
    expect(events[1]).toMatchObject({ wasPending: null, detail: null });
    expect(events[2]).toMatchObject({
      kind: 'drop',
      sourceTail: null,
      postedAt: null,
      detail: null,
    });
    expect(events[3]).toMatchObject({
      kind: 'insert',
      reason: 'new posted row, no pending match',
      txnId: null,
      sourceTail: null,
    });
  });

  it('writes no summary for a quiet account', () => {
    const s = [stored({ isPending: false, sourceId: 'a' })];
    const { events, summary } = explainSyncOps(
      s,
      [inc({ sourceId: 'a' })],
      [],
      [],
      [],
      '2026-09-12',
    );
    expect(events).toEqual([]);
    expect(summary).toMatchObject({ unchanged: 1, inserted: 0 });
  });
});

describe('masking edge cases', () => {
  it('handles banks without a name, ties on date, and more than 26 banks', () => {
    const many = Array.from({ length: 28 }, (_, n) => ({
      id: `id-${String(n).padStart(2, '0')}`,
      kind: 'depository',
      name: 'x',
      institutionName: `Bank number ${n}`,
      createdAt: '2026-01-01',
    }));
    const m = maskAccounts([
      ...many,
      { id: 'zz', kind: 'other', name: 'y', createdAt: '2026-01-01' },
    ]);
    expect(m.get('id-00')?.bank).toBe('Bank A');
    expect(m.get('id-26')?.bank).toBe('Bank AA');
    expect(m.get('id-27')?.bank).toBe('Bank AB');
    expect(m.get('zz')?.bank).toBe('Bank AC');
    expect(m.get('zz')?.code).toBe('acct-29');
  });

  it('keeps only usable, distinct names, longest first', () => {
    expect(
      sensitiveNames([
        {
          id: 'a',
          kind: 'x',
          name: 'Chk',
          nickname: null,
          institutionName: 'Chk',
          sourceAccountId: 'ab',
          createdAt: '',
        },
        { id: 'b', kind: 'x', name: 'Longer name', createdAt: '' },
      ]),
    ).toEqual(['Longer name', 'Chk']);
  });
});

it('does not count a pending row as unsent when the bank still sends it', () => {
  const s = [stored({ sourceId: 'p' })];
  const { summary } = explainSyncOps(
    s,
    [inc({ sourceId: 'p', pending: true })],
    [],
    [],
    [],
    '2026-09-12',
  );
  expect(summary.pendingNotSent).toBe(0);
});
