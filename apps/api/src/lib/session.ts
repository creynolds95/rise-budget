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
  verifyAccess,
} from './tokens';

export const REFRESH_COOKIE = 'rise_refresh';

export const refreshExpiry = () => new Date(Date.now() + REFRESH_TTL_S * 1000).toISOString();

export function setRefreshCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/auth',
    maxAge: REFRESH_TTL_S,
  });
}

export function clearRefreshCookie(c: Context<AppEnv>) {
  deleteCookie(c, REFRESH_COOKIE, { path: '/auth', secure: true });
}

export const readRefreshCookie = (c: Context<AppEnv>) => getCookie(c, REFRESH_COOKIE);

/** Start a new session family: refresh token in an httpOnly cookie, access token in the body. */
export async function issueSession(c: Context<AppEnv>, userId: string) {
  const sessionId = crypto.randomUUID();
  const secret = newRefreshSecret();
  await createSession(userId, c.env.DB, {
    id: sessionId,
    refreshHash: await hashSecret(secret),
    expiresAt: refreshExpiry(),
  });
  setRefreshCookie(c, formatRefresh(userId, sessionId, secret));
  return c.json({ access: await signAccess(c.env, userId, sessionId) });
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
