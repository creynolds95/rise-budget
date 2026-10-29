import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/lib/crypto';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const card = (
    await call('POST', '/accounts', {
      access: u.access,
      body: { name: 'Apple Card', kind: 'credit' },
    })
  ).json;
  const post = (key: string | undefined, body: unknown) =>
    call('POST', '/transactions', {
      access: u.access,
      body,
      headers: key ? { 'idempotency-key': key } : {},
    });
  const txn = {
    accountId: card.id,
    postedAt: '2026-09-05',
    amountCents: 1_250,
    descriptor: 'SQ *COFFEE',
  };
  const count = async () =>
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM txn WHERE user_id = ?1')
        .bind(u.userId)
        .first<{ n: number }>()
    )?.n;
  return { ...u, post, txn, count };
}

describe('T22 idempotency keys', () => {
  it('an offline mutation replayed twice applies once (edge 15)', async () => {
    const s = await setup();
    const first = await s.post('offline-1', s.txn);
    const second = await s.post('offline-1', s.txn);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json).toEqual(first.json);
    expect(second.headers.get('idempotent-replay')).toBe('true');
    expect(first.headers.get('idempotent-replay')).toBeNull();
    expect(await s.count()).toBe(1);
  });

  it('rejects the same key reused for a different request', async () => {
    const s = await setup();
    await s.post('k', s.txn);
    const other = await s.post('k', { ...s.txn, amountCents: 999 });
    expect(other.status).toBe(422);
    expect(other.json.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await s.count()).toBe(1);
  });

  it('replays a client error too, without re-running it', async () => {
    const s = await setup();
    const bad = { ...s.txn, accountId: crypto.randomUUID() };
    const first = await s.post('bad', bad);
    expect(first.status).toBeGreaterThanOrEqual(400);
    expect(first.status).toBeLessThan(500);
    const again = await s.post('bad', bad);
    expect(again.status).toBe(first.status);
    expect(again.json).toEqual(first.json);
    expect(again.headers.get('idempotent-replay')).toBe('true');
  });

  it('a claim still "in progress" after a minute was abandoned; the retry takes it over', async () => {
    const s = await setup();
    // A worker that died mid-request leaves the pending claim behind.
    const pending = async (key: string, ageMs: number) => {
      const fingerprint = await sha256Hex(`POST /api/transactions\n${JSON.stringify(s.txn)}`);
      await env.DB.prepare(
        'INSERT INTO idempotency (key, user_id, response_json, created_at) VALUES (?1, ?2, ?3, ?4)',
      )
        .bind(
          `${s.userId}:${key}`,
          s.userId,
          JSON.stringify({ fingerprint, status: null, body: null }),
          new Date(Date.now() - ageMs).toISOString(),
        )
        .run();
    };
    await pending('fresh', 5_000);
    const busy = await s.post('fresh', s.txn);
    expect(busy.status).toBe(409);
    expect(busy.json.error.code).toBe('IDEMPOTENCY_CONFLICT');

    await pending('stale', 120_000);
    const retry = await s.post('stale', s.txn);
    expect(retry.status).toBe(201);
    expect(await s.count()).toBe(1);
    // And it is recorded like any other: the next replay returns it.
    const again = await s.post('stale', s.txn);
    expect(again.headers.get('idempotent-replay')).toBe('true');
    expect(again.json).toEqual(retry.json);
    expect(await s.count()).toBe(1);
  });

  it('keys are per user', async () => {
    const a = await setup();
    const b = await setup();
    expect((await a.post('shared', a.txn)).status).toBe(201);
    expect((await b.post('shared', b.txn)).status).toBe(201);
    expect(await b.count()).toBe(1);
  });

  it('without a key, each request applies', async () => {
    const s = await setup();
    await s.post(undefined, s.txn);
    await s.post(undefined, s.txn);
    expect(await s.count()).toBe(2);
  });

  it('refuses oversized keys', async () => {
    const s = await setup();
    const res = await s.post('x'.repeat(201), s.txn);
    expect(res.status).toBe(400);
    expect(await s.count()).toBe(0);
  });
});
