import { CreateTagBody, PatchTagBody } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { createTag, deleteTag, getTag, listTagSummaries, tagNameTaken, updateTag } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';

export const tags = new Hono<AppEnv>();

const taken = () => new AppError(409, 'CONFLICT', 'A tag with that name already exists');

tags.get('/', async (c) => c.json(await listTagSummaries(c.get('userId'), c.env.DB)));

tags.post('/', async (c) => {
  const userId = c.get('userId');
  const b = await body(c, CreateTagBody);
  if (await tagNameTaken(userId, c.env.DB, b.name)) throw taken();
  return c.json(await createTag(userId, c.env.DB, b), 201);
});

tags.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await getTag(userId, c.env.DB, id))) throw new AppError(404, 'NOT_FOUND', 'Tag not found');
  const b = await body(c, PatchTagBody);
  if (b.name && (await tagNameTaken(userId, c.env.DB, b.name, id))) throw taken();
  await updateTag(userId, c.env.DB, id, b);
  return c.json(await getTag(userId, c.env.DB, id));
});

tags.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await getTag(userId, c.env.DB, id))) throw new AppError(404, 'NOT_FOUND', 'Tag not found');
  await deleteTag(userId, c.env.DB, id);
  return c.body(null, 204);
});
