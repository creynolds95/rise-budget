import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { isDbLimit, renderError } from '../src/lib/errors';

describe('D1 free-tier cap', () => {
  const app = new Hono().onError(renderError);
  app.get('/cap', () => {
    throw new Error(
      "D1_ERROR: Exceeded D1's free tier daily row read limit, please upgrade [code: 7500]",
    );
  });
  app.get('/other', () => {
    throw new Error('something else broke');
  });

  it('is told apart from other failures', () => {
    expect(isDbLimit(new Error('D1_ERROR: free tier daily row written limit [code: 7500]'))).toBe(
      true,
    );
    expect(isDbLimit(new Error('no such table: x'))).toBe(false);
    expect(isDbLimit('free tier')).toBe(false);
  });

  it('answers 503 DB_LIMIT instead of a generic 500', async () => {
    const r = await app.request('/cap');
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('DB_LIMIT');
    expect((await app.request('/other')).status).toBe(500);
  });
});
