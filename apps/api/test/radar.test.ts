import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { refreshRecurring } from '../src/lib/recurring';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Fun', kind: 'expense' })).json;
  const tv = (await api('POST', '/categories', { groupId: group.id, name: 'Streaming' })).json;
  const card = (await api('POST', '/accounts', { name: 'Card', kind: 'credit' })).json;
  const add = async (
    postedAt: string,
    amountCents: number,
    descriptor: string,
    categoryId?: string,
  ) =>
    (
      await api('POST', '/transactions', {
        accountId: card.id,
        postedAt,
        amountCents,
        descriptor,
        categoryId,
      })
    ).json as { id: string };
  return { ...u, api, tv, add };
}

describe('subscription radar (SPEC §7.1)', () => {
  it('records a price that went up and a charge twice in one cycle', async () => {
    const s = await setup();
    await s.add('2026-06-03', 1_599, 'STREAMFLIX', s.tv.id);
    await s.add('2026-07-03', 1_599, 'STREAMFLIX', s.tv.id);
    await s.add('2026-08-03', 1_599, 'STREAMFLIX', s.tv.id);
    await refreshRecurring(env.DB, s.userId, '2026-08-20');
    // The price goes up, and the new price lands twice: neither fits the series any more.
    await s.add('2026-09-03', 1_799, 'STREAMFLIX', s.tv.id);
    await s.add('2026-09-05', 1_799, 'STREAMFLIX', s.tv.id);
    await refreshRecurring(env.DB, s.userId, '2026-09-20');
    const [row] = (await s.api('GET', '/recurring')).json;
    expect(row).toMatchObject({
      previousAmountCents: 1_599,
      priceChangedOn: '2026-09-03',
      doubleChargedOn: '2026-09-05',
    });
    // Two months on, both have aged off.
    await refreshRecurring(env.DB, s.userId, '2026-11-20');
    expect((await s.api('GET', '/recurring')).json[0]).toMatchObject({
      priceChangedOn: null,
      doubleChargedOn: null,
    });
  });
});

describe('quiet charge flags (SPEC §8.1)', () => {
  it('flags a likely duplicate once, and "Looks fine" clears it for good', async () => {
    const s = await setup();
    await s.add('2026-10-05', 4_250, 'CORNER GARAGE');
    const second = await s.add('2026-10-06', 4_250, 'CORNER GARAGE');
    await refreshRecurring(env.DB, s.userId, '2026-10-08');
    expect((await s.api('GET', `/transactions/${second.id}`)).json.flag).toBe('duplicate');

    const cleared = await s.api('PATCH', `/transactions/${second.id}`, { clearFlag: true });
    expect(cleared.json.flag).toBeNull();
    await refreshRecurring(env.DB, s.userId, '2026-10-08');
    expect((await s.api('GET', `/transactions/${second.id}`)).json.flag).toBeNull();
  });

  it('flags a large first charge at a new merchant', async () => {
    const s = await setup();
    const t = await s.add('2026-10-06', 48_000, 'NEW FURNITURE CO');
    await refreshRecurring(env.DB, s.userId, '2026-10-08');
    expect((await s.api('GET', `/transactions/${t.id}`)).json.flag).toBe('first_time');
  });

  it('alert choices save in settings', async () => {
    const s = await setup();
    const res = await s.api('PATCH', '/me/settings', {
      alerts: {
        priceUp: false,
        doubleCharge: true,
        duplicate: true,
        unusual: false,
        firstTime: true,
      },
    });
    expect(res.status).toBe(200);
    expect((await s.api('GET', '/me')).json.settings.alerts).toMatchObject({
      priceUp: false,
      unusual: false,
    });
  });
});
