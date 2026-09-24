import {
  buildPeriodView,
  prevPeriod,
  resolvePlanned,
  type PeriodView,
  type ViewCategoryInput,
} from '@rise/shared/budget';
import type { Period } from '@rise/shared/schemas';
import {
  blankPeriod,
  getPeriod,
  getUser,
  listAllocations,
  listCategories,
  listGroups,
  planDefaultOf,
  spentByCategory,
} from '../db';
import type { Env } from '../env';
import { localToday } from './dates';

export interface LoadedPeriod {
  period: Period;
  view: PeriodView;
}

/** Reads everything one month needs and hands it to the pure engine. */
export async function loadPeriodView(
  env: Env,
  userId: string,
  periodId: string,
): Promise<LoadedPeriod> {
  const db = env.DB;
  const [user, period, prev, groups, categories, allocations, spent] = await Promise.all([
    getUser(userId, db),
    getPeriod(userId, db, periodId),
    getPeriod(userId, db, prevPeriod(periodId)),
    listGroups(userId, db),
    listCategories(userId, db),
    listAllocations(userId, db, periodId),
    spentByCategory(userId, db, periodId),
  ]);
  const p = period ?? blankPeriod(periodId);
  const kind = new Map(groups.map((g) => [g.id, g.kind]));
  const alloc = new Map(allocations.map((a) => [a.category_id, a]));
  const inputs: ViewCategoryInput[] = categories.map((c) => ({
    categoryId: c.id,
    groupKind: kind.get(c.groupId) ?? 'expense',
    rolloverPolicy: c.rolloverPolicy,
    spendShape: c.spendShape,
    typicalPostDay: c.typicalPostDay,
    carriedInCents: alloc.get(c.id)?.carried_in_cents ?? 0,
    plannedCents: resolvePlanned(
      alloc.has(c.id) ? { plannedCents: alloc.get(c.id)?.planned_cents ?? 0 } : undefined,
      planDefaultOf(c),
      periodId,
    ),
    spentCents: spent.get(c.id) ?? 0,
  }));
  const view = buildPeriodView({
    periodId,
    status: p.status,
    today: localToday(user?.timezone ?? 'America/Chicago'),
    expectedIncomeCents: p.expectedIncomeCents,
    returnedSurplusPrevCents: prev?.status === 'closed' ? prev.returnedSurplusCents : 0,
    categories: inputs,
  });
  return { period: p, view };
}
