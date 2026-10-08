import type { VapidKeys } from '../lib/webpush';
import { newId, nowIso, type UserId } from './util';

/** Push notifications (SPEC §8.2): the sender's keys, each device's subscription, and a log. */

export async function getVapid(userId: UserId, db: D1Database): Promise<VapidKeys | null> {
  const row = await db
    .prepare('SELECT public_key, private_jwk FROM push_vapid WHERE user_id = ?1')
    .bind(userId)
    .first<{ public_key: string; private_jwk: string }>();
  return row ? { publicKey: row.public_key, privateJwk: row.private_jwk } : null;
}

/** Keep the first pair ever saved: a second would orphan every device's subscription. */
export async function saveVapid(userId: UserId, db: D1Database, keys: VapidKeys): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_vapid (user_id, public_key, private_jwk, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id) DO NOTHING`,
    )
    .bind(userId, keys.publicKey, keys.privateJwk, nowIso())
    .run();
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function listPushSubscriptions(
  userId: UserId,
  db: D1Database,
): Promise<PushSubscriptionRow[]> {
  const { results } = await db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE user_id = ?1')
    .bind(userId)
    .all<PushSubscriptionRow>();
  return results;
}

export async function savePushSubscription(
  userId: UserId,
  db: D1Database,
  s: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(newId(), userId, s.endpoint, s.p256dh, s.auth, nowIso())
    .run();
}

export async function deletePushSubscription(
  userId: UserId,
  db: D1Database,
  endpoint: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM push_subscription WHERE user_id = ?1 AND endpoint = ?2')
    .bind(userId, endpoint)
    .run();
}

/** Of these keys, the ones already told. */
export async function sentKeys(
  userId: UserId,
  db: D1Database,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const { results } = await db
    .prepare(
      `SELECT p.key FROM json_each(?2) j CROSS JOIN push_sent p
       WHERE p.user_id = ?1 AND p.key = j.value`,
    )
    .bind(userId, JSON.stringify(keys))
    .all<{ key: string }>();
  return new Set(results.map((r) => r.key));
}

export function markSentStmts(
  userId: UserId,
  db: D1Database,
  keys: readonly string[],
): D1PreparedStatement[] {
  const now = nowIso();
  return keys.map((k) =>
    db
      .prepare('INSERT OR IGNORE INTO push_sent (user_id, key, sent_at) VALUES (?1, ?2, ?3)')
      .bind(userId, k, now),
  );
}

/** Charges with a quiet flag still waiting for review, for push. Off the review index. */
export async function flaggedForReview(
  userId: UserId,
  db: D1Database,
): Promise<
  { id: string; name: string; amountCents: number; flag: 'duplicate' | 'unusual' | 'first_time' }[]
> {
  const { results } = await db
    .prepare(
      `SELECT id, COALESCE(merchant_display, merchant_normalized) AS name, amount_cents, flag
       FROM txn WHERE user_id = ?1 AND review_state = 'needs_review'
         AND flag IN ('duplicate', 'unusual', 'first_time')
       ORDER BY posted_at DESC LIMIT 20`,
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      amount_cents: number;
      flag: 'duplicate' | 'unusual' | 'first_time';
    }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    amountCents: r.amount_cents,
    flag: r.flag,
  }));
}

/** Money out over a week and what's waiting for review, for the weekly recap. */
export async function weekSummary(
  userId: UserId,
  db: D1Database,
  from: string,
  to: string,
): Promise<{ spentCents: number; toReview: number }> {
  const [spent, review] = await db.batch<{ n: number }>([
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM txn
         WHERE user_id = ?1 AND posted_at BETWEEN ?2 AND ?3 AND amount_cents > 0
           AND is_transfer = 0 AND review_state != 'dropped'`,
      )
      .bind(userId, from, to),
    db
      .prepare("SELECT COUNT(*) AS n FROM txn WHERE user_id = ?1 AND review_state = 'needs_review'")
      .bind(userId),
  ]);
  return { spentCents: spent?.results[0]?.n ?? 0, toReview: review?.results[0]?.n ?? 0 };
}
