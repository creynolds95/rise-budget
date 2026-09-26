import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '../lib/types';
import { healthNotes } from './HealthNotes';

const run = (status: string, message?: string): SyncStatus['runs'][number] => ({
  id: 'r',
  startedAt: '2026-09-26T14:00:00Z',
  finishedAt: '2026-09-26T14:00:05Z',
  status,
  accountsTouched: 0,
  rowsInserted: 0,
  rowsUpdated: 0,
  errors: message ? [{ accountId: null, message }] : [],
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

  it('ignores sync when it is not connected, and a partial run (per-account notes cover it)', () => {
    expect(healthNotes({ mode: 'off', runs: [run('failed')] }, fresh, '2026-09-26')).toEqual([]);
    expect(healthNotes({ mode: 'live', runs: [run('partial', 'x')] }, fresh, '2026-09-26')).toEqual(
      [],
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
