import { categoryDefaults, forgiveDeficit, resolvePlanned } from '@rise/shared/budget';
import { budgetedInGroup } from '@rise/shared/categorize';
import {
  CreateCategoryBody,
  CreateCategoryGroupBody,
  ForgiveBody,
  PatchCategoryBody,
  PatchCategoryGroupBody,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  archiveCategoryStmts,
  archiveGroup,
  categoryHistory,
  categoryMoneyInOpenMonths,
  forgiveCarryStmt,
  clearCategoryOpenAllocationsStmt,
  createCategory,
  createGroup,
  deleteGroup,
  ensureCatchallCategory,
  getCategory,
  getGroup,
  getUser,
  groupHasActiveCategories,
  groupHasCategories,
  listAllocations,
  listCategories,
  listGroups,
  listRules,
  planDefaultOf,
  reassignOpenCategoryStmts,
  updateCategory,
  updateGroup,
  writeAudit,
} from '../db';
import type { AppEnv } from '../env';
import { localToday } from '../lib/dates';
import { loadRollover } from '../lib/rollover';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';

export const categories = new Hono<AppEnv>();
export const categoryGroups = new Hono<AppEnv>();

categoryGroups.get('/', async (c) => c.json(await listGroups(c.get('userId'), c.env.DB)));

categoryGroups.post('/', async (c) => {
  const b = await body(c, CreateCategoryGroupBody);
  return c.json(await createGroup(c.get('userId'), c.env.DB, b), 201);
});

/** L6: rename or reorder from the settings page. */
categoryGroups.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await getGroup(userId, c.env.DB, id)))
    throw new AppError(404, 'NOT_FOUND', 'Category group not found');
  const b = await body(c, PatchCategoryGroupBody);
  return c.json(await updateGroup(userId, c.env.DB, id, b));
});

/**
 * L6: refused while a live category remains in it. Once every category in it has been
 * deleted, the group itself is removable — hard-deleted if nothing ever lived in it, else
 * archived (same "archive, never orphan" rule as a category, one level up).
 */
categoryGroups.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const id = c.req.param('id');
  if (!(await getGroup(userId, db, id)))
    throw new AppError(404, 'NOT_FOUND', 'Category group not found');
  if (await groupHasActiveCategories(userId, db, id))
    throw new AppError(409, 'CATEGORY_IN_USE', 'Move or delete its categories first');
  if (await groupHasCategories(userId, db, id)) {
    await archiveGroup(userId, db, id);
  } else {
    await deleteGroup(userId, db, id);
  }
  return c.json({ deleted: id });
});

categories.get('/', async (c) => c.json(await listCategories(c.get('userId'), c.env.DB)));

categories.post('/', async (c) => {
  const userId = c.get('userId');
  const b = await body(c, CreateCategoryBody);
  const group = await getGroup(userId, c.env.DB, b.groupId);
  if (!group) throw new AppError(400, 'BAD_REQUEST', 'Unknown group');
  const created = await createCategory(userId, c.env.DB, {
    groupId: b.groupId,
    name: b.name,
    emoji: b.emoji,
    isBill: b.isBill,
    budgeted: budgetedInGroup(group.name, b.budgeted),
    ...categoryDefaults(b),
  });
  return c.json(created, 201);
});

categories.get('/:id', async (c) => {
  const cat = await getCategory(c.get('userId'), c.env.DB, c.req.param('id'));
  if (!cat) throw new AppError(404, 'NOT_FOUND', 'Category not found');
  return c.json(cat);
});

categories.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const cat = await getCategory(userId, c.env.DB, id);
  if (!cat) throw new AppError(404, 'NOT_FOUND', 'Category not found');
  const b = await body(c, PatchCategoryBody);
  const group = await getGroup(userId, c.env.DB, b.groupId ?? cat.groupId);
  if (!group) throw new AppError(400, 'BAD_REQUEST', 'Unknown group');
  // Moving into Transfers, or asking to count while there, turns counting off.
  const wants = b.budgeted ?? cat.budgeted;
  const budgeted = budgetedInGroup(group.name, wants);
  const patch = budgeted !== wants ? { ...b, budgeted } : b;
  return c.json(await updateCategory(userId, c.env.DB, id, patch));
});

/**
 * SPEC §2.10: archive, never erase. Refused while the category holds money in an open month,
 * unless `?reassign=true` — the user's explicit "move it for me" confirm — in which case its
 * open-month plan/carry-in return to Ready to assign and its transactions move to the
 * catch-all "Other" category as needs-review (never silently: this is the same one confirm
 * click as a plain delete, just doing the move the error message used to ask for by hand).
 * Its rules go with it either way, each audited.
 */
