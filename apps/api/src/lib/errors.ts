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

export function renderError(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    return c.json(
      errorBody(err.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST', err.message),
      err.status as ContentfulStatusCode,
    );
  }
  if (err instanceof AppError)
    return c.json(errorBody(err.code, err.message, err.detail), err.status);
  return c.json(errorBody('INTERNAL', 'Something went wrong'), 500);
}
