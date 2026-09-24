import { describe, expect, it } from 'vitest';
import {
  ApiError,
  Cents,
  CreateCategoryBody,
  PatchAccountBody,
  PatchAllocationBody,
  PatchSettingsBody,
  PeriodId,
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
});