categories.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const id = c.req.param('id');
  const cat = await getCategory(userId, db, id);
  if (!cat || cat.archivedAt) throw new AppError(404, 'NOT_FOUND', 'Category not found');
  if (cat.isCatchall)
    throw new AppError(
      409,
      'CONFLICT',
      `${cat.name} is the fallback category and can't be deleted.`,
    );
  const user = await getUser(userId, db);
  const thisMonth = localToday(user?.timezone ?? 'America/Chicago').slice(0, 7);
  const inUse = await categoryMoneyInOpenMonths(userId, db, id, thisMonth);
  const reassign = c.req.query('reassign') === 'true';
  if (inUse && !reassign) {
    throw new AppError(
      409,
      'CATEGORY_IN_USE',
      `${cat.name} still has money or spending in ${inUse.periodId}. Move it to another category first.`,
      inUse,
    );
  }
  const rules = (await listRules(userId, db)).filter((r) => r.categoryId === id);
  const stmts = [...archiveCategoryStmts(userId, db, id)];
  let transactionsMoved = 0;
  if (inUse && reassign) {
    const catchall = await ensureCatchallCategory(userId, db);
    const moved = await reassignOpenCategoryStmts(userId, db, id, catchall.id, thisMonth);
    stmts.push(clearCategoryOpenAllocationsStmt(userId, db, id, thisMonth), ...moved.stmts);
    transactionsMoved = moved.movedCount;
  }
  await db.batch(stmts);
  for (const r of rules) {
    await writeAudit(userId, db, 'rule.deleted', {
      type: 'rule',
      id: r.id,
      detail: { reason: 'category_deleted', categoryId: id },
    });
  }
  if (transactionsMoved > 0) {
    await writeAudit(userId, db, 'category.deleted_with_reassign', {
      type: 'category',
      id,
      detail: { reassignedTo: 'Other', transactionsMoved },
    });
  }
  return c.json({ archived: id, rulesDeleted: rules.length, transactionsMoved });
});

const MONTHS_MAX = 36;

/** Month by month for the category page's chart (reads aggregates, not raw splits). */
categories.get('/:id/history', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const cat = await getCategory(userId, c.env.DB, id);
  if (!cat) throw new AppError(404, 'NOT_FOUND', 'Category not found');
  const months = Math.min(Math.max(Number(c.req.query('months') ?? 12) || 12, 1), MONTHS_MAX);
  const user = await getUser(userId, c.env.DB);
  const to = localToday(user?.timezone ?? 'America/Chicago').slice(0, 7);
  let from = to;
  for (let i = 1; i < months; i++) {
    const [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
    from = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  const rolled = await loadRollover(c.env, userId, to);
  return c.json(
    await categoryHistory(
      userId,
      c.env.DB,
      id,
      from,
      to,
      planDefaultOf(cat),
      (periodId) => rolled.get(periodId)?.carriedIn.get(id) ?? 0,
    ),
  );
});

/**
 * SPEC §2.8: zero this month's carried deficit. Explicit, exact, reasoned and audited —
 * the confirm must name the amount, and it only ever touches the current open month.
 */
categories.post('/:id/forgive', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const id = c.req.param('id');
  if (!(await getCategory(userId, db, id)))
    throw new AppError(404, 'NOT_FOUND', 'Category not found');
  const b = await body(c, ForgiveBody);
  const user = await getUser(userId, db);
  const periodId = localToday(user?.timezone ?? 'America/Chicago').slice(0, 7);
  const [cat, allocs, rolled] = await Promise.all([
    getCategory(userId, db, id),
    listAllocations(userId, db, periodId),
    loadRollover(c.env, userId, periodId),
  ]);
  const carried = rolled.get(periodId)?.carriedIn.get(id) ?? 0;
  const r = forgiveDeficit({
    categoryId: id,
    periodId,
    carriedInCents: carried,
    confirmedAmountCents: b.amountCents,
    reason: b.reason,
  });
  if (!r.ok) {
    const status = r.code === 'NOTHING_TO_FORGIVE' ? 409 : 422;
    const code = r.code === 'REASON_REQUIRED' ? 'BAD_REQUEST' : r.code;
    throw new AppError(
      status,
      code,
      {
        NOTHING_TO_FORGIVE: 'There is no carried deficit to forgive',
        AMOUNT_MISMATCH: 'The amount must match the carried deficit exactly',
        REASON_REQUIRED: 'Say why',
      }[r.code],
    );
  }
  const row = allocs.find((a) => a.category_id === id);
  const seed = resolvePlanned(
    row && { plannedCents: row.planned_cents },
    cat ? planDefaultOf(cat) : null,
    periodId,
  );
  await db.batch([forgiveCarryStmt(userId, db, periodId, id, -carried, seed)]);
  await writeAudit(userId, db, r.audit.action, {
    type: r.audit.targetType,
    id: r.audit.targetId,
    detail: { ...r.audit.detail },
  });
  return c.json({ periodId, forgivenCents: r.audit.detail.amountCents });
});
