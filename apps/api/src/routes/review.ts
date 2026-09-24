import { rankMemory } from '@rise/shared/categorize';
import { Hono } from 'hono';
import { listTransactions, memoryFor } from '../db';
import type { AppEnv } from '../env';

export const review = new Hono<AppEnv>();

const QUEUE_MAX = 500;
const DROPPED_DAYS = 14;

/**
 * SPEC §8: everything waiting for review, newest first, each with the merchant's top
 * categories for one-tap buttons. Pending rows dropped recently come along separately so the
 * queue can say what happened to them (§3.2).
 */
review.get('/queue', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const since = new Date(Date.now() - DROPPED_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [items, dropped] = await Promise.all([
    listTransactions(userId, db, { reviewState: 'needs_review' }, QUEUE_MAX),
    listTransactions(userId, db, { reviewState: 'dropped', from: since }, 50),
  ]);
  const memory = await memoryFor(
    userId,
    db,
    items.map((t) => t.merchantNormalized),
  );
  return c.json({
    count: items.length,
    items: items.map((t) => ({
      ...t,
      topCategoryIds: rankMemory(memory.get(t.merchantNormalized) ?? [])
        .slice(0, 3)
        .map((m) => m.categoryId),
    })),
    dropped,
  });
});
