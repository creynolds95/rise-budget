import { sign, verify } from 'hono/jwt';
import type { Env } from '../env';
import { b64urlEncode, hmacSha256, hmacSha256Hex, randomBytes, sha256Hex } from './crypto';

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
export const CHALLENGE_TTL_S = 2 * 60;
export const REGISTRATION_TTL_S = 10 * 60;
export const STEP_UP_TTL_S = 5 * 60;

type Purpose = 'access' | 'challenge' | 'register' | 'stepup';

const nowS = () => Math.floor(Date.now() / 1000);

async function signToken(env: Env, typ: Purpose, ttl: number, claims: Record<string, string>) {
  return sign({ ...claims, typ, iat: nowS(), exp: nowS() + ttl }, env.JWT_SECRET, 'HS256');
}

/** Verifies signature, expiry, and purpose. Returns null on any failure. */
async function verifyToken(
  env: Env,
  typ: Purpose,
  token: string,
): Promise<Record<string, unknown> | null> {
  try {
    const payload = await verify(token, env.JWT_SECRET, 'HS256');
    return payload['typ'] === typ ? payload : null;
  } catch {
    return null;
  }
}

export const signAccess = (env: Env, userId: string, sessionId: string) =>
  signToken(env, 'access', ACCESS_TTL_S, { sub: userId, sid: sessionId });

export async function verifyAccess(env: Env, token: string) {
  const p = await verifyToken(env, 'access', token);
  return p && typeof p['sub'] === 'string' && typeof p['sid'] === 'string'
    ? { userId: p['sub'], sessionId: p['sid'] }
    : null;
}

/**
 * Proof the user re-verified with a passkey moments ago (H4: a 15-minute access token alone
 * shouldn't be enough to enable a second permanent auth factor). Bound to the user, not the
 * session, so it survives a refresh and works for the one-time registration-link flow too.
 */
export const signStepUp = (env: Env, userId: string) =>
  signToken(env, 'stepup', STEP_UP_TTL_S, { sub: userId });

export async function verifyStepUp(env: Env, token: string) {
  const p = await verifyToken(env, 'stepup', token);
  return p && typeof p['sub'] === 'string' ? { userId: p['sub'] } : null;
}

/** Stateless WebAuthn challenge: signed, short-lived, bound to purpose and (for register) user. */
export const signChallenge = (
  env: Env,
  challenge: string,
  ceremony: 'register' | 'login',
  userId = '',
) => signToken(env, 'challenge', CHALLENGE_TTL_S, { challenge, ceremony, sub: userId });

export async function verifyChallenge(env: Env, token: string, ceremony: 'register' | 'login') {
  const p = await verifyToken(env, 'challenge', token);
  return p && p['ceremony'] === ceremony && typeof p['challenge'] === 'string'
    ? { challenge: p['challenge'], userId: String(p['sub'] ?? '') }
    : null;
}

/** One-time first-device registration link token, minted by `pnpm seed:user`. */
export const signRegistration = (env: Pick<Env, 'JWT_SECRET'>, userId: string) =>
  sign(
    { sub: userId, typ: 'register', iat: nowS(), exp: nowS() + REGISTRATION_TTL_S },
    env.JWT_SECRET,
    'HS256',
  );

export async function verifyRegistration(env: Env, token: string) {
  const p = await verifyToken(env, 'register', token);
  return p && typeof p['sub'] === 'string' ? { userId: p['sub'] } : null;
}

// ── refresh tokens: opaque `userId.sessionId.secret`, stored as SHA-256 of the secret ──

export function newRefreshSecret(): string {
  return b64urlEncode(randomBytes(32));
}

export const formatRefresh = (userId: string, sessionId: string, secret: string) =>
  `${userId}.${sessionId}.${secret}`;

export function parseRefresh(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p === '')) return null;
  const [userId, sessionId, secret] = parts as [string, string, string];
  return { userId, sessionId, secret };
}

export const hashSecret = sha256Hex;

/**
 * How long the refresh secret that was current a moment ago still works. Two tabs (or the
 * installed app and a browser tab sharing cookies) refreshing at once, or a refresh whose
 * response was lost, present it legitimately; past this, presenting it is treated as theft.
 */
export const REFRESH_GRACE_MS = 60_000;

/**
 * The secret that replaces `secret` on rotation. Derived under JWT_SECRET instead of drawn at
 * random, so a request inside the grace window presenting the superseded secret is handed the
 * very same successor: both tabs end on one token and neither strands the other. Nothing about
 * it is stored; without the server key the successor can't be computed from the old secret.
 */
export async function nextRefreshSecret(
  env: Pick<Env, 'JWT_SECRET'>,
  sessionId: string,
  secret: string,
): Promise<string> {
  return b64urlEncode(await hmacSha256(env.JWT_SECRET, `refresh:${sessionId}:${secret}`));
}

/**
 * Recovery codes are stored as HMAC-SHA-256 under TOTP_KEY (the key that already seals the
 * TOTP secrets at rest), prefixed so the format is visible. A bare SHA-256 of a 10-character
 * code could be brute-forced from a leaked backup; this can't be without the Worker secret.
 */
export const RECOVERY_HASH_PREFIX = 'h1:';

export async function hashRecoveryCode(
  env: Pick<Env, 'TOTP_KEY'>,
  normalized: string,
): Promise<string> {
  return RECOVERY_HASH_PREFIX + (await hmacSha256Hex(env.TOTP_KEY, `recovery:${normalized}`));
}
