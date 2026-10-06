import { applyPlanDefault, buildReallocation, resolvePlanned } from '@rise/shared/budget';
import { PatchAllocationBody, PatchPeriodBody, PeriodId } from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  addPlannedStmt,
  allocationPeriods,
  ensurePeriodStmt,
  insertReallocationStmt,
  listAllocations,
  listCategories,
  listReallocations,
  parseAllocationId,
  planDefaultOf,
  seedAllocationStmt,
  setExpectedIncome,
  setPlanDefaultStmt,
  setPlannedStmt,
} from '../db';
import type { AppEnv } from '../env';
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
  const id = periodParam(c.req.param('id'));
  const userId = c.get('userId');
  const { period, view } = await loadPeriodView(c.env, userId, id);
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
 * T19 / SPEC §2.6. Every change and its log rows apply atomically; optional funding moves
 * money from other categories, and the pool covers the rest, past zero if need be.
 */
allocations.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const parsed = parseAllocationId(c.req.param('id'));
  if (!parsed || !PeriodId.safeParse(parsed.periodId).success)
    throw new AppError(404, 'NOT_FOUND', 'Allocation not found');
  const { periodId, categoryId } = parsed;
  const b = await body(c, PatchAllocationBody);

  const { view } = await loadPeriodView(c.env, userId, periodId);
  const target = view.categories.find((x) => x.categoryId === categoryId);
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Allocation not found');

  // An income category's planned amount is a per-paycheck target, not spending funded
  // from the pool — none of the funding/slack machinery below applies to it.
  if (target.groupKind === 'income') {
    const db = c.env.DB;
    const cats = await listCategories(userId, db);
    const defaults = new Map(cats.map((x) => [x.id, planDefaultOf(x)]));
    const future: D1PreparedStatement[] = [];
    if (b.applyToFuture) {
      const applied = applyPlanDefault({
        periodId,
        plannedCents: b.plannedCents,
        existing: defaults.get(categoryId) ?? null,
        rowPeriods: await allocationPeriods(userId, db, categoryId),
      });
      future.push(
        ...applied.backfill
          .filter((f) => f.periodId !== periodId)
          .map((f) => seedAllocationStmt(userId, db, f.periodId, categoryId, f.plannedCents)),
        ...applied.overwrite.map((p) => setPlannedStmt(userId, db, p, categoryId, b.plannedCents)),
        setPlanDefaultStmt(userId, db, categoryId, applied.next),
      );
    }
    await db.batch([
      ensurePeriodStmt(userId, db, periodId),
      seedAllocationStmt(userId, db, periodId, categoryId, b.plannedCents),
      setPlannedStmt(userId, db, periodId, categoryId, b.plannedCents),
      ...future,
    ]);
    // Paychecks are the period's expected income now (owner, 2026-09-25) — resync it from
    // the sum of every income category's plan so the two can never drift apart.
    const resynced = await loadPeriodView(c.env, userId, periodId);
    const totalIncomePlanned = resynced.view.categories
      .filter((x) => x.groupKind === 'income')
      .reduce((n, x) => n + x.plannedCents, 0);
    await setExpectedIncome(userId, db, periodId, totalIncomePlanned);
    const updated = await loadPeriodView(c.env, userId, periodId);
    return c.json({ period: updated.period, ...updated.view });
  }

  // Planning past income is allowed: the pool covers whatever funding doesn't, even below
  // zero, and the Budget bar shows "Over budget" (Caleb, 2026-10-06).
  const change = {
    targetCategoryId: categoryId,
    oldPlannedCents: target.plannedCents,
    newPlannedCents: b.plannedCents,
  };
  const expense = view.categories.filter((x) => x.groupKind === 'expense');
  const result = buildReallocation(
    change,
    b.funding,
    new Map(expense.map((x) => [x.categoryId, x.plannedCents])),
  );
  if (!result.ok) throw new AppError(400, 'BAD_REQUEST', result.error.message);

  const db = c.env.DB;
  const [cats, rows] = await Promise.all([
    listCategories(userId, db),
    listAllocations(userId, db, periodId),
  ]);
  const defaults = new Map(cats.map((x) => [x.id, planDefaultOf(x)]));
  const hasRow = new Set(rows.map((r) => r.category_id));
  // A new row starts from the month's resolved plan, so creating it changes nothing (§2.9).
  const seed = (id: string) =>
    hasRow.has(id) ? 0 : resolvePlanned(undefined, defaults.get(id) ?? null, periodId);

  const future: D1PreparedStatement[] = [];
  if (b.applyToFuture) {
    const applied = applyPlanDefault({
      periodId,
      plannedCents: b.plannedCents,
      existing: defaults.get(categoryId) ?? null,
      rowPeriods: await allocationPeriods(userId, db, categoryId),
    });
    future.push(
      ...applied.backfill
        .filter((f) => f.periodId !== periodId)
        .map((f) => seedAllocationStmt(userId, db, f.periodId, categoryId, f.plannedCents)),
      ...applied.overwrite.map((p) => setPlannedStmt(userId, db, p, categoryId, b.plannedCents)),
      setPlanDefaultStmt(userId, db, categoryId, applied.next),
    );
  }

  await db.batch([
    ensurePeriodStmt(userId, db, periodId),
    // The edited month's own row: seeded even when the plan doesn't move, so a default
    // change can never reach back into it.
    seedAllocationStmt(userId, db, periodId, categoryId, seed(categoryId)),
    ...result.plannedDeltas.map((d) =>
      addPlannedStmt(userId, db, periodId, d.categoryId, d.deltaCents, seed(d.categoryId)),
    ),
    ...result.rows.map((r) =>
      insertReallocationStmt(userId, db, { periodId, ...r, note: b.note ?? null }),
    ),
    ...future,
  ]);
  const after = await loadPeriodView(c.env, userId, periodId);
  return c.json({ period: after.period, ...after.view });
});
