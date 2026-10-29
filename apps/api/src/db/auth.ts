import { nowIso, type UserId } from './util';

// ── login entry point ─────────────────────────────────────────────────────────

/**
 * The one statement that cannot be scoped by a known user id: resolving who is trying to
 * log in with the TOTP/recovery fallback. Returns only the id.
 */
export async function findUserIdByEmail(db: D1Database, email: string): Promise<UserId | null> {
  const row = await db
    .prepare('SELECT id FROM user WHERE email = ?1 COLLATE NOCASE /* lookup:login */')
    .bind(email)
    .first<{ id: string }>();
  return row?.id ?? null;
}

// ── passkeys ──────────────────────────────────────────────────────────────────

export interface CredentialRow {
  id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports: string | null;
  device_label: string | null;
}

export async function listCredentials(userId: UserId, db: D1Database): Promise<CredentialRow[]> {
  const { results } = await db
    .prepare(
      'SELECT id, public_key, counter, transports, device_label FROM credential WHERE user_id = ?1',
    )
    .bind(userId)
    .all<CredentialRow>();
  return results;
}

export async function getCredential(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<CredentialRow | null> {
  return db
    .prepare(
      'SELECT id, public_key, counter, transports, device_label FROM credential WHERE user_id = ?1 AND id = ?2',
    )
    .bind(userId, id)
    .first<CredentialRow>();
}

export async function insertCredential(
  userId: UserId,
  db: D1Database,
  c: {
    id: string;
    publicKey: Uint8Array;
    counter: number;
    transports: string[];
    deviceLabel: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO credential (id, user_id, public_key, counter, transports, device_label, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    )
    .bind(
      c.id,
      userId,
      c.publicKey,
      c.counter,
      JSON.stringify(c.transports),
      c.deviceLabel,
      nowIso(),
    )
    .run();
}

export async function touchCredential(
  userId: UserId,
  db: D1Database,
  id: string,
  counter: number,
): Promise<void> {
  await db
    .prepare('UPDATE credential SET counter = ?3, last_used_at = ?4 WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id, counter, nowIso())
    .run();
}

// ── sessions (one row = one refresh-token family) ─────────────────────────────

export interface SessionRow {
  id: string;
  refresh_hash: string;
  /** The hash `refresh_hash` replaced at the last rotation, accepted briefly after it. */
  prev_refresh_hash: string | null;
  rotated_at: string | null;
  expires_at: string;
  revoked_at: string | null;
}

export async function createSession(
  userId: UserId,
  db: D1Database,
  s: { id: string; refreshHash: string; expiresAt: string; deviceLabel?: string | null },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO session (id, user_id, refresh_hash, expires_at, created_at, device_label, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)',
    )
    .bind(s.id, userId, s.refreshHash, s.expiresAt, now, s.deviceLabel ?? null)
    .run();
}

export async function getSession(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<SessionRow | null> {
  return db
    .prepare(
      'SELECT id, refresh_hash, prev_refresh_hash, rotated_at, expires_at, revoked_at FROM session WHERE user_id = ?1 AND id = ?2',
    )
    .bind(userId, id)
    .first<SessionRow>();
}

/**
 * Every authenticated request asks this, so a signed-out device stops working at once rather
 * than when its 15-minute access token runs out. One primary-key read.
 */
export async function isSessionLive(userId: UserId, db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT 1 AS live FROM session WHERE id = ?2 AND user_id = ?1 AND revoked_at IS NULL AND expires_at > ?3',
    )
    .bind(userId, id, nowIso())
    .first<{ live: number }>();
  return row !== null;
}

/**
 * Compare-and-swap rotation: succeeds only if the presented hash is still current. The hash it
 * replaces is kept, with the time, for the refresh grace window.
 */
export async function rotateSession(
  userId: UserId,
  db: D1Database,
  id: string,
  fromHash: string,
  toHash: string,
  expiresAt: string,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE session SET refresh_hash = ?4, prev_refresh_hash = ?3, rotated_at = ?6, expires_at = ?5,
         last_seen_at = ?6
       WHERE user_id = ?1 AND id = ?2 AND refresh_hash = ?3 AND revoked_at IS NULL`,
    )
    .bind(userId, id, fromHash, toHash, expiresAt, nowIso())
    .run();
  return r.meta.changes === 1;
}

export async function revokeSession(userId: UserId, db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      'UPDATE session SET revoked_at = ?3 WHERE user_id = ?1 AND id = ?2 AND revoked_at IS NULL',
    )
    .bind(userId, id, nowIso())
    .run();
}

// ── device management (C17) ──────────────────────────────────────────────────

export interface PasskeySummaryRow {
  id: string;
  device_label: string | null;
  created_at: string;
  last_used_at: string | null;
}

export async function listPasskeys(userId: UserId, db: D1Database): Promise<PasskeySummaryRow[]> {
  const { results } = await db
    .prepare(
      'SELECT id, device_label, created_at, last_used_at FROM credential WHERE user_id = ?1 ORDER BY created_at',
    )
    .bind(userId)
    .all<PasskeySummaryRow>();
  return results;
}

/** Removes a passkey unless it is the user's last one — that would lock them out. */
export async function deletePasskey(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<'deleted' | 'last' | 'missing'> {
  const r = await db
    .prepare(
      `DELETE FROM credential WHERE user_id = ?1 AND id = ?2
         AND (SELECT COUNT(*) FROM credential WHERE user_id = ?1) > 1`,
    )
    .bind(userId, id)
    .run();
  if (r.meta.changes === 1) return 'deleted';
  return (await getCredential(userId, db, id)) ? 'last' : 'missing';
}

export interface ActiveSessionRow {
  id: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export async function listActiveSessions(
  userId: UserId,
  db: D1Database,
): Promise<ActiveSessionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, device_label, created_at, last_seen_at FROM session
       WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2
       ORDER BY COALESCE(last_seen_at, created_at) DESC`,
    )
    .bind(userId, nowIso())
    .all<ActiveSessionRow>();
  return results;
}

// ── TOTP ──────────────────────────────────────────────────────────────────────

export interface TotpRow {
  /** The secret sign-in checks, once `confirmed_at` is set. */
  secret_enc: string;
  confirmed_at: string | null;
  /** A setup in progress, waiting to be confirmed. */
  pending_secret_enc: string | null;
  last_step: number | null;
}

export async function getTotp(userId: UserId, db: D1Database): Promise<TotpRow | null> {
  return db
    .prepare(
      'SELECT secret_enc, confirmed_at, pending_secret_enc, last_step FROM totp_secret WHERE user_id = ?1',
    )
    .bind(userId)
    .first<TotpRow>();
}

/** The secret a confirm call checks: the pending one, or (before migration 0026) an unconfirmed row's. */
export const pendingTotpSecret = (row: TotpRow): string | null =>
  row.pending_secret_enc ?? (row.confirmed_at ? null : row.secret_enc);

/**
 * Starting setup parks the new secret beside a confirmed one, which keeps working until the new
 * one is confirmed — re-running setup must not switch off a working second factor.
 */
export async function putPendingTotp(
  userId: UserId,
  db: D1Database,
  secretEnc: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO totp_secret (user_id, secret_enc, confirmed_at, pending_secret_enc) VALUES (?1, ?2, NULL, ?2)
       ON CONFLICT(user_id) DO UPDATE SET pending_secret_enc = excluded.pending_secret_enc,
         secret_enc = CASE WHEN totp_secret.confirmed_at IS NULL THEN excluded.secret_enc ELSE totp_secret.secret_enc END`,
    )
    .bind(userId, secretEnc)
    .run();
}

/**
 * The pending secret becomes the one sign-in checks. Compare-and-swap on the secret that was
 * verified, so a setup restarted meanwhile isn't confirmed by a code from the old one. The
 * confirming code's step is spent, like any sign-in code.
 */
export async function confirmTotp(
  userId: UserId,
  db: D1Database,
  verifiedEnc: string,
  step: number,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE totp_secret SET secret_enc = ?2, pending_secret_enc = NULL, confirmed_at = ?3, last_step = ?4
       WHERE user_id = ?1 AND (pending_secret_enc = ?2 OR (pending_secret_enc IS NULL AND confirmed_at IS NULL AND secret_enc = ?2))`,
    )
    .bind(userId, verifiedEnc, nowIso(), step)
    .run();
  return r.meta.changes === 1;
}

