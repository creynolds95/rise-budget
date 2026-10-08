import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { b64urlEncode } from '../src/lib/crypto';
import { runPush } from '../src/lib/push';
import { refreshRecurring } from '../src/lib/recurring';
import { call, signedInUser } from './helpers/http';

/** A made-up device: a real P-256 key so the payload can be encrypted to it. */
async function device(endpoint = 'https://push.example/device-1') {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return {
    endpoint,
    keys: {
      p256dh: b64urlEncode(pub),
      auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const card = (await api('POST', '/accounts', { name: 'Card', kind: 'credit' })).json;
  const add = async (postedAt: string, amountCents: number, descriptor: string) =>
    (await api('POST', '/transactions', { accountId: card.id, postedAt, amountCents, descriptor }))
      .json as { id: string };
  return { ...u, api, add };
}

/** Every push service request, answered with `status`. */
function pushService(status = 201) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(null, { status }));
}

const NOW = new Date('2026-10-08T15:00:00Z'); // a Thursday

afterEach(() => vi.restoreAllMocks());

describe('push notifications (SPEC §8.2)', () => {
  it('hands out one sender key, kept for good', async () => {
    const s = await setup();
    const a = (await s.api('GET', '/push/key')).json.publicKey as string;
    const b = (await s.api('GET', '/push/key')).json.publicKey as string;
    expect(a).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(b).toBe(a);
  });

  it('only takes https endpoints', async () => {
    const s = await setup();
    const d = await device('http://push.example/x');
    expect((await s.api('POST', '/push/subscriptions', d)).status).toBe(400);
  });

  it('starts a new device from now, then tells each new thing once', async () => {
    const s = await setup();
    await s.api('PATCH', '/me/settings', { push: { duplicate: true } });
    await s.add('2026-10-05', 4_250, 'CORNER GARAGE');
    await s.add('2026-10-06', 4_250, 'CORNER GARAGE');
    await refreshRecurring(env.DB, s.userId, '2026-10-08');
    // Already flagged before the device signed up: not pushed.
    expect((await s.api('POST', '/push/subscriptions', await device())).status).toBe(204);
    const service = pushService();
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 0, notices: 0 });

    await s.add('2026-10-07', 9_900, 'HARDWARE BARN');
    await s.add('2026-10-07', 9_900, 'HARDWARE BARN');
    await refreshRecurring(env.DB, s.userId, '2026-10-08');
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 1, notices: 1 });
    const [url, init] = service.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://push.example/device-1');
    expect((init.headers as Record<string, string>)['Content-Encoding']).toBe('aes128gcm');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^vapid t=.+, k=/);
    // The next run has nothing new.
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 0, notices: 0 });
  });

  it('skips the kinds the owner turned off', async () => {
    const s = await setup();
    await s.api('POST', '/push/subscriptions', await device());
    pushService();
    // Duplicates are off by default.
    await s.add('2026-10-07', 9_900, 'HARDWARE BARN');
    await s.add('2026-10-07', 9_900, 'HARDWARE BARN');
    await refreshRecurring(env.DB, s.userId, '2026-10-08');
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 0, notices: 0 });
  });

  it('never pushes a kind hidden in the app', async () => {
    const s = await setup();
    await s.api('PATCH', '/me/settings', {
      push: { duplicate: true },
      alerts: {
        priceUp: true,
        doubleCharge: true,
        duplicate: false,
        unusual: true,
        firstTime: true,
      },
    });
    await s.api('POST', '/push/subscriptions', await device());
    pushService();
    await s.add('2026-10-07', 9_900, 'HARDWARE BARN');
    await s.add('2026-10-07', 9_900, 'HARDWARE BARN');
    await refreshRecurring(env.DB, s.userId, '2026-10-08');
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 0, notices: 0 });
  });

  it('tells a Surplus dip once, and again only after it recovers', async () => {
    const s = await setup();
    await s.api('POST', '/accounts', { name: 'Checking', kind: 'depository' });
    await s.api('PATCH', '/me/settings', { push: { surplusNegative: true }, cushionCents: 0 });
    await s.api('POST', '/push/subscriptions', await device());
    pushService();
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 0, notices: 0 });
    await s.api('PATCH', '/me/settings', { cushionCents: 50_000 });
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 1, notices: 1 });
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 0, notices: 0 });
    await s.api('PATCH', '/me/settings', { cushionCents: 0 });
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 0, notices: 0 });
    await s.api('PATCH', '/me/settings', { cushionCents: 50_000 });
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 1, notices: 1 });
  });

  it('sends one review count per sync that brought in rows, never per transaction, none at zero', async () => {
    const s = await setup();
    await s.api('PATCH', '/me/settings', { push: { toReview: true } });
    await s.api('POST', '/push/subscriptions', await device());
    pushService();
    expect(await runPush(s.userId, env.DB, NOW, 'run-0')).toEqual({ sent: 0, notices: 0 });
    for (const d of ['2026-10-06', '2026-10-07', '2026-10-07']) await s.add(d, 1_000, `SHOP ${d}`);
    await env.DB.prepare("UPDATE txn SET review_state = 'needs_review' WHERE user_id = ?1")
      .bind(s.userId)
      .run();
    // A run with nothing new says nothing, even with items waiting.
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 0, notices: 0 });
    expect(await runPush(s.userId, env.DB, NOW, 'run-1')).toEqual({ sent: 1, notices: 1 });
    expect(await runPush(s.userId, env.DB, NOW, 'run-1')).toEqual({ sent: 0, notices: 0 });
    expect(await runPush(s.userId, env.DB, NOW, 'run-2')).toEqual({ sent: 1, notices: 1 });
  });

  it('sends nothing, and reads nothing more, with no device signed up', async () => {
    const s = await setup();
    const service = pushService();
    expect(await runPush(s.userId, env.DB, NOW)).toEqual({ sent: 0, notices: 0 });
    expect(service).not.toHaveBeenCalled();
  });

  it('drops a device the browser unsubscribed', async () => {
    const s = await setup();
    await s.api('POST', '/push/subscriptions', await device());
    pushService(410);
    expect((await s.api('POST', '/push/test')).status).toBe(409);
    const { results } = await env.DB.prepare('SELECT id FROM push_subscription WHERE user_id = ?1')
      .bind(s.userId)
      .all();
    expect(results).toHaveLength(0);
  });

  it('sends a test, and a device can sign itself off', async () => {
    const s = await setup();
    const d = await device();
    await s.api('POST', '/push/subscriptions', d);
    await s.api('POST', '/push/subscriptions', d); // the same device again: still one
    pushService();
    expect((await s.api('POST', '/push/test')).json).toEqual({ sent: 1 });
    expect((await s.api('DELETE', '/push/subscriptions', { endpoint: d.endpoint })).status).toBe(
      204,
    );
    expect((await s.api('POST', '/push/test')).status).toBe(409);
  });

  it('tells a bank needing a look once, and the Sunday recap', async () => {
    const s = await setup();
    await s.api('POST', '/push/subscriptions', await device());
    const service = pushService();
    await env.DB.prepare(
      `INSERT INTO sync_run (id, user_id, started_at, finished_at, status, accounts_touched,
         rows_inserted, rows_updated, error_json)
       VALUES ('run-1', ?1, '2026-10-11T12:00:00Z', '2026-10-11T12:00:05Z', 'partial', 1, 0, 0, ?2)`,
    )
      .bind(s.userId, JSON.stringify([{ accountId: null, message: 'Made-up Bank: auth required' }]))
      .run();
    await s.add('2026-10-06', 2_000, 'CORNER CAFE');
    const sunday = new Date('2026-10-11T15:00:00Z');
    expect(await runPush(s.userId, env.DB, sunday)).toEqual({ sent: 2, notices: 2 });
    expect(service).toHaveBeenCalledTimes(2);
    expect(await runPush(s.userId, env.DB, sunday)).toEqual({ sent: 0, notices: 0 });
  });
});
