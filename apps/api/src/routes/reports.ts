import { addPeriods } from '@rise/shared/budget';
import { monthlySeries } from '@rise/shared/reports';
import { SpendingReportQuery, type SpendingReport } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { spendingByDay, spendingByPeriod } from '../db';
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
