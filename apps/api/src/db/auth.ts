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
      'SELECT id, refresh_hash, expires_at, revoked_at FROM session WHERE user_id = ?1 AND id = ?2',
    )
    .bind(userId, id)
    .first<SessionRow>();
}

/** Compare-and-swap rotation: succeeds only if the presented hash is still current. */
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
      'UPDATE session SET refresh_hash = ?4, expires_at = ?5, last_seen_at = ?6 WHERE user_id = ?1 AND id = ?2 AND refresh_hash = ?3 AND revoked_at IS NULL',
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

export async function getTotp(
  userId: UserId,
  db: D1Database,
): Promise<{ secret_enc: string; confirmed_at: string | null } | null> {
  return db
    .prepare('SELECT secret_enc, confirmed_at FROM totp_secret WHERE user_id = ?1')
    .bind(userId)
    .first();
}

/** Starting setup replaces any unconfirmed secret and disables TOTP until confirmed. */
export async function putPendingTotp(
  userId: UserId,
  db: D1Database,
  secretEnc: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO totp_secret (user_id, secret_enc, confirmed_at) VALUES (?1, ?2, NULL) ON CONFLICT(user_id) DO UPDATE SET secret_enc = excluded.secret_enc, confirmed_at = NULL',
    )
    .bind(userId, secretEnc)
    .run();
}

export async function confirmTotp(userId: UserId, db: D1Database): Promise<void> {
  await db
    .prepare('UPDATE totp_secret SET confirmed_at = ?2 WHERE user_id = ?1')
    .bind(userId, nowIso())
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

/** Atomically consumes a code. False if it doesn't exist or was already used. */
export async function consumeRecoveryCode(
  userId: UserId,
  db: D1Database,
  hash: string,
): Promise<boolean> {
  const r = await db
    .prepare(
      'UPDATE recovery_code SET used_at = ?3 WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL',
    )
    .bind(userId, hash, nowIso())
    .run();
  return r.meta.changes === 1;
}
