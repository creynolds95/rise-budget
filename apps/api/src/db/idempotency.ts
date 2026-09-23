import { nowIso, type UserId } from './util';

/**
 * Idempotency records (SPEC §10, edge 15). Keys are scoped to the user by prefixing, since
 * the table's primary key is the key alone.
 */
const scoped = (userId: UserId, key: string) => `${userId}:${key}`;

export interface StoredResponse {
  fingerprint: string;
  status: number | null; // null while the first request is still running
  body: string | null;
}

/** Claims the key. Returns null if claimed now, or the existing record if it was already taken. */
export async function claimIdempotencyKey(
  userId: UserId,
  db: D1Database,
  key: string,
  fingerprint: string,
): Promise<StoredResponse | null> {
  const pending: StoredResponse = { fingerprint, status: null, body: null };
  const r = await db
    .prepare(
      'INSERT INTO idempotency (key, user_id, response_json, created_at) VALUES (?2, ?1, ?3, ?4) ON CONFLICT(key) DO NOTHING',
    )
    .bind(userId, scoped(userId, key), JSON.stringify(pending), nowIso())
    .run();
  if (r.meta.changes === 1) return null;
  const row = await db
    .prepare('SELECT response_json FROM idempotency WHERE user_id = ?1 AND key = ?2')
    .bind(userId, scoped(userId, key))
    .first<{ response_json: string }>();
  return row ? (JSON.parse(row.response_json) as StoredResponse) : null;
}

export async function storeIdempotentResponse(
  userId: UserId,
  db: D1Database,
  key: string,
  response: StoredResponse,
): Promise<void> {
  await db
    .prepare('UPDATE idempotency SET response_json = ?3 WHERE user_id = ?1 AND key = ?2')
    .bind(userId, scoped(userId, key), JSON.stringify(response))
    .run();
}

/** A server error leaves nothing applied, so the key is released for a retry. */
export async function releaseIdempotencyKey(
  userId: UserId,
  db: D1Database,
  key: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM idempotency WHERE user_id = ?1 AND key = ?2')
    .bind(userId, scoped(userId, key))
    .run();
}
