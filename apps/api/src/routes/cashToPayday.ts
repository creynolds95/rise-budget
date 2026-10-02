import { nextScheduled } from '@rise/shared/recurring';
import { ManualCashEventBody, ScheduleBody } from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  deleteManualEventStmt,
  deleteManualRuleStmt,
  getUser,
  listAccounts,
  listManualEvents,
  newId,
  updateManualRuleStmt,
  upsertManualEventStmt,
  upsertManualRuleStmt,
} from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { buildCashToPaydayProjection, cashAccountsOf } from '../lib/cashToPayday';
import { localToday } from '../lib/dates';
import { body } from '../lib/validate';

export const cashToPayday = new Hono<AppEnv>();

cashToPayday.get('/', async (c) => {
  const userId = c.get('userId');
  const user = await getUser(userId, c.env.DB);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');

  const accounts = await listAccounts(userId, c.env.DB);
  const { cushionCents, dismissedPayMerchants } = user.settings;
  const cashAccounts = cashAccountsOf(user.settings, accounts);
  const startBalanceCents = cashAccounts.reduce((sum, a) => sum + a.balanceCents, 0);

  const today = localToday(user.timezone);
  const projection = await buildCashToPaydayProjection(
    c.env.DB,
    userId,
    today,
    startBalanceCents,
    cushionCents,
    dismissedPayMerchants.map((d) => d.merchant),
  );
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return c.json({
    ...projection,
    suggestions: projection.suggestions.map((s) => ({
      ...s,
      accountName: accountName.get(s.accountId) ?? '',
    })),
    cashAccounts: cashAccounts.map((a) => ({ id: a.id, name: a.name })),
    cushionCents,
    dismissedPayMerchants,
  });
});

/** Hand-declared paychecks/bills for a cold start, or income Rise hasn't seen post yet. */
cashToPayday.get('/manual-events', async (c) => {
  const userId = c.get('userId');
  const rows = await listManualEvents(userId, c.env.DB);
  return c.json(
    rows.map((r) => ({
      id: r.id,
      label: r.label,
      kind: r.expected_amount_cents < 0 ? 'income' : 'expense',
      amountCents: Math.abs(r.expected_amount_cents),
      cadence: r.cadence,
      nextExpectedDate: r.next_expected_date,
      anchorDays: r.anchor_days ? (JSON.parse(r.anchor_days) as [number, number]) : null,
    })),
  );
});

cashToPayday.post('/manual-events', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const b = await body(c, ManualCashEventBody);
  const user = await getUser(userId, db);
  const today = localToday(user?.timezone ?? 'America/Chicago');
  const anchorDays = b.anchorDays ?? null;
  const nextExpectedDate = nextScheduled(b.cadence, b.anchorDate, anchorDays, today);
  const amountCents = b.kind === 'income' ? -b.amountCents : b.amountCents;
  const merchant = newId();
  await db.batch([
    upsertManualEventStmt(
      userId,
      db,
      merchant,
      b.label,
      b.cadence,
      amountCents,
      nextExpectedDate,
      anchorDays,
    ),
  ]);
  return c.json({ id: `${userId}|${merchant}` }, 201);
});

cashToPayday.delete('/manual-events/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const result = await db.batch([deleteManualEventStmt(userId, db, c.req.param('id'))]);
  if (result[0]?.meta.rows_written === 0) throw new AppError(404, 'NOT_FOUND', 'Event not found');
  return c.body(null, 204);
});

/**
 * Edit a paycheck/bill schedule from the Surplus page. A manual rule (tagged or hand-added)
 * updates in place; a detected one is taken over as a manual rule, which stops it being
 * re-detected from the transactions behind it.
 */
cashToPayday.put('/schedules', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const b = await body(c, ScheduleBody);
  const user = await getUser(userId, db);
  const today = localToday(user?.timezone ?? 'America/Chicago');
  const anchorDays = b.anchorDays ?? null;
  const nextExpectedDate = nextScheduled(b.cadence, b.anchorDate, anchorDays, today);
  const amountCents = b.kind === 'income' ? -b.amountCents : b.amountCents;
  if (b.id) {
    const result = await db.batch([
      updateManualRuleStmt(userId, db, b.id, {
        cadence: b.cadence,
        amountCents,
        nextExpectedDate,
        anchorDays,
        label: b.label,
      }),
    ]);
    if (result[0]?.meta.rows_written === 0)
      throw new AppError(404, 'NOT_FOUND', 'Schedule not found');
    return c.json({ id: b.id });
  }
  await db.batch([
    upsertManualRuleStmt(
      userId,
      db,
      b.merchant as string,
      b.cadence,
      amountCents,
      nextExpectedDate,
      anchorDays,
    ),
  ]);
  return c.json({ id: `${userId}|${b.merchant}` });
});

/** Remove a manual schedule (tagged or hand-added); detected ones are dismissed in settings. */
cashToPayday.delete('/schedules/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const result = await db.batch([deleteManualRuleStmt(userId, db, c.req.param('id'))]);
  if (result[0]?.meta.rows_written === 0)
    throw new AppError(404, 'NOT_FOUND', 'Schedule not found');
  return c.body(null, 204);
});
