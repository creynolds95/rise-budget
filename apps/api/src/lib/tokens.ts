import { sign, verify } from 'hono/jwt';
import type { Env } from '../env';
import { b64urlEncode, randomBytes, sha256Hex } from './crypto';

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
export const CHALLENGE_TTL_S = 2 * 60;
export const REGISTRATION_TTL_S = 10 * 60;

type Purpose = 'access' | 'challenge' | 'register';

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
