import { categoryDefaults } from '@rise/shared/budget';
import {
  CreateCategoryBody,
  CreateCategoryGroupBody,
  PatchCategoryBody,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  createCategory,
  createGroup,
  getCategory,
  getGroup,
  listCategories,
  listGroups,
  updateCategory,
} from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';

export const categories = new Hono<AppEnv>();
export const categoryGroups = new Hono<AppEnv>();

categoryGroups.get('/', async (c) => c.json(await listGroups(c.get('userId'), c.env.DB)));

categoryGroups.post('/', async (c) => {
  const b = await body(c, CreateCategoryGroupBody);
  return c.json(await createGroup(c.get('userId'), c.env.DB, b), 201);
});

categories.get('/', async (c) => c.json(await listCategories(c.get('userId'), c.env.DB)));

categories.post('/', async (c) => {
  const userId = c.get('userId');
  const b = await body(c, CreateCategoryBody);
  if (!(await getGroup(userId, c.env.DB, b.groupId)))
    throw new AppError(400, 'BAD_REQUEST', 'Unknown group');
  const created = await createCategory(userId, c.env.DB, {
    groupId: b.groupId,
    name: b.name,
    emoji: b.emoji,
    isBill: b.isBill,
    ...categoryDefaults(b),
  });
  return c.json(created, 201);
});

categories.get('/:id', async (c) => {
  const cat = await getCategory(c.get('userId'), c.env.DB, c.req.param('id'));
  if (!cat) throw new AppError(404, 'NOT_FOUND', 'Category not found');
  return c.json(cat);
});

categories.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await getCategory(userId, c.env.DB, id)))
    throw new AppError(404, 'NOT_FOUND', 'Category not found');
  const b = await body(c, PatchCategoryBody);
  if (b.groupId && !(await getGroup(userId, c.env.DB, b.groupId)))
    throw new AppError(400, 'BAD_REQUEST', 'Unknown group');
  return c.json(await updateCategory(userId, c.env.DB, id, b));
});
