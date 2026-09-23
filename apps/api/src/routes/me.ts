import { PatchSettingsBody } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { getUser, updateSettings } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';

export const me = new Hono<AppEnv>();

me.get('/', async (c) => {
  const user = await getUser(c.get('userId'), c.env.DB);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  return c.json(user);
});

me.patch('/settings', async (c) => {
  const patch = await body(c, PatchSettingsBody);
  const settings = await updateSettings(c.get('userId'), c.env.DB, patch);
  if (!settings) throw new AppError(404, 'NOT_FOUND', 'User not found');
  return c.json(settings);
});
