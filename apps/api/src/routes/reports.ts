import { addPeriods } from '@rise/shared/budget';
import { buildMoneyFlow, monthlySeries } from '@rise/shared/reports';
import {
  MoneyFlowReportQuery,
  SpendingReportQuery,
  type MoneyFlowReport,
  type SpendingReport,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import { listAggregates, listCategories, listGroups, spendingByDay, spendingByPeriod } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';

export const reports = new Hono<AppEnv>();

/** How many months the Dashboard's history bars cover, this one included. */
const HISTORY_MONTHS = 6;

reports.get('/spending', async (c) => {
  const q = SpendingReportQuery.safeParse(c.req.query());
  if (!q.success) throw new AppError(400, 'BAD_REQUEST', 'month is required (YYYY-MM)');
  const { month } = q.data;
  const userId = c.get('userId');
  const first = addPeriods(month, 1 - HISTORY_MONTHS);
  const [days, months] = await Promise.all([
    spendingByDay(userId, c.env.DB, addPeriods(month, -1), month),
    spendingByPeriod(userId, c.env.DB, first, month),
  ]);
  const body: SpendingReport = { month, days, months: monthlySeries(first, month, months) };
  return c.json(body);
});

/** T-Sankey: where a month's money came from and where it went. */
reports.get('/money-flow', async (c) => {
  const q = MoneyFlowReportQuery.safeParse(c.req.query());
  if (!q.success) throw new AppError(400, 'BAD_REQUEST', 'month is required (YYYY-MM)');
  const { month } = q.data;
  const userId = c.get('userId');
  const db = c.env.DB;
  const [aggregates, categories, groups] = await Promise.all([
    listAggregates(userId, db, month, month),
    listCategories(userId, db),
    listGroups(userId, db),
  ]);
  const catById = new Map(categories.map((cat) => [cat.id, cat]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const flow = buildMoneyFlow(
    aggregates.flatMap((a) => {
      const cat = catById.get(a.categoryId);
      const group = cat && groupById.get(cat.groupId);
      if (!cat || !group) return [];
      return [
        {
          categoryId: cat.id,
          categoryName: cat.name,
          groupId: group.id,
          groupName: group.name,
          groupKind: group.kind,
          spentCents: a.spentCents,
        },
      ];
    }),
  );
  const body: MoneyFlowReport = { month, ...flow };
  return c.json(body);
});
