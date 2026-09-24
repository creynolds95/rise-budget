import { env, exports } from 'cloudflare:workers';
import { signAccess } from '../src/lib/tokens';
import { describe, expect, it } from 'vitest';

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
    const access = await signAccess(env, 'u1', 's1');
    const res = await exports.default.fetch('https://rise.test/api/nope', {
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
