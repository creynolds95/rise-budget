import type { PeriodStatus } from '../schemas/enums';
import { assertCents, type Cents } from './money';
import type { PeriodId } from './period';

export interface ForgiveInput {
  categoryId: string;
  periodId: PeriodId;
  periodStatus: PeriodStatus;
  carriedInCents: Cents;
  /** The amount the user confirmed — must name the deficit exactly. */
  confirmedAmountCents: Cents;
  reason: string;
}

export type ForgiveResult =
  | {
      ok: true;
      newCarriedInCents: 0;
      audit: {
        action: 'category.deficit_forgiven';
        targetType: 'category';
        targetId: string;
        detail: {
          periodId: PeriodId;
          amountCents: Cents;
          previousCarriedInCents: Cents;
          reason: string;
        };
      };
    }
  | {
      ok: false;
      code: 'PERIOD_CLOSED' | 'NOTHING_TO_FORGIVE' | 'AMOUNT_MISMATCH' | 'REASON_REQUIRED';
    };

/**
 * SPEC §2.8. Zeroes a NEGATIVE carried_in, only in an OPEN period, only when the confirmed
 * amount matches the deficit, and always emits an audit payload.
 */
export function forgiveDeficit(input: ForgiveInput): ForgiveResult {
  const carried = assertCents(input.carriedInCents, 'carriedInCents');
  if (input.periodStatus !== 'open') return { ok: false, code: 'PERIOD_CLOSED' };
  if (carried >= 0) return { ok: false, code: 'NOTHING_TO_FORGIVE' };
  if (assertCents(input.confirmedAmountCents, 'confirmedAmountCents') !== -carried) {
    return { ok: false, code: 'AMOUNT_MISMATCH' };
  }
  const reason = input.reason.trim();
  if (reason === '') return { ok: false, code: 'REASON_REQUIRED' };
  return {
    ok: true,
    newCarriedInCents: 0,
    audit: {
      action: 'category.deficit_forgiven',
      targetType: 'category',
      targetId: input.categoryId,
      detail: {
        periodId: input.periodId,
        amountCents: -carried,
        previousCarriedInCents: carried,
        reason,
      },
    },
  };
}
