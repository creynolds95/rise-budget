import { describe, expect, it } from 'vitest';
import {
  closePeriod,
  closeReadiness,
  computeCarryOut,
  computeClose,
  dismissRecalc,
  RecalcError,
  recalculateCascade,
  recordSplitChange,
  type ReadinessAccount,
} from './close';
import { cat, period } from './test-helpers';

describe('computeCarryOut', () => {
  it('roll carries surplus', () => {
    expect(computeCarryOut('roll', 2500)).toEqual({ carriedOutCents: 2500, returnedCents: 0 });
  });
  it('return_to_pool returns surplus', () => {
    expect(computeCarryOut('return_to_pool', 2500)).toEqual({
      carriedOutCents: 0,
      returnedCents: 2500,
    });
  });
});

describe('computeClose', () => {
  const sept = period({
    periodId: '2026-09',
    status: 'closed',
    expectedIncomeCents: 500000,
    actualIncomeCents: 520000,
    categories: [
      cat({ categoryId: 'groceries', plannedCents: 60000, spentCents: 55000 }),
      cat({
        categoryId: 'rent',
        rolloverPolicy: 'return_to_pool',
        plannedCents: 150000,
        spentCents: 145000,
      }),
    ],
  });

  it('carries roll surplus, returns pool surplus, ignores variance when off', () => {
    expect(computeClose(sept)).toEqual({
      periodId: '2026-09',
      nextPeriodId: '2026-10',
      carryIn: [
        { categoryId: 'groceries', carriedInCents: 5000 },
        { categoryId: 'rent', carriedInCents: 0 },
      ],
      returnedSurplusCents: 5000,
    });
  });

  it('adds income variance when enabled (SPEC §2.3)', () => {
    expect(computeClose({ ...sept, rollIncomeVariance: true }).returnedSurplusCents).toBe(25000);
    expect(
      computeClose({ ...sept, rollIncomeVariance: true, actualIncomeCents: 480000 })
        .returnedSurplusCents,
    ).toBe(-15000);
  });

  it('is deterministic, so closing is idempotent', () => {
    expect(computeClose(sept)).toEqual(computeClose(sept));
  });
});

describe('closeReadiness', () => {
  const accts: ReadinessAccount[] = [
    {
      accountId: 'usaa',
      name: 'USAA Checking',
      source: 'simplefin',
      includeInBudget: true,
      lastSyncedDate: '2026-10-02',
    },
    {
      accountId: 'apple',
      name: 'Apple Card',
      source: 'simplefin',
      includeInBudget: true,
      lastSyncedDate: '2026-09-30',
    },
    {
      accountId: 'new',
      name: 'Citi Credit',
      source: 'simplefin',
      includeInBudget: true,
      lastSyncedDate: null,
    },
    {
      accountId: 'sav',
      name: 'Apple Savings',
      source: 'simplefin',
      includeInBudget: false,
      lastSyncedDate: '2026-09-01',
    },
    {
      accountId: 'loan',
      name: 'Car loan',
      source: 'manual',
      includeInBudget: true,
      lastSyncedDate: null,
    },
  ];

  it('waits on every budget account that has not reported past period end', () => {
    expect(closeReadiness('2026-09', accts)).toEqual({
      ready: false,
      waitingOn: [
        { accountId: 'apple', name: 'Apple Card', lastSyncedDate: '2026-09-30' },
        { accountId: 'new', name: 'Citi Credit', lastSyncedDate: null },
      ],
    });
  });

  it('is ready once all have reported', () => {
    expect(closeReadiness('2026-09', accts.slice(0, 1))).toEqual({ ready: true, waitingOn: [] });
  });
});

describe('closePeriod guards', () => {
  const ready = { ready: true, waitingOn: [] };
  const open = period({ periodId: '2026-09' });

  it('refuses a period that has not ended', () => {
    expect(closePeriod(open, { today: '2026-09-30', readiness: ready, override: false })).toEqual({
      kind: 'not_ended',
    });
  });
  it('is a no-op on a closed period', () => {
    expect(
      closePeriod(
        { ...open, status: 'closed' },
        { today: '2026-10-05', readiness: ready, override: false },
      ),
    ).toEqual({ kind: 'already_closed' });
  });
  it('closes when ready', () => {
    const r = closePeriod(open, { today: '2026-10-05', readiness: ready, override: false });
    expect(r).toMatchObject({ kind: 'closed', overridden: false });
  });
});

describe('late arrivals', () => {
  it('ignores open periods and zero deltas', () => {
    const open = { status: 'open' as const, needsRecalc: false, recalcDeltaCents: 0 };
    expect(recordSplitChange(open, 500)).toBe(open);
    const closed = { status: 'closed' as const, needsRecalc: false, recalcDeltaCents: 0 };
    expect(recordSplitChange(closed, 0)).toBe(closed);
  });
  it('accumulates deltas and can be dismissed', () => {
    let p = { status: 'closed' as const, needsRecalc: false, recalcDeltaCents: 0 };
    p = recordSplitChange(p, 41230) as typeof p;
    p = recordSplitChange(p, -230) as typeof p;
    expect(p).toEqual({ status: 'closed', needsRecalc: true, recalcDeltaCents: 41000 });
    expect(dismissRecalc(p)).toEqual({ status: 'closed', needsRecalc: false, recalcDeltaCents: 0 });
  });
});

describe('recalculateCascade', () => {
  it('rejects bad input', () => {
    expect(() => recalculateCascade([])).toThrow(RecalcError);
    expect(() => recalculateCascade([period({ periodId: '2026-09' })])).toThrow(RecalcError);
    expect(() =>
      recalculateCascade([
        period({ periodId: '2026-08', status: 'closed' }),
        period({ periodId: '2026-10', status: 'closed' }),
      ]),
    ).toThrow(RecalcError);
  });

  it('cascades through every later closed period and stops at the open one', () => {
    // August closed with eating-out at 0 carry; $100 of late spending then landed in August.
    const aug = period({
      periodId: '2026-08',
      status: 'closed',
      categories: [cat({ categoryId: 'eat', plannedCents: 30000, spentCents: 40000 })],
    });
    const sep = period({
      periodId: '2026-09',
      status: 'closed',
      categories: [
        cat({ categoryId: 'eat', carriedInCents: 0, plannedCents: 30000, spentCents: 25000 }),
        cat({ categoryId: 'new', plannedCents: 1000 }),
      ],
    });
    const oct = period({
      periodId: '2026-10',
      categories: [cat({ categoryId: 'eat', plannedCents: 30000 })],
    });

    const out = recalculateCascade([aug, sep, oct]);
    expect(out.map((o) => o.periodId)).toEqual(['2026-08', '2026-09']);
    expect(out[0]?.carryIn).toEqual([{ categoryId: 'eat', carriedInCents: -10000 }]);
    // September now starts $100 underwater: −10000 + 30000 − 25000 = −5000 carries into October.
    expect(out[1]?.carryIn).toEqual([
      { categoryId: 'eat', carriedInCents: -5000 },
      { categoryId: 'new', carriedInCents: 1000 },
    ]);
  });

  it('handles a run of closed periods with no open tail', () => {
    expect(recalculateCascade([period({ periodId: '2026-08', status: 'closed' })])).toHaveLength(1);
  });
});
