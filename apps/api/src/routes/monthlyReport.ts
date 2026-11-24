import { MonthlyReport, ReportData, ReportNarrative } from '@rise/shared/report';
import { addPeriods } from '@rise/shared/budget';
import { PeriodId } from '@rise/shared/schemas';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getReportRow, getUser } from '../db';
import type { AppEnv } from '../env';
import { localToday } from '../lib/dates';
import { AppError } from '../lib/errors';
import { computeReportData, contextOptions, generateAndStore } from '../lib/monthlyReport';

/**
 * The monthly report (SPEC §12.6). Reading never needs a key: with no stored narrative it
 * returns the computed figures and `narrative: null`, and the app draws everything but the
 * written text. Only generating calls the model.
 */
export const monthlyReport = new Hono<AppEnv>();

const Query = z.object({ month: PeriodId });

async function load(c: Context<AppEnv>) {
  const userId = c.get('userId');
  const user = await getUser(userId, c.env.DB);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  const today = localToday(user.timezone);
  const goals = user.settings.savings?.goals ?? [];
  return { userId, user, today, goals };
}

monthlyReport.get('/', async (c) => {
  const q = Query.safeParse(c.req.query());
  if (!q.success) throw new AppError(400, 'BAD_REQUEST', 'month is required (YYYY-MM)');
  const { month } = q.data;
  const { userId, user, today, goals } = await load(c);
  const row = await getReportRow(userId, c.env.DB, month);
  const stored =
    row &&
    MonthlyReport.safeParse({
      month,
      generatedAt: row.generated_at,
      model: row.model,
      data: ReportData.safeParse(JSON.parse(row.data_json)).data,
      narrative: ReportNarrative.safeParse(JSON.parse(row.narrative_json)).data ?? null,
    });
  const report: MonthlyReport =
    stored && stored.success
      ? stored.data
      : {
          month,
          generatedAt: null,
          model: null,
          data: await computeReportData(
            userId,
            c.env.DB,
            month,
            today,
            goals,
            null,
            contextOptions(user.settings, undefined),
          ),
          narrative: null,
        };
  return c.json({
    report,
    keySet: Boolean(c.env.ANTHROPIC_API_KEY),
    zip: user.settings.monthlyReport.zip,
    gasKeySet: Boolean(c.env.EIA_API_KEY),
    lifeNotes: user.settings.monthlyReport.lifeNotes,
  });
});

/**
 * Whether last month's report is ready, for the Dashboard card: its month and whether it has a
 * written note. One primary-key read; null when there is none (or the card is switched off).
 */
monthlyReport.get('/ready', async (c) => {
  const { userId, user, today } = await load(c);
  if (!user.settings.alerts.monthlyReport) return c.json({ ready: null });
  const month = addPeriods(today.slice(0, 7), -1);
  const row = await getReportRow(userId, c.env.DB, month);
  return c.json({
    ready: row ? { month, generatedAt: row.generated_at, written: row.model !== 'none' } : null,
  });
});

/** Write (or rewrite) one month's narrative now. Needs the owner's key to be set. */
monthlyReport.post('/generate', async (c) => {
  const body = Query.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new AppError(400, 'BAD_REQUEST', 'month is required (YYYY-MM)');
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) throw new AppError(409, 'CONFLICT', 'No Anthropic API key is set on this deployment');
  const { month } = body.data;
  const { userId, user, today, goals } = await load(c);
  const ok = await generateAndStore(
    userId,
    c.env.DB,
    key,
    month,
    today,
    goals,
    fetch,
    contextOptions(user.settings, c.env.EIA_API_KEY),
  );
  if (!ok) throw new AppError(502, 'INTERNAL', 'The summary could not be written. Try again.');
  return c.json({ ok: true as const });
});
