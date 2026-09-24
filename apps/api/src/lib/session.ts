import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createSession } from '../db';
import type { AppEnv } from '../env';
import { AppError } from './errors';
import {
  formatRefresh,
  hashSecret,
  newRefreshSecret,
  REFRESH_TTL_S,
  signAccess,
  signStepUp,
  verifyAccess,
  verifyStepUp,
} from './tokens';

export const REFRESH_COOKIE = 'rise_refresh';

export const refreshExpiry = () => new Date(Date.now() + REFRESH_TTL_S * 1000).toISOString();

export function setRefreshCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/api/auth',
    maxAge: REFRESH_TTL_S,
  });
}

export function clearRefreshCookie(c: Context<AppEnv>) {
  deleteCookie(c, REFRESH_COOKIE, { path: '/api/auth', secure: true });
}

export const readRefreshCookie = (c: Context<AppEnv>) => getCookie(c, REFRESH_COOKIE);

/**
 * Start a new session family: refresh token in an httpOnly cookie, access token in the body.
 * Signing in is itself a fresh proof of identity, so it also mints a step-up token (H4).
 */
export async function issueSession(c: Context<AppEnv>, userId: string) {
  const sessionId = crypto.randomUUID();
  const secret = newRefreshSecret();
  await createSession(userId, c.env.DB, {
    id: sessionId,
    refreshHash: await hashSecret(secret),
    expiresAt: refreshExpiry(),
  });
  setRefreshCookie(c, formatRefresh(userId, sessionId, secret));
  return c.json({
    access: await signAccess(c.env, userId, sessionId),
    stepUp: await signStepUp(c.env, userId),
  });
}

/** T16: every route behind this requires a valid access token. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? await verifyAccess(c.env, token) : null;
  if (!claims) throw new AppError(401, 'UNAUTHORIZED', 'Sign in required');
  c.set('userId', claims.userId);
  c.set('sessionId', claims.sessionId);
  await next();
};

/** Same as requireAuth but lets the handler run unauthenticated (register with a link token). */
export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const claims = header.startsWith('Bearer ') ? await verifyAccess(c.env, header.slice(7)) : null;
  if (claims) {
    c.set('userId', claims.userId);
    c.set('sessionId', claims.sessionId);
  }
  await next();
};

/**
 * H4: a standing 15-minute access token alone must not be enough to enable a second
 * permanent auth factor (a new passkey, TOTP, or fresh recovery codes) — that needs a
 * moments-old re-verification. Only bites when the caller is already signed in: someone
 * registering their very first device off the one-time link from `pnpm seed:user` has no
 * `userId` here yet, and that link is itself a single-use proof.
 */
export const requireStepUp: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = c.get('userId');
  if (userId) {
    const token = c.req.header('X-Step-Up') ?? '';
    const claims = token ? await verifyStepUp(c.env, token) : null;
    if (!claims || claims.userId !== userId) {
      throw new AppError(401, 'STEP_UP_REQUIRED', 'Re-verify with your passkey to continue');
    }
  }
  await next();
};
