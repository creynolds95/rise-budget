import { Hono } from 'hono';
import { getUser, listSeries } from '../db';
import type { AppEnv } from '../env';
import { localToday } from '../lib/dates';
import { refreshRecurring } from '../lib/recurring';

export const recurring = new Hono<AppEnv>();

/** Detected series, soonest first. Broken ones read "Netflix hasn't charged since July". */
recurring.get('/', async (c) => {
  return c.json(await listSeries(c.get('userId'), c.env.DB));
});

/** Re-detect now (sync does this on every run). */
recurring.post('/refresh', async (c) => {
  const userId = c.get('userId');
  const user = await getUser(userId, c.env.DB);
  await refreshRecurring(c.env.DB, userId, localToday(user?.timezone ?? 'America/Chicago'));
  return c.json(await listSeries(userId, c.env.DB));
});
