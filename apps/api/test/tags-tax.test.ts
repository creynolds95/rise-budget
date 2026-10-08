import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const daycare = (await api('POST', '/categories', { groupId: group.id, name: 'Daycare' })).json;
  const food = (await api('POST', '/categories', { groupId: group.id, name: 'Food' })).json;
  const checking = (await api('POST', '/accounts', { name: 'Checking', kind: 'depository' })).json;
  const add = async (
    postedAt: string,
    amountCents: number,
    descriptor: string,
    categoryId?: string,
  ) =>
    (
      await api('POST', '/transactions', {
        accountId: checking.id,
        postedAt,
        amountCents,
        descriptor,
        categoryId,
      })
    ).json;
  return { ...u, api, daycare, food, checking, add };
}

describe('running totals', () => {
  it('sums what the filter matches, money out and in, leaving transfers out', async () => {
    const s = await setup();
    await s.add('2026-09-02', 4_000, 'TARGET 123', s.food.id);
    await s.add('2026-09-03', 6_000, 'TARGET 456', s.food.id);
    await s.add('2026-09-04', -1_500, 'TARGET REFUND', s.food.id);
    await s.add('2026-09-05', 9_999, 'COSTCO', s.food.id);
    const t = await s.api('GET', '/transactions/totals?q=target');
    expect(t.json).toEqual({ outCents: 10_000, inCents: 1_500, count: 3 });
    const none = await s.api('GET', '/transactions/totals?q=nothing-here');
    expect(none.json).toEqual({ outCents: 0, inCents: 0, count: 0 });
  });
});

describe('tags', () => {
  it('labels transactions, filters by tag, and totals per tag', async () => {
    const s = await setup();
    const trip = (await s.api('POST', '/tags', { name: 'Beach trip' })).json;
    expect(trip).toMatchObject({ name: 'Beach trip', taxKind: null });
    expect((await s.api('POST', '/tags', { name: 'beach trip' })).status).toBe(409);
    const a = await s.add('2026-09-02', 4_000, 'GAS STATION', s.food.id);
    const b = await s.add('2026-09-03', 12_000, 'HOTEL', s.food.id);
    await s.add('2026-09-04', 3_000, 'GROCER', s.food.id);
    const tagged = await s.api('PUT', `/transactions/${a.id}/tags`, { tagIds: [trip.id, trip.id] });
    expect(tagged.json.tagIds).toEqual([trip.id]);
    await s.api('PUT', `/transactions/${b.id}/tags`, { tagIds: [trip.id] });

    const list = await s.api('GET', `/transactions?tag=${trip.id}`);
    expect(list.json.items.map((t: { id: string }) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(list.json.items[0].tagIds).toEqual([trip.id]);
    expect((await s.api('GET', '/tags')).json).toEqual([
      { id: trip.id, name: 'Beach trip', taxKind: null, count: 2, netCents: 16_000 },
    ]);

    expect((await s.api('PUT', `/transactions/${a.id}/tags`, { tagIds: ['nope'] })).status).toBe(
      400,
    );
    // Deleting the transaction drops its labels with it.
    expect((await s.api('DELETE', `/transactions/${a.id}`)).status).toBe(204);
    expect((await s.api('GET', '/tags')).json[0]).toMatchObject({ count: 1 });
    // Deleting the tag leaves the transaction alone.
    expect((await s.api('DELETE', `/tags/${trip.id}`)).status).toBe(204);
    expect((await s.api('GET', `/transactions/${b.id}`)).json).toMatchObject({
      amountCents: 12_000,
      tagIds: [],
    });
  });

  it('renames and sets a tax heading', async () => {
    const s = await setup();
    const t = (await s.api('POST', '/tags', { name: 'Gig' })).json;
    const p = await s.api('PATCH', `/tags/${t.id}`, { name: 'Side gig', taxKind: 'income_1099' });
    expect(p.json).toMatchObject({ name: 'Side gig', taxKind: 'income_1099' });
    expect((await s.api('PATCH', '/tags/missing', { name: 'x' })).status).toBe(404);
    expect((await s.api('DELETE', '/tags/missing')).status).toBe(404);
  });
});

describe('tax pack', () => {
  it('collects the year from tax-marked categories and tags, once each', async () => {
    const s = await setup();
    await s.api('PATCH', `/categories/${s.daycare.id}`, { taxKind: 'dependent_care' });
    const gig = (await s.api('POST', '/tags', { name: 'Side gig', taxKind: 'income_1099' })).json;
    const care = (await s.api('POST', '/tags', { name: 'Care', taxKind: 'dependent_care' })).json;
    const d = await s.add('2026-03-02', 30_000, 'RIVERSIDE DAYCARE', s.daycare.id);
    await s.add('2025-12-30', 30_000, 'RIVERSIDE DAYCARE', s.daycare.id);
    const pay = await s.add('2026-04-01', -50_000, 'ZELLE FROM CLIENT', s.food.id);
    await s.api('PUT', `/transactions/${pay.id}/tags`, { tagIds: [gig.id] });
    await s.api('PUT', `/transactions/${d.id}/tags`, { tagIds: [care.id] });

    const res = await s.api('GET', '/reports/tax?year=2026');
    expect(res.json.lines).toEqual([
      expect.objectContaining({
        txnId: d.id,
        kind: 'dependent_care',
        source: 'Daycare',
        amountCents: 30_000,
      }),
      expect.objectContaining({
        txnId: pay.id,
        kind: 'income_1099',
        source: 'Side gig',
        amountCents: -50_000,
      }),
    ]);
    expect((await s.api('GET', '/reports/tax')).status).toBe(400);
  });
});
