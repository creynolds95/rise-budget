import type { ViewCategory } from '@rise/shared/budget';
import type { Category } from '@rise/shared/schemas';
import { useState, type ReactNode } from 'react';
import { ApiError, api } from '../lib/api';
import { useInvalidateMoney } from '../lib/queries';
import { PlanEditorSheet, type PlanEdit } from './PlanEditorSheet';

/**
 * Changing a plan, from anywhere. Planning past income saves like any other edit; the Budget
 * bar turns "Over budget". One flow, so the Budget tab and a category page behave the same.
 */
export function usePlanFlow(month: string) {
  const invalidate = useInvalidateMoney();
  const [editing, setEditing] = useState<PlanEdit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setPlanned = async (categoryId: string, plannedCents: number, applyToFuture: boolean) => {
    setError(null);
    try {
      await api('PATCH', `/allocations/${month}:${categoryId}`, {
        plannedCents,
        funding: [],
        applyToFuture,
      });
      setEditing(null);
      await invalidate();
    } catch (e) {
      setEditing(null);
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    }
  };

  const sheets: ReactNode = (
    <PlanEditorSheet
      edit={editing}
      onClose={() => setEditing(null)}
      onSave={(cents, future) =>
        editing ? setPlanned(editing.category.id, cents, future) : Promise.resolve()
      }
    />
  );

  return {
    open: (category: Category, row: ViewCategory, poolCents: number) =>
      setEditing({ category, row, month, poolCents }),
    sheets,
    error,
  };
}
