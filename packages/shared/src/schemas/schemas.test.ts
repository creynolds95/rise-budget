import { describe, expect, it } from 'vitest';
import {
  ApiError,
  Cents,
  CreateCategoryBody,
  ManualCashEventBody,
  ScheduleBody,
  PatchAccountBody,
  PatchAllocationBody,
  PatchSettingsBody,
  PeriodId,
  RecurringSeries,
  User,
} from './index';

describe('schemas', () => {
  it('Cents rejects floats', () => {
    expect(Cents.safeParse(1999).success).toBe(true);
    expect(Cents.safeParse(19.99).success).toBe(false);
  });

  it('PeriodId is YYYY-MM', () => {
    expect(PeriodId.safeParse('2026-09').success).toBe(true);
    expect(PeriodId.safeParse('2026-13').success).toBe(false);
  });

  it('applies request defaults', () => {
    expect(CreateCategoryBody.parse({ groupId: 'g', name: 'Rent', isBill: true })).toEqual({
      groupId: 'g',
      name: 'Rent',
      emoji: null,
      isBill: true,
      budgeted: true,
    });
    expect(PatchAllocationBody.parse({ plannedCents: 5000 })).toEqual({
      plannedCents: 5000,
      funding: [],
      applyToFuture: false,
    });
  });

  it('user settings default roll_income_variance on, plan changes to this month only', () => {
    const u = User.parse({
      id: 'u1',
      email: 'me@example.com',
      displayName: 'Me',
      settings: {},
      createdAt: '2026-09-23T20:00:00Z',
    });
    expect(u.settings).toEqual({
      rollIncomeVariance: true,
      appLock: 'off',
      planChangesApplyToFuture: false,
      cushionCents: 50_000,
      cashAccountIds: [],
      dismissedPayMerchants: [],
    });
    expect(u.timezone).toBe('America/Chicago');
  });

  it('error contract carries a stable code', () => {
    expect(
      ApiError.safeParse({ error: { code: 'INSUFFICIENT_POOL', message: 'x', detail: [] } })
        .success,
    ).toBe(true);
    expect(ApiError.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(false);
  });

  it('PATCH bodies never inject defaults for absent keys', () => {
    expect(PatchSettingsBody.parse({ appLock: '5m' })).toEqual({ appLock: '5m' });
    expect(PatchAccountBody.parse({ name: 'USAA Savings' })).toEqual({ name: 'USAA Savings' });
  });

  it('RecurringSeries accepts the `<userId>|<merchant>` id of a long merchant name', () => {
    // A UUID user id plus a merchant over ~27 characters is past 64 — /recurring used to 500
    // on it, which every screen reading it reported as "Couldn't load this screen".
    const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const id = `${uuid}|${uuid}`;
    expect(
      RecurringSeries.safeParse({
        id,
        merchantNormalized: 'x',
        categoryId: null,
        cadence: 'monthly',
        expectedAmountCents: 100,
        nextExpectedDate: null,
        status: 'active',
        updatedAt: '2026-10-01T00:00:00.000Z',
        source: 'manual',
      }).success,
    ).toBe(true);
  });

  it('twice-a-month schedules need their two days, and an edit needs an id or merchant', () => {
    const base = {
      kind: 'income',
      amountCents: 1000,
      cadence: 'semimonthly',
      anchorDate: '2026-10-01',
    };
    expect(ManualCashEventBody.safeParse({ ...base, label: 'Pay' }).success).toBe(false);
    expect(
      ManualCashEventBody.safeParse({ ...base, label: 'Pay', anchorDays: [15, 31] }).success,
    ).toBe(true);
    expect(ScheduleBody.safeParse({ ...base, id: 'x' }).success).toBe(false);
    expect(ScheduleBody.safeParse({ ...base, anchorDays: [1, 15] }).success).toBe(false);
    expect(ScheduleBody.safeParse({ ...base, id: 'x', anchorDays: [1, 15] }).success).toBe(true);
    expect(
      ScheduleBody.safeParse({ ...base, merchant: 'acme', anchorDays: [15, 31] }).success,
    ).toBe(true);
  });
});
