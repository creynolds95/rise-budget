import { describe, expect, it } from 'vitest';
import { buildPeriodView, type ViewCategoryInput } from './view';

const cat = (o: Partial<ViewCategoryInput> & { categoryId: string }): ViewCategoryInput => ({
  groupKind: 'expense',
  rolloverPolicy: 'roll',
  spendShape: 'linear',
  typicalPostDay: null,
  carriedInCents: 0,
  plannedCents: 0,
  spentCents: 0,
  ...o,
});

describe('buildPeriodView', () => {
  it('composes category math, pace, pool and totals', () => {
    const v = buildPeriodView({
      periodId: '2026-09',
      status: 'open',
      today: '2026-09-15',
      expectedIncomeCents: 500_000,
      returnedSurplusPrevCents: 10_000,
      categories: [
        cat({
          categoryId: 'eat',
          carriedInCents: -4_000,
          plannedCents: 30_000,
          spentCents: 18_200,
        }),
        cat({
          categoryId: 'rent',
          spendShape: 'fixed',
          rolloverPolicy: 'return_to_pool',
          plannedCents: 150_000,
          spentCents: 150_000,
        }),
        cat({ categoryId: 'phone', spendShape: 'fixed', plannedCents: 8_000 }),
        cat({ categoryId: 'pay', groupKind: 'income', spentCents: -260_000 }),
      ],
    });
    expect(v.pace).toEqual({ elapsedDays: 15, totalDays: 30 });
    expect(v.poolCents).toBe(500_000 + 10_000 - 188_000);
    expect(v.actualIncomeCents).toBe(260_000);
    expect(v.totals).toEqual({
      plannedCents: 188_000,
      availableCents: 184_000,
      spentCents: 168_200,
      remainingCents: 15_800,
    });

    const [eat, rent, phone, pay] = v.categories;
    expect(eat).toMatchObject({
      availableCents: 26_000,
      remainingCents: 7_800,
      pace: { expectedSpentCents: 13_000, status: 'over' },
    });
    expect(rent?.pace).toMatchObject({ expectedSpentCents: 150_000, status: 'on', tick: null });
    expect(phone?.pace).toMatchObject({ expectedSpentCents: 0, status: 'on' });
    expect(pay?.pace).toBeNull();
  });

  it('an empty period: pool equals income, nothing divides by zero (edge 14)', () => {
    const v = buildPeriodView({
      periodId: '2026-02',
      status: 'open',
      today: '2026-02-01',
      expectedIncomeCents: 520_000,
      returnedSurplusPrevCents: 0,
      categories: [],
    });
    expect(v.poolCents).toBe(520_000);
    expect(v.totals).toEqual({
      plannedCents: 0,
      availableCents: 0,
      spentCents: 0,
      remainingCents: 0,
    });
  });
});
