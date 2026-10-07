import { exports } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { AppError, renderError } from '../src/lib/errors';
import { signedInUser } from './helpers/http';

describe('worker', () => {
  it('GET /health → { ok: true }', async () => {
    const res = await exports.default.fetch('https://rise.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown routes do not reveal themselves to anonymous callers', async () => {
    const res = await exports.default.fetch('https://rise.test/api/nope');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('unknown routes return NOT_FOUND to a signed-in caller', async () => {
    const { access } = await signedInUser();
    const res = await exports.default.fetch('https://rise.test/api/nope', {
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('logs an unexpected 500 without the request body, and hides it from the caller', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => spy.mockRestore());
    const app = new Hono();
    app.post('/boom/:id', () => {
      throw new Error('D1_ERROR: FOREIGN KEY constraint failed');
    });
    app.onError(renderError);
    const res = await app.request('/boom/abc?q=secret-search', {
      method: 'POST',
      body: JSON.stringify({ amountCents: 123_456, token: 'secret-token' }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong' },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      level: 'error',
      method: 'POST',
      path: '/boom/:id',
      message: 'D1_ERROR: FOREIGN KEY constraint failed',
    });
    expect(line).not.toMatch(/secret|123456/);
  });

  it('does not log the errors it expects', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => spy.mockRestore());
    const app = new Hono();
    app.get('/nope', () => {
      throw new AppError(404, 'NOT_FOUND', 'No such thing');
    });
    app.onError(renderError);
    expect((await app.request('/nope')).status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});
