import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError, ErrorCode } from '@rise/shared/schemas';

/** Thrown anywhere in a handler; rendered as the stable error contract (ARCHITECTURE §4). */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export function errorBody(code: ErrorCode, message: string, detail?: unknown): ApiError {
  return { error: detail === undefined ? { code, message } : { code, message, detail } };
}

/**
 * D1's free tier refuses every query once the daily rows-read or rows-written cap is spent
 * (code 7500 / "exceeded D1's free tier daily … limit"). It resets at 00:00 UTC. Say so plainly
 * instead of a generic 500, so the app can show saved data and explain.
 */
export const isDbLimit = (err: unknown) =>
  err instanceof Error && /free tier|daily row (read|written?) limit|\b7500\b/i.test(err.message);

export function renderError(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    return c.json(
      errorBody(err.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST', err.message),
      err.status as ContentfulStatusCode,
    );
  }
  if (err instanceof AppError)
    return c.json(errorBody(err.code, err.message, err.detail), err.status);
  if (isDbLimit(err))
    return c.json(
      errorBody(
        'DB_LIMIT',
        'Rise has used its free daily database allowance. It resets at 7 pm Central.',
      ),
      503,
    );
  logInternal(err, c);
  return c.json(errorBody('INTERNAL', 'Something went wrong'), 500);
}

/**
 * An unexpected error is otherwise invisible: the client only sees INTERNAL. One structured line
 * for Workers Logs — method, route path, and the error itself. Never the request body, query
 * string or headers, which can carry amounts, search text or tokens.
 */
function logInternal(err: Error, c: Context) {
  console.error(
    JSON.stringify({
      level: 'error',
      method: c.req.method,
      // The matched pattern (`/api/merchants/:name`) over the literal path where there is one.
      path: c.req.routePath && !c.req.routePath.endsWith('*') ? c.req.routePath : c.req.path,
      name: err.name,
      message: err.message.slice(0, 500),
      stack: err.stack?.split('\n').slice(0, 6).join('\n'),
    }),
  );
}
