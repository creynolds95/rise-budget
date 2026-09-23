import type { AuditAction } from '@rise/shared/schemas';
import { newId, nowIso, type UserId } from './util';

/** Append-only (SPEC §9). There is deliberately no update or delete. */
export async function writeAudit(
  userId: UserId,
  db: D1Database,
  action: AuditAction,
  target: { type?: string; id?: string; detail?: Record<string, unknown> } = {},
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO audit_log (id, user_id, action, target_type, target_id, detail_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    )
    .bind(
      newId(),
      userId,
      action,
      target.type ?? null,
      target.id ?? null,
      target.detail ? JSON.stringify(target.detail) : null,
      nowIso(),
    )
    .run();
}

export async function countAuditSince(
  userId: UserId,
  db: D1Database,
  action: AuditAction,
  sinceIso: string,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?1 AND action = ?2 AND created_at >= ?3',
    )
    .bind(userId, action, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listAudit(userId: UserId, db: D1Database, limit = 100) {
  const { results } = await db
    .prepare(
      'SELECT action, target_type, target_id, detail_json, created_at FROM audit_log WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2',
    )
    .bind(userId, limit)
    .all<{
      action: string;
      target_type: string | null;
      target_id: string | null;
      detail_json: string | null;
      created_at: string;
    }>();
  return results;
}
