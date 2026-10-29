import { describe, expect, it } from 'vitest';
import type { UsageStatus } from '@rise/shared/schemas';
import { healthChecks, healthSummary, type HealthInput } from './health';
import type { AccountWithStaleness, SyncStatus } from './types';

const TODAY = '2026-03-10';
const acct = (over: Partial<AccountWithStaleness>): AccountWithStaleness =>
  ({
    id: 'a1',
    name: 'Everyday Checking',
    kind: 'depository',
    source: 'simplefin',
    institutionName: 'Sample Bank',
    archivedAt: null,
    staleness: { stale: false },
    ...over,
  }) as AccountWithStaleness;
const run = (over: Partial<SyncStatus['runs'][number]> = {}): SyncStatus['runs'][number] => ({
  id: 'r1',
  startedAt: '2026-03-10T14:00:00Z',
  finishedAt: '2026-03-10T14:00:05Z',
  status: 'ok',
  accountsTouched: 1,
  rowsInserted: 0,
  rowsUpdated: 0,
  errors: [],
  ...over,
});
const usage = (rowsRead: number): UsageStatus => ({
  limits: { rowsRead: 5_000_000, rowsWritten: 100_000 },
  days: [{ day: new Date().toISOString().slice(0, 10), rowsRead, rowsWritten: 0, requests: 1 }],
  routes: [],
});
const healthy: HealthInput = {
  sync: { mode: 'live', runs: [run()] },
  accounts: [acct({})],
  backups: { latest: { date: '2026-03-10' } },
  usage: usage(1_000),
  appStale: false,
  today: TODAY,
  tz: 'UTC',
};
const byKey = (h: HealthInput) => Object.fromEntries(healthChecks(h).map((c) => [c.key, c]));

describe('Settings → Health', () => {
  it('says all good when everything is', () => {
    const checks = healthChecks(healthy);
    expect(checks.every((c) => c.ok === true)).toBe(true);
    expect(healthSummary(checks)).toBe('All good');
    expect(byKey(healthy)['banks']?.text).toBe('Last synced Mar 10.');
  });

  it('waits for every read before summarizing', () => {
    const checks = healthChecks({ ...healthy, usage: undefined, appStale: null });
    expect(checks.filter((c) => c.ok === null).map((c) => c.key)).toEqual(['app', 'database']);
    expect(healthSummary(checks)).toBeUndefined();
    // …but an unknown app version alone doesn't hold the summary up.
    expect(healthSummary(healthChecks({ ...healthy, appStale: null }))).toBe('All good');
  });

  it('flags an out-of-date app', () => {
    expect(byKey({ ...healthy, appStale: true })['app']?.ok).toBe(false);
  });

  it('flags SimpleFIN not connected, a failed run, and a bank needing sign-in', () => {
    expect(byKey({ ...healthy, sync: { mode: 'off', runs: [] } })['banks']?.ok).toBe(false);
    const failed = byKey({
      ...healthy,
      sync: {
        mode: 'live',
        runs: [run({ status: 'failed', errors: [{ message: 'Bridge down' }] })],
      },
    })['banks'];
    expect(failed?.text).toBe('The last sync failed: Bridge down');
    const attention = byKey({
      ...healthy,
      sync: {
        mode: 'live',
        runs: [run({ status: 'partial', errors: [{ message: 'Sample Bank needs attention.' }] })],
      },
    })['banks'];
    expect(attention?.ok).toBe(false);
    expect(attention?.fix).toMatch(/SimpleFIN Bridge/);
    // A connected install that has never run a sync is fine.
    expect(byKey({ ...healthy, sync: { mode: 'live', runs: [] } })['banks']?.ok).toBe(true);
    // A failed run with no message still reads as a sentence.
    expect(
      byKey({ ...healthy, sync: { mode: 'live', runs: [run({ status: 'failed' })] } })['banks']
        ?.text,
    ).toBe('The last sync failed.');
  });

  it('keeps a known-flaky loan-only bank quiet', () => {
    const h: HealthInput = {
      ...healthy,
      accounts: [acct({}), acct({ id: 'l1', kind: 'loan', institutionName: 'Loan Servicer' })],
      sync: {
        mode: 'live',
        runs: [run({ status: 'partial', errors: [{ message: 'Loan Servicer needs attention.' }] })],
      },
    };
    expect(byKey(h)['banks']?.ok).toBe(true);
  });

  it('flags no accounts and stale ones, but not stale loans', () => {
    expect(byKey({ ...healthy, accounts: [] })['accounts']?.ok).toBe(false);
    const stale = acct({ staleness: { stale: true, reason: 'never_synced' } });
    expect(byKey({ ...healthy, accounts: [stale] })['accounts']?.text).toBe(
      "Everyday Checking hasn't synced yet.",
    );
    expect(byKey({ ...healthy, accounts: [{ ...stale, kind: 'loan' }] })['accounts']?.ok).toBe(
      true,
    );
  });

  it('flags a missing or late backup', () => {
    expect(byKey({ ...healthy, backups: { latest: null } })['backup']?.ok).toBe(false);
    expect(byKey({ ...healthy, backups: { latest: { date: '2026-03-07' } } })['backup']?.ok).toBe(
      false,
    );
  });

  it('flags heavy database use and counts what needs a look', () => {
    const h = { ...healthy, usage: usage(3_000_000), appStale: true };
    expect(byKey(h)['database']?.ok).toBe(false);
    expect(healthSummary(healthChecks(h))).toBe('2 need a look');
    expect(healthSummary(healthChecks({ ...healthy, appStale: true }))).toBe('1 needs a look');
  });
});
