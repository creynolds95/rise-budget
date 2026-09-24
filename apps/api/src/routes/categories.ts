import { categoryDefaults, forgiveDeficit } from '@rise/shared/budget';
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
  categoryHistory,
  categoryMoneyInOpenMonths,
  clearCarriedInStmt,
  createCategory,
  createGroup,
  deleteGroup,
  getCategory,
  getGroup,
  getPeriod,
  getUser,
  groupHasCategories,
  listAllocations,
  listCategories,
  listGroups,
  listRules,
  planDefaultOf,
  updateCategory,
  updateGroup,
  writeAudit,
} from '../db';
import type { AppEnv } from '../env';
import { localToday } from '../lib/dates';
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

/** L6: only once it holds nothing — same "archive, never orphan" rule as a category. */
categoryGroups.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const id = c.req.param('id');
  if (!(await getGroup(userId, db, id)))
    throw new AppError(404, 'NOT_FOUND', 'Category group not found');
  if (await groupHasCategories(userId, db, id))
    throw new AppError(409, 'CATEGORY_IN_USE', 'Move or delete its categories first');
  await deleteGroup(userId, db, id);
  return c.json({ deleted: id });
});

categories.get('/', async (c) => c.json(await listCategories(c.get('userId'), c.env.DB)));

categories.post('/', async (c) => {
  const userId = c.get('userId');
  const b = await body(c, CreateCategoryBody);
  if (!(await getGroup(userId, c.env.DB, b.groupId)))
    throw new AppError(400, 'BAD_REQUEST', 'Unknown group');
  const created = await createCategory(userId, c.env.DB, {
    groupId: b.groupId,
    name: b.name,
    emoji: b.emoji,
    isBill: b.isBill,
    budgeted: b.budgeted,
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
  if (!(await getCategory(userId, c.env.DB, id)))
    throw new AppError(404, 'NOT_FOUND', 'Category not found');
  const b = await body(c, PatchCategoryBody);
  if (b.groupId && !(await getGroup(userId, c.env.DB, b.groupId)))
    throw new AppError(400, 'BAD_REQUEST', 'Unknown group');
  return c.json(await updateCategory(userId, c.env.DB, id, b));
});

/**
 * SPEC §2.10: archive, never erase. Refused while the category holds money in an open month;
 * its rules go with it, each audited.
 */
categories.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const id = c.req.param('id');
  const cat = await getCategory(userId, db, id);
  if (!cat || cat.archivedAt) throw new AppError(404, 'NOT_FOUND', 'Category not found');
  const inUse = await categoryMoneyInOpenMonths(userId, db, id);
  if (inUse) {
    throw new AppError(
      409,
      'CATEGORY_IN_USE',
      `${cat.name} still has money or spending in ${inUse.periodId}. Move it to another category first.`,
      inUse,
    );
  }
  const rules = (await listRules(userId, db)).filter((r) => r.categoryId === id);
  await db.batch(archiveCategoryStmts(userId, db, id));
  for (const r of rules) {
    await writeAudit(userId, db, 'rule.deleted', {
      type: 'rule',
      id: r.id,
      detail: { reason: 'category_deleted', categoryId: id },
    });
  }
  return c.json({ archived: id, rulesDeleted: rules.length });
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
  return c.json(await categoryHistory(userId, c.env.DB, id, from, to, planDefaultOf(cat)));
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
  const [period, allocs] = await Promise.all([
    getPeriod(userId, db, periodId),
    listAllocations(userId, db, periodId),
  ]);
  const carried = allocs.find((a) => a.category_id === id)?.carried_in_cents ?? 0;
  const r = forgiveDeficit({
    categoryId: id,
    periodId,
    periodStatus: period?.status ?? 'open',
    carriedInCents: carried,
    confirmedAmountCents: b.amountCents,
    reason: b.reason,
  });
  if (!r.ok) {
    const status = r.code === 'PERIOD_CLOSED' || r.code === 'NOTHING_TO_FORGIVE' ? 409 : 422;
    const code = r.code === 'REASON_REQUIRED' ? 'BAD_REQUEST' : r.code;
    throw new AppError(
      status,
      code,
      {
        PERIOD_CLOSED: `${periodId} is closed`,
        NOTHING_TO_FORGIVE: 'There is no carried deficit to forgive',
        AMOUNT_MISMATCH: 'The amount must match the carried deficit exactly',
        REASON_REQUIRED: 'Say why',
      }[r.code],
    );
  }
  await db.batch([clearCarriedInStmt(userId, db, periodId, id)]);
  await writeAudit(userId, db, r.audit.action, {
    type: r.audit.targetType,
    id: r.audit.targetId,
    detail: { ...r.audit.detail },
  });
  return c.json({ periodId, forgivenCents: r.audit.detail.amountCents });
});
