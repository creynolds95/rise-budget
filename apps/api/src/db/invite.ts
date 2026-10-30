import { nowIso, type UserId } from './util';

export interface InviteRow {
  id: string;
  created_at: string;
  expires_at: string;
}

export async function insertInvite(
  userId: UserId,
  db: D1Database,
  i: { id: string; secretHash: string; expiresAt: string },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO invite (id, user_id, secret_hash, created_at, expires_at) VALUES (?2, ?1, ?3, ?4, ?5)',
    )
    .bind(userId, i.id, i.secretHash, nowIso(), i.expiresAt)
    .run();
}

/** Links that can still be used: not spent, not revoked, not expired. */
export async function listLiveInvites(userId: UserId, db: D1Database): Promise<InviteRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, created_at, expires_at FROM invite
       WHERE user_id = ?1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?2
       ORDER BY created_at DESC`,
    )
    .bind(userId, nowIso())
    .all<InviteRow>();
  return results;
}

/** The stored hash of a link that can still be used, or null. */
export async function liveInviteHash(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT secret_hash FROM invite
       WHERE user_id = ?1 AND id = ?2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?3`,
    )
    .bind(userId, id, nowIso())
    .first<{ secret_hash: string }>();
  return row?.secret_hash ?? null;
}

/** Spends a link. One conditional write, so two registrations racing can't both win. */
export async function consumeInvite(userId: UserId, db: D1Database, id: string): Promise<boolean> {
  const now = nowIso();
  const r = await db
    .prepare(
      `UPDATE invite SET used_at = ?3
       WHERE user_id = ?1 AND id = ?2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?3`,
    )
    .bind(userId, id, now)
    .run();
  return r.meta.changes === 1;
}

export async function revokeInvite(userId: UserId, db: D1Database, id: string): Promise<boolean> {
  const r = await db
    .prepare(
      'UPDATE invite SET revoked_at = ?3 WHERE user_id = ?1 AND id = ?2 AND used_at IS NULL AND revoked_at IS NULL',
    )
    .bind(userId, id, nowIso())
    .run();
  return r.meta.changes === 1;
}
