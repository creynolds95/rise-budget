import { ManualCashEventBody } from '@rise/shared/schemas';
import { firstUpcoming } from '@rise/shared/recurring';
import { Hono } from 'hono';
import {
  deleteManualEventStmt,
  getUser,
  listAccounts,
  listManualEvents,
  newId,
  upsertManualEventStmt,
} from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { buildCashToPaydayProjection } from '../lib/cashToPayday';
import { localToday } from '../lib/dates';
import { body } from '../lib/validate';

export const cashToPayday = new Hono<AppEnv>();

cashToPayday.get('/', async (c) => {
  const userId = c.get('userId');
  const user = await getUser(userId, c.env.DB);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');

  const accounts = await listAccounts(userId, c.env.DB);
  const { cashAccountIds, cushionCents, dismissedPayMerchants } = user.settings;
  // Empty selection: every budgeted depository account counts as cash.
  const cashAccounts =
    cashAccountIds.length > 0
      ? accounts.filter((a) => cashAccountIds.includes(a.id))
      : accounts.filter((a) => a.kind === 'depository' && a.includeInBudget);
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
  return c.json({
    ...projection,
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
    })),
  );
});

cashToPayday.post('/manual-events', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const b = await body(c, ManualCashEventBody);
  const user = await getUser(userId, db);
  const today = localToday(user?.timezone ?? 'America/Chicago');
  const nextExpectedDate = firstUpcoming(b.cadence, b.anchorDate, null, today);
  const amountCents = b.kind === 'income' ? -b.amountCents : b.amountCents;
  const merchant = newId();
  await db.batch([
    upsertManualEventStmt(userId, db, merchant, b.label, b.cadence, amountCents, nextExpectedDate),
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
