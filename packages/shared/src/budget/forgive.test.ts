import { describe, expect, it } from 'vitest';
import { forgiveDeficit, type ForgiveInput } from './forgive';

const base: ForgiveInput = {
  categoryId: 'eat',
  periodId: '2026-09',
  periodStatus: 'open',
  carriedInCents: -9300,
  confirmedAmountCents: 9300,
  reason: '  Moving across town — one-off  ',
};

describe('forgiveDeficit', () => {
  it('zeroes a negative carry in an open period and emits an audit payload', () => {
    expect(forgiveDeficit(base)).toEqual({
      ok: true,
      newCarriedInCents: 0,
      audit: {
        action: 'category.deficit_forgiven',
        targetType: 'category',
        targetId: 'eat',
        detail: {
          periodId: '2026-09',
          amountCents: 9300,
          previousCarriedInCents: -9300,
          reason: 'Moving across town — one-off',
        },
      },
    });
  });

  it.each([
    ['closed period', { periodStatus: 'closed' as const }, 'PERIOD_CLOSED'],
    ['positive carry', { carriedInCents: 500 }, 'NOTHING_TO_FORGIVE'],
    ['zero carry', { carriedInCents: 0 }, 'NOTHING_TO_FORGIVE'],
    ['confirmation naming a different amount', { confirmedAmountCents: 9000 }, 'AMOUNT_MISMATCH'],
    ['blank reason', { reason: '   ' }, 'REASON_REQUIRED'],
  ])('refuses a %s', (_label, patch, code) => {
    expect(forgiveDeficit({ ...base, ...patch })).toEqual({ ok: false, code });
  });
});
