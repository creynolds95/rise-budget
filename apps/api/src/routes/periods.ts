import {
  buildReallocation,
  pace,
  planAllocationChange,
  type SlackInput,
} from '@rise/shared/budget';
import { PatchAllocationBody, PatchPeriodBody, PeriodId } from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  addPlannedStmt,
  ensurePeriodStmt,
  getUser,
  insertReallocationStmt,
  listReallocations,
  parseAllocationId,
  setExpectedIncome,
} from '../db';
import type { AppEnv } from '../env';
import { localToday } from '../lib/dates';
import { AppError } from '../lib/errors';
import { loadPeriodView } from '../lib/period-view';
import { body } from '../lib/validate';

export const periods = new Hono<AppEnv>();
export const allocations = new Hono<AppEnv>();

function periodParam(id: string): string {
  if (!PeriodId.safeParse(id).success)
    throw new AppError(400, 'BAD_REQUEST', 'Period id must be YYYY-MM');
  return id;
}

periods.get('/:id', async (c) => {
  const { period, view } = await loadPeriodView(
    c.env,
    c.get('userId'),
    periodParam(c.req.param('id')),
  );
  return c.json({ period, ...view });
});

periods.patch('/:id', async (c) => {
  const id = periodParam(c.req.param('id'));
  const { expectedIncomeCents } = await body(c, PatchPeriodBody);
  const userId = c.get('userId');
  await setExpectedIncome(userId, c.env.DB, id, expectedIncomeCents);
  const { period, view } = await loadPeriodView(c.env, userId, id);
  return c.json({ period, ...view });
});

periods.get('/:id/reallocations', async (c) => {
  const id = periodParam(c.req.param('id'));
  return c.json(await listReallocations(c.get('userId'), c.env.DB, id));
});

/**
 * T19 / SPEC §2.6. Raising planned beyond the pool without funding → 409 INSUFFICIENT_POOL
 * carrying the ranked candidates. With funding, every change and its log rows apply atomically.
 */
allocations.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const parsed = parseAllocationId(c.req.param('id'));
  if (!parsed || !PeriodId.safeParse(parsed.periodId).success)
    throw new AppError(404, 'NOT_FOUND', 'Allocation not found');
  const { periodId, categoryId } = parsed;
  const b = await body(c, PatchAllocationBody);

  const { period, view } = await loadPeriodView(c.env, userId, periodId);
  const target = view.categories.find(
    (x) => x.categoryId === categoryId && x.groupKind === 'expense',
  );
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Allocation not found');
  if (period.status === 'closed') throw new AppError(409, 'PERIOD_CLOSED', `${periodId} is closed`);

  const change = {
    targetCategoryId: categoryId,
    oldPlannedCents: target.plannedCents,
    newPlannedCents: b.plannedCents,
    poolCents: view.poolCents,
  };
  const expense = view.categories.filter((x) => x.groupKind === 'expense');
  const slackInputs: SlackInput[] = expense.map((x) => ({
    categoryId: x.categoryId,
    spendShape: x.spendShape,
    carriedInCents: x.carriedInCents,
    plannedCents: x.plannedCents,
    spentCents: x.spentCents,
    billPosted: x.spentCents > 0,
  }));
  const user = await getUser(userId, c.env.DB);
  const p = pace(periodId, localToday(user?.timezone ?? 'America/Chicago'));
  const plan = planAllocationChange(change, slackInputs, p);
  if (plan.kind === 'needs_funding' && b.funding.length === 0) {
    throw new AppError(409, 'INSUFFICIENT_POOL', 'Choose where this money comes from', {
      shortfallCents: plan.shortfallCents,
      candidates: plan.candidates,
    });
  }

  const result = buildReallocation(
    change,
    b.funding,
    new Map(expense.map((x) => [x.categoryId, x.plannedCents])),
  );
  if (!result.ok) {
    if (result.error.code === 'INSUFFICIENT_POOL') {
      throw new AppError(409, 'INSUFFICIENT_POOL', 'Funding does not cover the increase', {
        shortfallCents: result.error.shortfallCents,
        candidates: plan.kind === 'needs_funding' ? plan.candidates : [],
      });
    }
    throw new AppError(400, 'BAD_REQUEST', result.error.message);
  }

  const db = c.env.DB;
  await db.batch([
    ensurePeriodStmt(userId, db, periodId),
    ...result.plannedDeltas.map((d) =>
      addPlannedStmt(userId, db, periodId, d.categoryId, d.deltaCents),
    ),
    ...result.rows.map((r) =>
      insertReallocationStmt(userId, db, { periodId, ...r, note: b.note ?? null }),
    ),
  ]);
  const after = await loadPeriodView(c.env, userId, periodId);
  return c.json({ period: after.period, ...after.view });
});
