import { addPeriods, nextPeriod, type PeriodId } from './period';

/** A category's plan for months with no allocation row yet (SPEC §2.9). */
export interface PlanDefault {
  cents: number;
  from: PeriodId;
}

/** The plan a month actually uses: its row, else the default once it has started, else 0. */
export function resolvePlanned(
  row: { plannedCents: number } | undefined,
  def: PlanDefault | null,
  periodId: PeriodId,
): number {
  if (row) return row.plannedCents;
  return def && def.from <= periodId ? def.cents : 0;
}

export interface ApplyPlanDefaultInput {
  /** The open month being edited. */
  periodId: PeriodId;
  plannedCents: number;
  existing: PlanDefault | null;
  /** Months that already have an allocation row for this category. */
  rowPeriods: PeriodId[];
}

export interface ApplyPlanDefaultResult {
  next: PlanDefault;
  /** Rows to create (insert-if-missing) so months the old default covered keep their plan. */
  backfill: { periodId: PeriodId; plannedCents: number }[];
  /** Later months whose existing rows take the new plan. */
  overwrite: PeriodId[];
}

/**
 * "Apply to all future months". Moving the default must never change a month it already
 * covered, so those months get the old value written down first.
 */
export function applyPlanDefault(input: ApplyPlanDefaultInput): ApplyPlanDefaultResult {
  const hasRow = new Set(input.rowPeriods);
  const backfill: ApplyPlanDefaultResult['backfill'] = [];
  const old = input.existing;
  if (old) {
    for (let m = old.from; m <= input.periodId; m = addPeriods(m, 1)) {
      if (!hasRow.has(m)) backfill.push({ periodId: m, plannedCents: old.cents });
    }
  }
  return {
    next: { cents: input.plannedCents, from: nextPeriod(input.periodId) },
    backfill,
    overwrite: input.rowPeriods.filter((p) => p > input.periodId).sort(),
  };
}
