import { assertCents, sumCents, type Cents } from './money';

export interface SplitAmount {
  categoryId: string;
  amountCents: Cents;
}

export type SplitValidation =
  | { ok: true }
  | { ok: false; code: 'SPLITS_DO_NOT_SUM'; expectedCents: Cents; actualCents: Cents }
  | { ok: false; code: 'NO_SPLITS' };

/** SPEC §3.5 / edge 11: splits must sum exactly to the parent amount. */
export function validateSplits(
  parentCents: Cents,
  splits: readonly SplitAmount[],
): SplitValidation {
  assertCents(parentCents, 'parentCents');
  if (splits.length === 0) return { ok: false, code: 'NO_SPLITS' };
  const actual = sumCents(splits.map((s) => s.amountCents));
  if (actual !== parentCents) {
    return {
      ok: false,
      code: 'SPLITS_DO_NOT_SUM',
      expectedCents: parentCents,
      actualCents: actual,
    };
  }
  return { ok: true };
}

/** The split editor's auto-computed last row (SPEC §3.5). */
export function remainderForLastSplit(parentCents: Cents, others: readonly Cents[]): Cents {
  return assertCents(parentCents, 'parentCents') - sumCents(others);
}
