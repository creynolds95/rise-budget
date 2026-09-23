import type { MiddlewareHandler } from 'hono';
import { claimIdempotencyKey, releaseIdempotencyKey, storeIdempotentResponse } from '../db';
import type { AppEnv } from '../env';
import { sha256Hex } from './crypto';
import { AppError } from './errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * T22. A mutation carrying `Idempotency-Key` runs at most once: a replay returns the original
 * status and body without re-applying anything. Reusing a key for a different request is
 * rejected. Offline replay depends on this (SPEC §10).
 */
export const idempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header('Idempotency-Key');
  if (!key || !MUTATING.has(c.req.method)) return next();
  if (key.length > 200) throw new AppError(400, 'BAD_REQUEST', 'Idempotency-Key is too long');

  const userId = c.get('userId');
  const db = c.env.DB;
  const fingerprint = await sha256Hex(
    `${c.req.method} ${c.req.path}\n${await c.req.raw.clone().text()}`,
  );
  const existing = await claimIdempotencyKey(userId, db, key, fingerprint);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new AppError(
        422,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was used for a different request',
      );
    }
    if (existing.status === null) {
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'The original request is still in progress');
    }
    return new Response(existing.body, {
      status: existing.status,
      headers: { 'content-type': 'application/json', 'idempotent-replay': 'true' },
    });
  }

  await next();
  if (c.res.status >= 500) {
    await releaseIdempotencyKey(userId, db, key);
    return;
  }
  const bodyText = c.res.status === 204 ? '' : await c.res.clone().text();
  await storeIdempotentResponse(userId, db, key, {
    fingerprint,
    status: c.res.status,
    body: bodyText || null,
  });
};
