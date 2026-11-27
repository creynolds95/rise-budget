import { applyTolerance, type ViewCategory } from '@rise/shared/budget';

export interface OverItem {
  categoryId: string;
  /** Always negative: how far past what was available (planned plus carry) the spend is. */
  remainingCents: number;
}

/**
 * Budgeted expense categories that are over budget, worst first. Uses the same remaining
 * (rounding tolerance included) the Budget page shows, so the two never disagree. Fixed
 * categories count like any other once their bill lands.
 */
export function overBudgetItems(
  rows: readonly ViewCategory[],
  isBudgeted: (categoryId: string) => boolean,
): OverItem[] {
  return rows
    .filter((r) => r.groupKind === 'expense' && isBudgeted(r.categoryId))
    .map((r) => ({ categoryId: r.categoryId, remainingCents: applyTolerance(r).remainingCents }))
    .filter((r) => r.remainingCents < 0)
    .sort((a, b) => a.remainingCents - b.remainingCents);
}
