import { describe, expect, it } from 'vitest';
import { applyPlanDefault, resolvePlanned } from './plan-default';

describe('resolvePlanned (SPEC §2.9)', () => {
  const def = { cents: 40000, from: '2026-10' };

  it('uses the allocation row when one exists, even over a default', () => {
    expect(resolvePlanned({ plannedCents: 12000 }, def, '2026-11')).toBe(12000);
  });
  it('uses the default from its first month onward', () => {
    expect(resolvePlanned(undefined, def, '2026-10')).toBe(40000);
    expect(resolvePlanned(undefined, def, '2027-03')).toBe(40000);
  });
  it('is 0 before the default starts', () => {
    expect(resolvePlanned(undefined, def, '2026-09')).toBe(0);
  });
  it('is 0 with no row and no default', () => {
    expect(resolvePlanned(undefined, null, '2026-09')).toBe(0);
  });
});

describe('applyPlanDefault (SPEC §2.9)', () => {
  it('starts a default the month after the edit', () => {
    expect(
      applyPlanDefault({
        periodId: '2026-09',
        plannedCents: 50000,
        existing: null,
        rowPeriods: [],
      }),
    ).toEqual({ next: { cents: 50000, from: '2026-10' }, backfill: [], overwrite: [] });
  });

  it('backfills months the old default covered, so they keep their plan', () => {
    const r = applyPlanDefault({
      periodId: '2026-09',
      plannedCents: 50000,
      existing: { cents: 30000, from: '2026-06' },
      rowPeriods: ['2026-07'],
    });
    expect(r.backfill).toEqual([
      { periodId: '2026-06', plannedCents: 30000 },
      { periodId: '2026-08', plannedCents: 30000 },
      { periodId: '2026-09', plannedCents: 30000 },
    ]);
    expect(r.next).toEqual({ cents: 50000, from: '2026-10' });
  });

  it('backfills nothing when the old default had not started yet', () => {
    const r = applyPlanDefault({
      periodId: '2026-09',
      plannedCents: 0,
      existing: { cents: 30000, from: '2026-10' },
      rowPeriods: [],
    });
    expect(r.backfill).toEqual([]);
    expect(r.next).toEqual({ cents: 0, from: '2026-10' });
  });

  it('overwrites rows already written for later months, and only those', () => {
    const r = applyPlanDefault({
      periodId: '2026-09',
      plannedCents: 50000,
      existing: null,
      rowPeriods: ['2026-08', '2026-09', '2026-10', '2026-12'],
    });
    expect(r.overwrite).toEqual(['2026-10', '2026-12']);
  });
});
