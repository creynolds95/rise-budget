import {
  buildReallocation,
  closePeriod,
  hasEnded,
  nextPeriod,
  pace,
  planAllocationChange,
  prevPeriod,
  recalculateCascade,
  type SlackInput,
} from '@rise/shared/budget';
import {
  ClosePeriodBody,
  PatchAllocationBody,
  PatchPeriodBody,
  PeriodId,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  addPlannedStmt,
  closeWriteStmts,
  dismissRecalcFlag,
  ensurePeriodStmt,
  getPeriod,
  getUser,
  listPeriodsFrom,
  writeAudit,
  insertReallocationStmt,
  listReallocations,
  parseAllocationId,
  setExpectedIncome,
} from '../db';
import type { AppEnv } from '../env';
import { loadCloseInput, loadCloseStatus } from '../lib/close';
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
  const id = periodParam(c.req.param('id'));
  const userId = c.get('userId');
  const [{ period, view }, close] = await Promise.all([
    loadPeriodView(c.env, userId, id),
    loadCloseStatus(c.env, userId, id),
  ]);
  return c.json({ period, ...view, close });
});

/**
 * SPEC §2.4. Only ever on the user's explicit confirm — there is no background close.
 * Re-closing is a no-op that returns the frozen period.
 */
periods.post('/:id/close', async (c) => {
  const id = periodParam(c.req.param('id'));
  const userId = c.get('userId');
  const db = c.env.DB;
  const { override } = await body(c, ClosePeriodBody);
  const [input, status, user] = await Promise.all([
    loadCloseInput(c.env, userId, id),
    loadCloseStatus(c.env, userId, id),
    getUser(userId, db),
  ]);
  const today = localToday(user?.timezone ?? 'America/Chicago');

  // Close in order: a later month's carry-in depends on this one, and a closed month is never restated.
  if (input.status === 'open') {
    const [prev, next] = await Promise.all([
      getPeriod(userId, db, prevPeriod(id)),
      getPeriod(userId, db, nextPeriod(id)),
    ]);
    if (prev?.status === 'open' && hasEnded(prev.id, today)) {
      throw new AppError(409, 'CONFLICT', `Close ${prev.id} first`);
    }
    if (next?.status === 'closed')
      throw new AppError(409, 'CONFLICT', `${next.id} is already closed`);
  }

  const result = closePeriod(input, { today, readiness: status.readiness, override });
  switch (result.kind) {
    case 'not_ended':
      throw new AppError(409, 'PERIOD_NOT_ENDED', `${id} hasn't ended yet`);
    case 'waiting':
      throw new AppError(
        409,
        'PERIOD_NOT_READY',
        'Some accounts have not reported past the end of the month',
        {
          waitingOn: result.waitingOn,
        },
      );
    case 'already_closed':
      return c.json({ period: await getPeriod(userId, db, id), alreadyClosed: true });
    case 'closed':
      await db.batch(closeWriteStmts(userId, db, result.outcome, new Date().toISOString()));
      await writeAudit(userId, db, 'period.closed', {
        type: 'period',
        id,
        detail: {
          overridden: result.overridden,
          returnedSurplusCents: result.outcome.returnedSurplusCents,
        },
      });
      return c.json({
        period: await getPeriod(userId, db, id),
        alreadyClosed: false,
        outcome: result.outcome,
      });
  }
});

/**
 * SPEC §2.5 "Recalculate carry-forward": re-run close for P and every later closed period, in
 * order, writing the first open period's carry-in last. Only on explicit request.
 */
periods.post('/:id/recalculate', async (c) => {
  const id = periodParam(c.req.param('id'));
  const userId = c.get('userId');
  const db = c.env.DB;
  const start = await getPeriod(userId, db, id);
  if (!start || start.status !== 'closed')
    throw new AppError(409, 'CONFLICT', `${id} is not closed`);

  // P and every contiguous closed period after it, then the first open one.
  const stored = await listPeriodsFrom(userId, db, id);
  const chain: string[] = [];
  let expected = id;
  for (const p of stored) {
    if (p.id !== expected || p.status !== 'closed') break;
    chain.push(p.id);
    expected = nextPeriod(p.id);
  }
  const inputs = await Promise.all(
    [...chain, expected].map((pid) => loadCloseInput(c.env, userId, pid)),
  );
  const outcomes = recalculateCascade(inputs);
  const closedAt = new Date().toISOString();
  await db.batch(outcomes.flatMap((o) => closeWriteStmts(userId, db, o, closedAt)));
  await writeAudit(userId, db, 'period.recalculated', {
    type: 'period',
    id,
    detail: { periods: outcomes.map((o) => o.periodId) },
  });
  return c.json({ recalculated: outcomes.map((o) => o.periodId), outcomes });
});

/** "Leave as is": keep the frozen numbers, clear the banner. */
periods.post('/:id/dismiss-recalc', async (c) => {
  const id = periodParam(c.req.param('id'));
  const userId = c.get('userId');
  await dismissRecalcFlag(userId, c.env.DB, id);
  return c.json({ period: await getPeriod(userId, c.env.DB, id) });
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
