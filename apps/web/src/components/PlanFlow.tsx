import type { ViewCategory } from '@rise/shared/budget';
import type { Category } from '@rise/shared/schemas';
import { useState, type ReactNode } from 'react';
import { ApiError, api } from '../lib/api';
import { useInvalidateMoney } from '../lib/queries';
import { FundingSheet, type FundingRequest } from './FundingSheet';
import { PlanEditorSheet, type PlanEdit } from './PlanEditorSheet';

/**
 * Changing a plan, from anywhere: the editor, then — only if the pool can't cover it — the
 * funding sheet (SPEC §2.6). One flow, so the Budget tab and a category page behave the same.
 */
export function usePlanFlow(month: string, categories: Category[]) {
  const invalidate = useInvalidateMoney();
  const [editing, setEditing] = useState<PlanEdit | null>(null);
  const [funding, setFunding] = useState<FundingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setPlanned = async (
    categoryId: string,
    plannedCents: number,
    fund: { fromCategoryId: string; amountCents: number }[],
    applyToFuture: boolean,
  ) => {
    setError(null);
    try {
      await api('PATCH', `/allocations/${month}:${categoryId}`, {
        plannedCents,
        funding: fund,
        applyToFuture,
      });
      setFunding(null);
      setEditing(null);
      await invalidate();
    } catch (e) {
      setEditing(null);
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_POOL') {
        const d = e.detail as { shortfallCents: number; candidates: FundingRequest['candidates'] };
        setFunding({
          categoryId,
          plannedCents,
          shortfallCents: d.shortfallCents,
          candidates: d.candidates,
          applyToFuture,
        });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not save.');
      }
    }
  };

  const sheets: ReactNode = (
    <>
      <PlanEditorSheet
        edit={editing}
        onClose={() => setEditing(null)}
        onSave={(cents, future) =>
          editing ? setPlanned(editing.category.id, cents, [], future) : Promise.resolve()
        }
      />
      <FundingSheet
        request={funding}
        categories={categories}
        onClose={() => setFunding(null)}
        onConfirm={(f) =>
          funding
            ? setPlanned(
                funding.categoryId,
                funding.plannedCents,
                f,
                funding.applyToFuture ?? false,
              )
            : Promise.resolve()
        }
      />
    </>
  );

  return {
    open: (category: Category, row: ViewCategory, poolCents: number) =>
      setEditing({ category, row, month, poolCents }),
    sheets,
    error,
  };
}
