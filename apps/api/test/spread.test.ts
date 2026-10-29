import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Home', kind: 'expense' })).json;
  const insurance = (await api('POST', '/categories', { groupId: group.id, name: 'Insurance' }))
    .json;
  const repairs = (await api('POST', '/categories', { groupId: group.id, name: 'Repairs' })).json;
  const checking = (await api('POST', '/accounts', { name: 'Checking', kind: 'depository' })).json;
  const add = async (postedAt: string, amountCents: number, categoryId: string) =>
    (
      await api('POST', '/transactions', {
        accountId: checking.id,
        postedAt,
        amountCents,
        descriptor: 'ACME INSURANCE',
        categoryId,
      })
    ).json;
  const spent = async (period: string, categoryId: string) =>
    ((await api('GET', `/periods/${period}`)).json.categories.find(
      (c: { categoryId: string }) => c.categoryId === categoryId,
    )?.spentCents ?? 0) as number;
  return { ...u, api, insurance, repairs, checking, add, spent };
}

describe('spread one charge across months (SPEC §3.6)', () => {
  it('draws an equal part each month, odd cents in the first', async () => {
    const s = await setup();
    const t = await s.add('2026-11-15', 120_001, s.insurance.id);
    const r = await s.api('POST', `/transactions/${t.id}/spread`, { months: 12 });
    expect(r.status).toBe(200);
    expect(r.json.splits).toHaveLength(12);
    expect(r.json.splits[0]).toMatchObject({ amountCents: 10_001, periodId: '2026-11' });
    expect(r.json.splits[11]).toMatchObject({ amountCents: 10_000, periodId: '2027-10' });
    expect(await s.spent('2026-11', s.insurance.id)).toBe(10_001);
    expect(await s.spent('2027-03', s.insurance.id)).toBe(10_000);

    // The category's list for a later month shows the charge it draws on.
    const later = await s.api('GET', `/transactions?category=${s.insurance.id}&period=2027-03`);
    expect(later.json.items.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect(
      (await s.api('GET', `/transactions?category=${s.repairs.id}&period=2027-03`)).json.items,
    ).toEqual([]);
  });

  it('keeps its months through a new category and a new date, and undoes with 1', async () => {
    const s = await setup();
    const t = await s.add('2026-10-20', 30_000, s.insurance.id);
    await s.api('POST', `/transactions/${t.id}/spread`, { months: 3 });

    await s.api('PATCH', `/transactions/${t.id}`, { categoryId: s.repairs.id });
    expect(await s.spent('2026-12', s.insurance.id)).toBe(0);
    expect(await s.spent('2026-12', s.repairs.id)).toBe(10_000);

    await s.api('PATCH', `/transactions/${t.id}`, { postedAt: '2026-11-02' });
    expect(await s.spent('2026-10', s.repairs.id)).toBe(0);
    expect(await s.spent('2027-01', s.repairs.id)).toBe(10_000);

    const back = await s.api('POST', `/transactions/${t.id}/spread`, { months: 1 });
    expect(back.json.splits).toMatchObject([{ amountCents: 30_000, periodId: '2026-11' }]);
    expect(await s.spent('2026-11', s.repairs.id)).toBe(30_000);
    expect(await s.spent('2027-01', s.repairs.id)).toBe(0);
  });

  it('a category split, a transfer or a bad month count is refused', async () => {
    const s = await setup();
    const t = await s.add('2026-10-20', 30_000, s.insurance.id);
    await s.api('POST', `/transactions/${t.id}/splits`, {
      splits: [
        { categoryId: s.insurance.id, amountCents: 20_000 },
        { categoryId: s.repairs.id, amountCents: 10_000 },
      ],
    });
    expect((await s.api('POST', `/transactions/${t.id}/spread`, { months: 3 })).status).toBe(409);
    expect((await s.api('POST', `/transactions/${t.id}/spread`, { months: 13 })).status).toBe(400);
    expect((await s.api('POST', '/transactions/nope/spread', { months: 3 })).status).toBe(404);
  });

  it('marking a spread charge as a transfer puts it back in one month', async () => {
    const s = await setup();
    const t = await s.add('2026-10-20', 30_000, s.insurance.id);
    await s.api('POST', `/transactions/${t.id}/spread`, { months: 3 });
    await s.api('POST', `/transactions/${t.id}/mark-transfer`);
    const after = (await s.api('GET', `/transactions/${t.id}`)).json;
    expect(after.splits).toMatchObject([{ amountCents: 30_000, periodId: '2026-10' }]);
    expect(await s.spent('2026-12', s.insurance.id)).toBe(0);
    expect((await s.api('POST', `/transactions/${t.id}/spread`, { months: 3 })).status).toBe(409);
  });

  it('deleting a spread charge clears every month', async () => {
    const s = await setup();
    const t = await s.add('2026-10-20', 30_000, s.insurance.id);
    await s.api('POST', `/transactions/${t.id}/spread`, { months: 3 });
    expect((await s.api('DELETE', `/transactions/${t.id}`)).status).toBe(204);
    expect(await s.spent('2026-12', s.insurance.id)).toBe(0);
  });
});