/**
 * Spends a TOTP step: true only if no code from this step or a later one was accepted before.
 * One conditional write, so two requests racing with the same code can't both pass.
 */
export async function spendTotpStep(
  userId: UserId,
  db: D1Database,
  step: number,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE totp_secret SET last_step = ?2
       WHERE user_id = ?1 AND confirmed_at IS NOT NULL AND (last_step IS NULL OR last_step < ?2)`,
    )
    .bind(userId, step)
    .run();
  return r.meta.changes === 1;
}

// ── fallback-login lockout ────────────────────────────────────────────────────

/**
 * Claims one fallback sign-in attempt before the code is checked: at most `max` in a window of
 * `windowMs` from the first. A single conditional UPDATE, so parallel attempts can't all see
 * "under the limit" and get through. False means locked out.
 */
export async function claimFallbackAttempt(
  userId: UserId,
  db: D1Database,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs).toISOString();
  const r = await db
    .prepare(
      `UPDATE user SET
         fallback_attempts = CASE WHEN fallback_window_at IS NULL OR fallback_window_at <= ?2 THEN 1
                                  ELSE fallback_attempts + 1 END,
         fallback_window_at = CASE WHEN fallback_window_at IS NULL OR fallback_window_at <= ?2 THEN ?3
                                   ELSE fallback_window_at END
       WHERE id = ?1 /* scoped:user.id */
         AND (fallback_window_at IS NULL OR fallback_window_at <= ?2 OR fallback_attempts < ?4)`,
    )
    .bind(userId, windowStart, now.toISOString(), max)
    .run();
  return r.meta.changes === 1;
}

/** A code that was accepted gives its claimed attempt back: only failures count. */
export async function releaseFallbackAttempt(userId: UserId, db: D1Database): Promise<void> {
  await db
    .prepare(
      'UPDATE user SET fallback_attempts = MAX(fallback_attempts - 1, 0) WHERE id = ?1 /* scoped:user.id */',
    )
    .bind(userId)
    .run();
}

// ── recovery codes (stored hashed, single-use) ────────────────────────────────

export async function replaceRecoveryCodes(
  userId: UserId,
  db: D1Database,
  codes: { id: string; hash: string }[],
): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM recovery_code WHERE user_id = ?1').bind(userId),
    ...codes.map((c) =>
      db
        .prepare('INSERT INTO recovery_code (id, user_id, code_hash) VALUES (?1, ?2, ?3)')
        .bind(c.id, userId, c.hash),
    ),
  ]);
}

/**
 * Atomically consumes a code. False if it doesn't exist or was already used. `legacyHash` is
 * the bare SHA-256 that codes generated before migration 0026 were stored under: those stay
 * usable until used or replaced by a fresh set (their plaintext isn't known, so they can't be
 * re-hashed in place).
 */
export async function consumeRecoveryCode(
  userId: UserId,
  db: D1Database,
  hash: string,
  legacyHash: string,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE recovery_code SET used_at = ?4
       WHERE id = (SELECT id FROM recovery_code
                   WHERE user_id = ?1 AND code_hash IN (?2, ?3) AND used_at IS NULL LIMIT 1)
         AND user_id = ?1 AND used_at IS NULL`,
    )
    .bind(userId, hash, legacyHash, nowIso())
    .run();
  return r.meta.changes === 1;
}
