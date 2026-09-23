import { describe, expect, it } from 'vitest';
import { paceFor, staleness, SYNC_CADENCE_HOURS, type PaceInput } from './pace';

const mid = { elapsedDays: 15, totalDays: 30 };
const base: PaceInput = {
  spendShape: 'linear',
  availableCents: 30000,
  spentCents: 0,
  billPosted: false,
  typicalPostDay: null,
};

describe('linear pace', () => {
  it('expects available × pace and places a tick', () => {
    expect(paceFor({ ...base, spentCents: 10000 }, mid)).toEqual({
      expectedSpentCents: 15000,
      headroomCents: 5000,
      status: 'under',
      tick: mid,
    });
    expect(paceFor({ ...base, spentCents: 15000 }, mid).status).toBe('on');
    expect(paceFor({ ...base, spentCents: 20000 }, mid).status).toBe('over');
  });
});

describe('fixed pace', () => {
  const rent: PaceInput = { ...base, spendShape: 'fixed', availableCents: 150000 };

  it('expects nothing before the bill and has no tick', () => {
    expect(paceFor(rent, mid)).toMatchObject({ expectedSpentCents: 0, status: 'on', tick: null });
  });
  it('expects the full amount once posted', () => {
    expect(paceFor({ ...rent, spentCents: 150000, billPosted: true }, mid).status).toBe('on');
  });
  it('expects the full amount once the typical post day has passed', () => {
    expect(paceFor({ ...rent, typicalPostDay: 3 }, mid)).toMatchObject({
      expectedSpentCents: 150000,
      status: 'under',
    });
    expect(paceFor({ ...rent, typicalPostDay: 20 }, mid).expectedSpentCents).toBe(0);
  });
});

describe('staleness', () => {
  const DAY = 86_400_000;
  const now = 1_790_000_000_000;

  it('manual accounts are never stale; never-synced accounts are', () => {
    expect(
      staleness({ source: 'manual', lastSyncedAtMs: null, syncCadenceHours: null }, now),
    ).toEqual({ stale: false });
    expect(
      staleness({ source: 'simplefin', lastSyncedAtMs: null, syncCadenceHours: 24 }, now),
    ).toEqual({
      stale: true,
      reason: 'never_synced',
    });
  });

  it('defaults to a daily cadence', () => {
    const s = { source: 'simplefin' as const, syncCadenceHours: null };
    expect(staleness({ ...s, lastSyncedAtMs: now - DAY }, now)).toEqual({ stale: false });
    expect(staleness({ ...s, lastSyncedAtMs: now - 2 * DAY }, now)).toEqual({
      stale: true,
      reason: 'overdue',
      lastSyncedAtMs: now - 2 * DAY,
      overdueByMs: DAY / 2,
    });
  });

  it('exposes named cadences', () => {
    expect(SYNC_CADENCE_HOURS).toEqual({ daily: 24, monthly: 720 });
  });
});
