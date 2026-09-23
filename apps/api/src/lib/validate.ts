import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from './errors';

export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError(400, 'BAD_REQUEST', 'Invalid request body', r.error.issues);
  return r.data;
}
