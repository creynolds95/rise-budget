import { PatchSeriesBody } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { getUser, listSeries, setSeriesStatusStmt } from '../db';
import type { AppEnv } from '../env';
import { localToday } from '../lib/dates';
import { AppError } from '../lib/errors';
import { refreshRecurring } from '../lib/recurring';
import { body } from '../lib/validate';

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

/**
 * "It ended" stops watching a detected series (refresh never revives it); "Track again" hands
 * it back to refresh, which recomputes its status on the next sync.
 */
recurring.patch('/:id', async (c) => {
  const { status } = await body(c, PatchSeriesBody);
  const res = await setSeriesStatusStmt(c.get('userId'), c.env.DB, c.req.param('id'), status).run();
  if (res.meta.changes === 0) throw new AppError(404, 'NOT_FOUND', 'Series not found');
  return c.body(null, 204);
});
