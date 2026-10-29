import { addPeriods } from '@rise/shared/budget';
import { buildMoneyFlow, monthlySeries, taxLines } from '@rise/shared/reports';
import {
  CashFlowReportQuery,
  MoneyFlowReportQuery,
  SpendingReportQuery,
  TaxYearQuery,
  type CashFlowReport,
  type MoneyFlowReport,
  type SpendingReport,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  incomeByPeriod,
  listAggregates,
  listCategoriesWithArchived,
  listGroupsWithArchived,
  spendingByDay,
  spendingByPeriod,
  taxRows,
} from '../db';
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

/** T-Sankey: where a month's (or a range of months') money came from and where it went. */
reports.get('/money-flow', async (c) => {
  const q = MoneyFlowReportQuery.safeParse(c.req.query());
  if (!q.success) throw new AppError(400, 'BAD_REQUEST', 'month is required (YYYY-MM)');
  const { month, from = month } = q.data;
  const userId = c.get('userId');
  const db = c.env.DB;
  const [aggregates, categories, groups] = await Promise.all([
    listAggregates(userId, db, from, month),
    // Archived too: a category archived since still spent that money, and the cash-flow chart
    // counts it. Only categories with amounts in the range reach the flow.
    listCategoriesWithArchived(userId, db),
    listGroupsWithArchived(userId, db),
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

/** Cash-flow bar chart: income vs. expense for the last six months. */
reports.get('/cash-flow', async (c) => {
  const q = CashFlowReportQuery.safeParse(c.req.query());
  if (!q.success) throw new AppError(400, 'BAD_REQUEST', 'month is required (YYYY-MM)');
  const { month } = q.data;
  const userId = c.get('userId');
  const first = addPeriods(month, 1 - HISTORY_MONTHS);
  const [expense, income] = await Promise.all([
    spendingByPeriod(userId, c.env.DB, first, month),
    incomeByPeriod(userId, c.env.DB, first, month),
  ]);
  const expenseSeries = monthlySeries(first, month, expense);
  const incomeSeries = monthlySeries(first, month, income);
  const body: CashFlowReport = {
    month,
    months: expenseSeries.map((e, i) => ({
      periodId: e.periodId,
      expenseCents: e.cents,
      incomeCents: incomeSeries[i]?.cents ?? 0,
    })),
  };
  return c.json(body);
});

/** The year-end tax pack: every line a category or tag with a tax heading marked, by date. */
reports.get('/tax', async (c) => {
  const q = TaxYearQuery.safeParse(c.req.query());
  if (!q.success) throw new AppError(400, 'BAD_REQUEST', 'year is required');
  const { year } = q.data;
  const rows = await taxRows(c.get('userId'), c.env.DB, `${year}-01-01`, `${year}-12-31`);
  return c.json({ year, lines: taxLines(rows.byCategory, rows.byTag) });
});
