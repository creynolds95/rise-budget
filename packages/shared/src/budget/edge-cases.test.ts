/**
 * SPEC §11 — the edge cases that silently corrupt financial data. Each has a named test.
 * Engine-level cases are covered here; the rest are marked with the task that owns them.
 */
import { describe, expect, it } from 'vitest';
import { spentFrom, categoryMath } from './category';
import { closePeriod, closeReadiness, computeClose, recordSplitChange } from './close';
import { paceFor, staleness, SYNC_CADENCE_HOURS } from './pace';
import { pace } from './period';
import { pool } from './pool';
import { buildReallocation, planAllocationChange } from './reallocation';
import { validateSplits } from './splits';
import { cat, period, slackCat } from './test-helpers';

describe('SPEC §11 edge cases', () => {
  it.todo('#1 two identical CSV rows same day both survive — CSV import dropped by owner (T30)');
  it.todo(
    '#2 re-importing an overlapping CSV range yields zero duplicates — CSV import dropped by owner (T30)',
  );

  it('#3 a credit-card payment from checking is a transfer and never counts as spending', () => {
    // Both legs of the payment are linked as a transfer (detection is T29); the budget sees
    // only the card purchase.
    const purchase = { amountCents: 8_450, isTransfer: false, isDropped: false };
    const paymentFromChecking = { amountCents: 8_450, isTransfer: true, isDropped: false };
    const paymentToCard = { amountCents: -8_450, isTransfer: true, isDropped: false };
    expect(spentFrom([purchase, paymentFromChecking, paymentToCard])).toBe(8_450);
  });

  // #4 lives in src/sync/sync.test.ts (planning) and apps/api/test/sync.test.ts (preservation).

  it('#5 a transaction posting into a closed period flags it and recalculates nothing', () => {
    const sept = { status: 'closed' as const, needsRecalc: false, recalcDeltaCents: 0 };
    const after = recordSplitChange(sept, 41_230);
    expect(after).toEqual({ status: 'closed', needsRecalc: true, recalcDeltaCents: 41_230 });
    // The flag is the only output — no carry, no close outcome is produced.
    expect(Object.keys(after).sort()).toEqual(['needsRecalc', 'recalcDeltaCents', 'status']);
  });

  it('#6 changing rollover policy after a close leaves history unchanged; next close uses it', () => {
    const today = '2026-10-05';
    const ready = { ready: true, waitingOn: [] };
    const sept = period({
      periodId: '2026-09',
      categories: [
        cat({
          categoryId: 'gifts',
          rolloverPolicy: 'roll',
          plannedCents: 10_000,
          spentCents: 4_000,
        }),
      ],
    });
    const closed = closePeriod(sept, { today, readiness: ready, override: false });
    expect(closed.kind === 'closed' && closed.outcome.carryIn).toEqual([
      { categoryId: 'gifts', carriedInCents: 6_000 },
    ]);

    // Policy flips to return_to_pool. September is closed: re-closing is a no-op, not a restatement.
    const septAfterFlip = {
      ...sept,
      status: 'closed' as const,
      categories: [
        cat({
          categoryId: 'gifts',
          rolloverPolicy: 'return_to_pool',
          plannedCents: 10_000,
          spentCents: 4_000,
        }),
      ],
    };
    expect(closePeriod(septAfterFlip, { today, readiness: ready, override: false })).toEqual({
      kind: 'already_closed',
    });

    // October's close uses the new policy.
    const oct = period({
      periodId: '2026-10',
      categories: [
        cat({
          categoryId: 'gifts',
          rolloverPolicy: 'return_to_pool',
          carriedInCents: 6_000,
          plannedCents: 10_000,
          spentCents: 1_000,
        }),
      ],
    });
    const out = computeClose(oct);
    expect(out.carryIn).toEqual([{ categoryId: 'gifts', carriedInCents: 0 }]);
    expect(out.returnedSurplusCents).toBe(15_000);
  });

  it('#7 a deficit carries regardless of policy', () => {
    for (const rolloverPolicy of ['roll', 'return_to_pool'] as const) {
      const out = computeClose(
        period({
          periodId: '2026-09',
          categories: [
            cat({
              categoryId: 'eat',
              rolloverPolicy,
              carriedInCents: -4_000,
              plannedCents: 30_000,
              spentCents: 29_300,
            }),
          ],
        }),
      );
      expect(out.carryIn).toEqual([{ categoryId: 'eat', carriedInCents: -3_300 }]);
      expect(out.returnedSurplusCents).toBe(0);
    }
  });

  it('#8 a reallocation exceeding the pool requires a funding source before commit', () => {
    const p = pace('2026-09', '2026-09-15');
    const change = {
      targetCategoryId: 'gas',
      oldPlannedCents: 20_000,
      newPlannedCents: 30_000,
      poolCents: 4_000,
    };
    const cats = [
      slackCat({ categoryId: 'eat', plannedCents: 30_000, spentCents: 5_000 }),
      slackCat({ categoryId: 'gas', plannedCents: 20_000 }),
    ];
    const plan = planAllocationChange(change, cats, p);
    expect(plan).toEqual({
      kind: 'needs_funding',
      deltaCents: 10_000,
      shortfallCents: 6_000,
      candidates: [{ categoryId: 'eat', slackCents: 10_000 }],
    });
    // Committing without funding is refused.
    expect(buildReallocation(change, [], new Map([['eat', 30_000]]))).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_POOL', shortfallCents: 6_000 },
    });
  });

  it('#9 a fixed-shape category on day 1 does not report overspent', () => {
    const day1 = pace('2026-09', '2026-09-01');
    const rent = {
      spendShape: 'fixed' as const,
      availableCents: 150_000,
      billPosted: false,
      typicalPostDay: 1,
    };
    expect(paceFor({ ...rent, spentCents: 0 }, day1).status).not.toBe('over');
    expect(paceFor({ ...rent, spentCents: 150_000, billPosted: true }, day1).status).not.toBe(
      'over',
    );
  });

  const DAY = 86_400_000;
  const now = 1_790_000_000_000;
  const appleCard = { source: 'simplefin' as const, syncCadenceHours: SYNC_CADENCE_HOURS.monthly };

  it('#10 a monthly-cadence account 20 days since sync is NOT stale', () => {
    expect(staleness({ ...appleCard, lastSyncedAtMs: now - 20 * DAY }, now)).toEqual({
      stale: false,
    });
  });

  it('#10b a monthly-cadence account 45 days since sync is stale, with a reason and no estimate', () => {
    const s = staleness({ ...appleCard, lastSyncedAtMs: now - 45 * DAY }, now);
    expect(s).toEqual({
      stale: true,
      reason: 'overdue',
      lastSyncedAtMs: now - 45 * DAY,
      overdueByMs: 0,
    });
    expect(Object.keys(s)).not.toContain('estimatedMissingCents');
  });

  it('#10c close before an account reports past period end explains the wait; override permitted', () => {
    const readiness = closeReadiness('2026-09', [
      {
        accountId: 'apple',
        name: 'Apple Card',
        source: 'simplefin',
        includeInBudget: true,
        lastSyncedDate: '2026-09-01',
      },
    ]);
    const sept = period({ periodId: '2026-09' });
    expect(closePeriod(sept, { today: '2026-10-01', readiness, override: false })).toEqual({
      kind: 'waiting',
      waitingOn: [{ accountId: 'apple', name: 'Apple Card', lastSyncedDate: '2026-09-01' }],
    });
    expect(closePeriod(sept, { today: '2026-10-01', readiness, override: true })).toMatchObject({
      kind: 'closed',
      overridden: true,
    });
  });

  it('#11 split amounts not summing to the parent are rejected with a clear error', () => {
    expect(
      validateSplits(10_000, [
        { categoryId: 'home', amountCents: 6_000 },
        { categoryId: 'kids', amountCents: 3_999 },
      ]),
    ).toEqual({ ok: false, code: 'SPLITS_DO_NOT_SUM', expectedCents: 10_000, actualCents: 9_999 });
  });

  // #12 lives in src/sync/sync.test.ts and apps/api/test/sync.test.ts.

  it('#13 a refund reduces spent and may push remaining positive', () => {
    const spent = spentFrom([
      { amountCents: 12_000, isTransfer: false, isDropped: false },
      { amountCents: -5_000, isTransfer: false, isDropped: false },
    ]);
    expect(spent).toBe(7_000);
    expect(
      categoryMath({ carriedInCents: -2_000, plannedCents: 8_000, spentCents: spent })
        .remainingCents,
    ).toBe(-1_000);
    expect(
      categoryMath({ carriedInCents: 0, plannedCents: 8_000, spentCents: spent }).remainingCents,
    ).toBe(1_000);
  });

  it('#14 a period with no allocations: pool equals expected income, no divide-by-zero in pace', () => {
    expect(
      pool({ expectedIncomeCents: 520_000, returnedSurplusPrevCents: 0, plannedCents: [] }),
    ).toBe(520_000);
    const p = pace('2026-02', '2026-02-01');
    expect(p.totalDays).toBeGreaterThan(0);
    expect(
      paceFor(
        {
          spendShape: 'linear',
          availableCents: 0,
          spentCents: 0,
          billPosted: false,
          typicalPostDay: null,
        },
        p,
      ),
    ).toMatchObject({ expectedSpentCents: 0, status: 'on' });
  });

  // #15 lives in apps/api/test/idempotency.test.ts: it needs the Worker and D1.
});
