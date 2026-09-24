import type { CategoryGroupKind, PeriodStatus, RolloverPolicy, SpendShape } from '../schemas/enums';
import { categoryMath } from './category';
import { sumCents, type Cents } from './money';
import { paceFor, type PaceResult } from './pace';
import { pace, type IsoDate, type Pace, type PeriodId } from './period';
import { pool } from './pool';

export interface ViewCategoryInput {
  categoryId: string;
  groupKind: CategoryGroupKind;
  rolloverPolicy: RolloverPolicy;
  spendShape: SpendShape;
  typicalPostDay: number | null;
  carriedInCents: Cents;
  plannedCents: Cents;
  spentCents: Cents;
}

export interface PeriodViewInput {
  periodId: PeriodId;
  status: PeriodStatus;
  today: IsoDate;
  expectedIncomeCents: Cents;
  returnedSurplusPrevCents: Cents;
  categories: readonly ViewCategoryInput[];
}

export interface ViewCategory extends ViewCategoryInput {
  availableCents: Cents;
  remainingCents: Cents;
  /** Null for income categories — pace is about spending. */
  pace: PaceResult | null;
}

export interface PeriodView {
  periodId: PeriodId;
  status: PeriodStatus;
  pace: Pace;
  poolCents: Cents;
  expectedIncomeCents: Cents;
  actualIncomeCents: Cents;
  totals: { plannedCents: Cents; availableCents: Cents; spentCents: Cents; remainingCents: Cents };
  categories: ViewCategory[];
}

/**
 * Everything the Budget tab shows for one month, composed from the engine. Pure, so the
 * client can recompute it optimistically and get exactly what the server returns.
 *
 * Until recurring detection lands (T31), a fixed-shape bill counts as posted once anything
 * has been spent in its category this period.
 */
export function buildPeriodView(input: PeriodViewInput): PeriodView {
  const p = pace(input.periodId, input.today);
  const categories: ViewCategory[] = input.categories.map((c) => {
    const math = categoryMath(c);
    return {
      ...c,
      availableCents: math.availableCents,
      remainingCents: math.remainingCents,
      pace:
        c.groupKind === 'expense'
          ? paceFor(
              {
                spendShape: c.spendShape,
                availableCents: math.availableCents,
                spentCents: c.spentCents,
                billPosted: c.spentCents > 0,
                typicalPostDay: c.typicalPostDay,
              },
              p,
            )
          : null,
    };
  });
  const expense = categories.filter((c) => c.groupKind === 'expense');
  const income = categories.filter((c) => c.groupKind === 'income');
  return {
    periodId: input.periodId,
    status: input.status,
    pace: p,
    poolCents: pool({
      expectedIncomeCents: input.expectedIncomeCents,
      returnedSurplusPrevCents: input.returnedSurplusPrevCents,
      plannedCents: expense.map((c) => c.plannedCents),
    }),
    expectedIncomeCents: input.expectedIncomeCents,
    actualIncomeCents: -sumCents(income.map((c) => c.spentCents)),
    totals: {
      plannedCents: sumCents(expense.map((c) => c.plannedCents)),
      availableCents: sumCents(expense.map((c) => c.availableCents)),
      spentCents: sumCents(expense.map((c) => c.spentCents)),
      remainingCents: sumCents(expense.map((c) => c.remainingCents)),
    },
    categories,
  };
}
