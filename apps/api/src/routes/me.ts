import { PatchSettingsBody } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { getUser, updateSettings } from '../db';
import type { AppEnv } from '../env';
import { localToday } from '../lib/dates';
import { AppError } from '../lib/errors';
import { refreshRecurring } from '../lib/recurring';
import { body } from '../lib/validate';

export const me = new Hono<AppEnv>();

me.get('/', async (c) => {
  const user = await getUser(c.get('userId'), c.env.DB);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  return c.json(user);
});

me.patch('/settings', async (c) => {
  const patch = await body(c, PatchSettingsBody);
  const userId = c.get('userId');
  const settings = await updateSettings(userId, c.env.DB, patch);
  if (!settings) throw new AppError(404, 'NOT_FOUND', 'User not found');
  // Surplus suggestions come from the cash accounts; a new choice re-detects them now.
  if (patch.cashAccountIds) {
    const user = await getUser(userId, c.env.DB);
    await refreshRecurring(c.env.DB, userId, localToday(user?.timezone ?? 'America/Chicago'));
  }
  return c.json(settings);
});
