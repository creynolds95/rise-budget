import { describe, expect, it } from 'vitest';
import { banksLastReported, syncOutcome, type SyncRunResult } from './syncOutcome';

const r = (over: Partial<SyncRunResult> = {}): SyncRunResult => ({
  status: 'ok',
  rowsInserted: 0,
  rowsUpdated: 0,
  errors: [],
  ...over,
});
const sep25 = Date.parse('2026-09-25T04:15:00Z');

describe('manual sync outcome', () => {
  it('says nothing new, and when the banks last reported, instead of looking like a no-op', () => {
    expect(syncOutcome(r(), sep25, 'America/Chicago')).toEqual({
      text: 'Nothing new from your banks — they last reported Sep 24.',
      tone: 'ok',
    });
    expect(syncOutcome(r(), null).text).toBe('Nothing new from your banks.');
  });

  it('counts what arrived', () => {
    expect(syncOutcome(r({ rowsInserted: 1 }), sep25).text).toBe('1 new transaction.');
    expect(syncOutcome(r({ rowsInserted: 3, rowsUpdated: 2 }), sep25).text).toBe(
      '3 new transactions, 2 updated.',
    );
    expect(syncOutcome(r({ rowsUpdated: 1 }), sep25).text).toBe('1 updated.');
  });

  it('surfaces a connection that needs attention on a partial run', () => {
    const out = syncOutcome(
      r({ status: 'partial', errors: [{ message: 'Connection to Bank may need attention.' }] }),
      sep25,
      'America/Chicago',
    );
    expect(out).toEqual({
      text: 'Nothing new from your banks — they last reported Sep 24. Connection to Bank may need attention.',
      tone: 'warn',
    });
    expect(
      syncOutcome(
        r({
          status: 'partial',
          rowsInserted: 2,
          errors: [{ account: 'Visa', message: 'bad row' }],
        }),
        sep25,
      ).text,
    ).toBe('2 new transactions. Visa: bad row');
  });

  it('names a failed sync and its reason', () => {
    expect(syncOutcome(r({ status: 'failed', errors: [{ message: 'Down' }] }), null)).toEqual({
      text: 'Sync failed: Down',
      tone: 'warn',
    });
    expect(syncOutcome(r({ status: 'failed' }), null).text).toBe('Sync failed.');
  });

  it('finds the latest bank report', () => {
    expect(banksLastReported([])).toBeNull();
    expect(banksLastReported([{ lastSyncedAt: null }])).toBeNull();
    expect(
      banksLastReported([
        { lastSyncedAt: '2026-09-24T01:00:00Z' },
        { lastSyncedAt: null },
        { lastSyncedAt: '2026-09-25T04:15:00Z' },
      ]),
    ).toBe(sep25);
  });
});
