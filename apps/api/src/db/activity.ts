import { newId, nowIso, type UserId } from './util';

/**
 * The activity + performance log (migration 0037). Append-only; rolled up and pruned nightly
 * (backup.ts). Writers return statements or swallow their own failures: logging must never
 * be able to fail the thing it describes.
 */

// ── activity_event ──────────────────────────────────────────────────────────

export interface ActivityDraft {
  entity: string;
  entityId: string | null;
  action: string;
  status: number;
  ms: number;
  changes: unknown;
}

export function insertActivityStmt(
  userId: UserId,
  db: D1Database,
  e: ActivityDraft,
  at = nowIso(),
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activity_event (id, user_id, at, entity, entity_id, action, status, ms, changes_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      newId(),
      userId,
      at,
      e.entity,
      e.entityId,
      e.action,
      e.status,
      e.ms,
      e.changes === null || e.changes === undefined ? null : JSON.stringify(e.changes),
    );
}

export interface ActivityRow {
  at: string;
  entity: string;
  entity_id: string | null;
  action: string;
  status: number;
  ms: number;
  changes_json: string | null;
}

export async function listActivity(
  userId: UserId,
  db: D1Database,
  sinceIso: string,
  limit: number,
): Promise<ActivityRow[]> {
  const { results } = await db
    .prepare(
      `SELECT at, entity, entity_id, action, status, ms, changes_json
       FROM activity_event WHERE user_id = ?1 AND at >= ?2 ORDER BY at DESC, id LIMIT ?3`,
    )
    .bind(userId, sinceIso, limit)
    .all<ActivityRow>();
  return results;
}

/** Per entity and action in the window, for the summary view. Reads only the window. */
export async function activityCounts(
  userId: UserId,
  db: D1Database,
  sinceIso: string,
): Promise<{ entity: string; action: string; n: number; failed: number; ms_total: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT entity, action, COUNT(*) AS n, SUM(status >= 400) AS failed, SUM(ms) AS ms_total
       FROM activity_event WHERE user_id = ?1 AND at >= ?2 GROUP BY entity, action`,
    )
    .bind(userId, sinceIso)
    .all<{ entity: string; action: string; n: number; failed: number; ms_total: number }>();
  return results;
}

// ── before/after snapshots ──────────────────────────────────────────────────

export type SnapshotEntity =
  'txn' | 'category' | 'category_group' | 'account' | 'period' | 'allocation' | 'settings';

/**
 * One row by primary key, scoped to the user, as plain values. Only columns worth diffing are
 * selected (the redaction rule that decides what is kept lives in lib/activity.ts). Missing row:
 * null (a delete's "after", or an id that never existed).
 */
export async function snapshotEntity(
  userId: UserId,
  db: D1Database,
  entity: SnapshotEntity,
  id: string,
): Promise<Record<string, unknown> | null> {
  const one = (sql: string) => db.prepare(sql).bind(userId, id).first<Record<string, unknown>>();
  switch (entity) {
    case 'txn': {
      const [row, splits] = await Promise.all([
        one(
          `SELECT amount_cents, posted_at, is_pending, is_transfer,
             transfer_pair_id IS NOT NULL AS paired, review_state, notes, merchant_display
           FROM txn WHERE user_id = ?1 AND id = ?2`,
        ),
        db
          .prepare(
            `SELECT category_id, amount_cents FROM split WHERE user_id = ?1 AND txn_id = ?2
             ORDER BY sort_order`,
          )
          .bind(userId, id)
          .all<{ category_id: string; amount_cents: number }>(),
      ]);
      return row
        ? {
            ...row,
            splits: splits.results.map((s) => `${s.category_id}:${s.amount_cents}`).join(','),
          }
        : null;
    }
    case 'category':
      return one(
        `SELECT group_id, rollover_policy, spend_shape, is_bill, typical_post_day,
           archived_at IS NOT NULL AS archived, sort_order, name, emoji
         FROM category WHERE user_id = ?1 AND id = ?2`,
      );
    case 'category_group':
      return one(
        'SELECT kind, sort_order, name FROM category_group WHERE user_id = ?1 AND id = ?2',
      );
    case 'account':
      return one(
        `SELECT kind, balance_cents, include_in_net_worth, include_in_budget, expected_payment_cents,
           payment_day, sync_cadence_hours, archived_at IS NOT NULL AS archived, name, nickname
         FROM account WHERE user_id = ?1 AND id = ?2`,
      );
    case 'period':
      return one('SELECT status, expected_income_cents FROM period WHERE user_id = ?1 AND id = ?2');
    case 'allocation':
      return one(
        'SELECT period_id, category_id, planned_cents FROM allocation WHERE user_id = ?1 AND id = ?2',
      );
    case 'settings': {
      const row = await db
        .prepare('SELECT settings_json FROM user WHERE id = ?1 /* scoped:user.id */')
        .bind(userId)
        .first<{ settings_json: string }>();
      if (!row) return null;
      try {
        return JSON.parse(row.settings_json) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
}

/** What sync did per UTC day and kind in the window (summary rows excluded). */
export async function syncEventDaily(
  userId: UserId,
  db: D1Database,
  sinceIso: string,
): Promise<{ day: string; kind: string; n: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT SUBSTR(created_at, 1, 10) AS day, kind, COUNT(*) AS n FROM sync_event
       WHERE user_id = ?1 AND created_at >= ?2 AND kind != 'summary' GROUP BY day, kind`,
    )
    .bind(userId, sinceIso)
    .all<{ day: string; kind: string; n: number }>();
  return results;
}
