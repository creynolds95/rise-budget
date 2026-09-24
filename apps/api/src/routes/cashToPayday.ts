import { Hono } from 'hono';
import { getUser, listAccounts } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { buildCashToPaydayProjection } from '../lib/cashToPayday';
import { localToday } from '../lib/dates';

export const cashToPayday = new Hono<AppEnv>();

cashToPayday.get('/', async (c) => {
  const userId = c.get('userId');
  const user = await getUser(userId, c.env.DB);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');

  const accounts = await listAccounts(userId, c.env.DB);
  const { cashAccountIds, cushionCents } = user.settings;
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
  );
  return c.json({
    ...projection,
    cashAccounts: cashAccounts.map((a) => ({ id: a.id, name: a.name })),
    cushionCents,
  });
});
