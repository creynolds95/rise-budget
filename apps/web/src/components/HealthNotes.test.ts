import type { AccountWithStaleness } from '../lib/types';
import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '../lib/types';
import { healthNotes, usageNote } from './HealthNotes';
import { quietInstitutions, quietWhenStale, staleKey } from './StaleNotes';

const run = (status: string, message?: string, account?: string): SyncStatus['runs'][number] => ({
  id: 'r',
  startedAt: '2026-09-26T14:00:00Z',
  finishedAt: '2026-09-26T14:00:05Z',
  status,
  accountsTouched: 0,
  rowsInserted: 0,
  rowsUpdated: 0,
  errors: message ? [{ message, ...(account ? { account } : {}) }] : [],
});
const fresh = { latest: { date: '2026-09-26', bytes: 1 }, count: 3 };

describe('C6 health notes', () => {
  it('says nothing when the last sync worked and last night’s backup landed', () => {
    expect(healthNotes({ mode: 'live', runs: [run('ok')] }, fresh, '2026-09-26')).toEqual([]);
    expect(
      healthNotes(
        { mode: 'live', runs: [run('ok')] },
        { ...fresh, latest: { date: '2026-09-25', bytes: 1 } },
        '2026-09-26',
      ),
    ).toEqual([]);
  });

  it('names a failed sync and its reason', () => {
    expect(
      healthNotes({ mode: 'live', runs: [run('failed', 'Bridge down')] }, fresh, '2026-09-26'),
    ).toEqual([{ text: 'Bank sync failed: Bridge down', to: '/settings/sync' }]);
    expect(healthNotes({ mode: 'live', runs: [run('failed')] }, fresh, '2026-09-26')[0]?.text).toBe(
      'Bank sync failed.',
    );
  });

  it('ignores sync when it is not connected, and a partial run’s per-account errors', () => {
    expect(healthNotes({ mode: 'off', runs: [run('failed')] }, fresh, '2026-09-26')).toEqual([]);
    expect(
      healthNotes({ mode: 'live', runs: [run('partial', 'x', 'Visa')] }, fresh, '2026-09-26'),
    ).toEqual([]);
  });

  it('names a bank connection that needs attention on a partial run', () => {
    const msg = 'Connection to Texas Higher Education Coordinating Board may need attention.';
    expect(healthNotes({ mode: 'live', runs: [run('partial', msg)] }, fresh, '2026-09-26')).toEqual(
      [{ text: msg, to: '/settings/sync' }],
    );
  });

  it('flags a backup two or more days old, or none at all', () => {
    const old = { latest: { date: '2026-09-24', bytes: 1 }, count: 1 };
    expect(healthNotes(undefined, old, '2026-09-26')).toEqual([
      { text: 'Last backup was Sep 24.', to: '/settings/data' },
    ]);
    expect(healthNotes(undefined, { latest: null, count: 0 }, '2026-09-26')[0]?.text).toBe(
      'No backup has run yet.',
    );
    expect(healthNotes(undefined, undefined, '2026-09-26')).toEqual([]);
  });
});

describe('known-flaky loan feeds stay off the summary', () => {
  const msg = 'Connection to Texas Higher Education Coordinating Board may need attention.';
  it('drops a connection note for an institution the person has marked as loans only', () => {
    expect(
      healthNotes({ mode: 'live', runs: [run('partial', msg)] }, fresh, '2026-09-26', [
        'Texas Higher Education Coordinating Board',
      ]),
    ).toEqual([]);
  });

  it('keeps loans on their own account rows only, and only quiets all-loan institutions', () => {
    const a = (kind: string, institutionName: string | null, extra = {}) => ({
      kind,
      source: 'simplefin',
      institutionName,
      archivedAt: null,
      ...extra,
    });
    expect(quietWhenStale({ kind: 'loan' })).toBe(true);
    expect(quietWhenStale({ kind: 'credit' })).toBe(false);
    expect(
      quietInstitutions([
        a('loan', 'THECB'),
        a('loan', 'THECB'),
        a('loan', 'Bank'),
        a('depository', 'Bank'),
        a('loan', null),
        a('depository', 'Old', { archivedAt: '2026-01-01' }),
        a('loan', 'Manual', { source: 'manual' }),
      ]),
    ).toEqual(['THECB']);
  });
});

describe('usageNote', () => {
  const usage = (
    rowsRead: number,
    routes = [{ route: 'GET /api/transactions', rowsRead, requests: 3 }],
  ) => ({
    limits: { rowsRead: 5_000_000, rowsWritten: 100_000 },
    days: [{ day: '2026-10-03', rowsRead, rowsWritten: 10, requests: 3 }],
    routes,
  });
  it('stays quiet on a normal day', () => {
    expect(usageNote(usage(300_000), '2026-10-03')).toBeNull();
    expect(usageNote(undefined, '2026-10-03')).toBeNull();
    expect(usageNote(usage(4_000_000), '2026-10-02')).toBeNull();
  });
  it('names the share and the heaviest route once use is high', () => {
    expect(usageNote(usage(2_600_000), '2026-10-03')?.text).toBe(
      'Database use today is 52% of the free limit, mostly GET /api/transactions.',
    );
    expect(usageNote(usage(2_600_000, []), '2026-10-03')?.text).toBe(
      'Database use today is 52% of the free limit.',
    );
  });
});

describe('staleKey', () => {
  const base = { id: 'a1' } as AccountWithStaleness;
  it('changes when the account syncs, so a dismissal ends at its next sync', () => {
    const a = {
      ...base,
      staleness: { stale: true, reason: 'overdue', lastSyncedAtMs: 1, overdueByMs: 0 },
    } as AccountWithStaleness;
    const b = { ...a, staleness: { ...a.staleness, lastSyncedAtMs: 2 } } as AccountWithStaleness;
    expect(staleKey(a)).not.toBe(staleKey(b));
    expect(
      staleKey({
        ...base,
        staleness: { stale: true, reason: 'never_synced' },
      } as AccountWithStaleness),
    ).toBe('a1@never');
  });
});
