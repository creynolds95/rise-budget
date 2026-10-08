import { nowIso, type UserId } from './util';

/** The Claude connector's secret (SPEC §12.3): one per user, stored as a hash. */
export async function getMcpToken(
  userId: UserId,
  db: D1Database,
): Promise<{ tokenHash: string; createdAt: string } | null> {
  const row = await db
    .prepare('SELECT token_hash, created_at FROM mcp_token WHERE user_id = ?1')
    .bind(userId)
    .first<{ token_hash: string; created_at: string }>();
  return row ? { tokenHash: row.token_hash, createdAt: row.created_at } : null;
}

/** A new secret replaces the old one, so the old link stops working. */
export async function saveMcpToken(userId: UserId, db: D1Database, tokenHash: string) {
  await db
    .prepare(
      `INSERT INTO mcp_token (user_id, token_hash, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash,
         created_at = excluded.created_at`,
    )
    .bind(userId, tokenHash, nowIso())
    .run();
}

export async function deleteMcpToken(userId: UserId, db: D1Database) {
  await db.prepare('DELETE FROM mcp_token WHERE user_id = ?1').bind(userId).run();
}
