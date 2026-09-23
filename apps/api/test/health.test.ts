import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('worker', () => {
  it('GET /health → { ok: true }', async () => {
    const res = await exports.default.fetch('https://rise.test/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown routes return the error contract', async () => {
    const res = await exports.default.fetch('https://rise.test/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
