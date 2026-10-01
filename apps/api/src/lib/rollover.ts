import {
  addPeriods,
  resolvePlanned,
  rollChain,
  ROLLOVER_START,
  type ChainMonth,
  type RolledInto,
} from '@rise/shared/budget';
import { allocationsBetween, listCategories, listGroups, planDefaultOf, spentBetween } from '../db';
import type { Env } from '../env';

/**
 * Every month's carry-in from the chain start through `to`, keyed by month. Empty when `to` is
 * before the start: those months are history, and nothing carries into or out of them.
 */
export async function loadRollover(
  env: Env,
  userId: string,
  to: string,
): Promise<Map<string, RolledInto>> {
  if (to < ROLLOVER_START) return new Map();
  const db = env.DB;
  const [groups, categories, allocations, spent] = await Promise.all([
    listGroups(userId, db),
    listCategories(userId, db),
    allocationsBetween(userId, db, ROLLOVER_START, to),
    spentBetween(userId, db, ROLLOVER_START, to),
  ]);
  const kind = new Map(groups.map((g) => [g.id, g.kind]));
  const expense = categories.filter((c) => kind.get(c.groupId) !== 'income');
  const alloc = new Map(allocations.map((a) => [`${a.period_id}:${a.category_id}`, a]));
  const spentAt = new Map(spent.map((s) => [`${s.period_id}:${s.category_id}`, s.spent]));

  const months: ChainMonth[] = [];
  for (let m = ROLLOVER_START; m <= to; m = addPeriods(m, 1)) {
    months.push({
      periodId: m,
      categories: expense.map((c) => {
        const a = alloc.get(`${m}:${c.id}`);
        return {
          categoryId: c.id,
          rolloverPolicy: c.rolloverPolicy,
          plannedCents: resolvePlanned(a && { plannedCents: a.planned_cents }, planDefaultOf(c), m),
          spentCents: spentAt.get(`${m}:${c.id}`) ?? 0,
          adjustCents: a?.carry_adjust_cents ?? 0,
        };
      }),
    });
  }
  const rolled = rollChain(months);
  return new Map(rolled.map((r) => [r.periodId, r]));
}
