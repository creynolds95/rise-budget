import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  await api('PATCH', '/periods/2026-09', { expectedIncomeCents: 500_000 });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const home = (await api('POST', '/categories', { groupId: group.id, name: 'Home' })).json;
  const kids = (await api('POST', '/categories', { groupId: group.id, name: 'Kids' })).json;
  const card = (await api('POST', '/accounts', { name: 'Apple Card', kind: 'credit' })).json;
  const add = (
    postedAt: string,
    amountCents: number,
    descriptor = 'AMZN Mktp US*2K1AB3CD4',
    categoryId?: string,
  ) =>
    api('POST', '/transactions', {
      accountId: card.id,
      postedAt,
      amountCents,
      descriptor,
      categoryId,
    });
  return { ...u, api, home, kids, card, add };
}

const spentIn = async (s: Awaited<ReturnType<typeof setup>>, period: string, categoryId: string) =>
  (await s.api('GET', `/periods/${period}`)).json.categories.find(
    (c: { categoryId: string }) => c.categoryId === categoryId,
  ).spentCents;

describe('T21 transactions & splits', () => {
  it('manual entry normalises the merchant; a category with no signal still gets one (H1)', async () => {
    const s = await setup();
    const t = await s.add('2026-09-05', 4_599);
    expect(t.status).toBe(201);
    expect(t.json).toMatchObject({
      merchantNormalized: 'Amazon Marketplace',
      // No rule, memory, or recurring match for this merchant — falls back to the catch-all,
      // but it's never left categoryless, and it counts as real spending right away.
      reviewState: 'needs_review',
      splits: [{ amountCents: 4_599 }],
    });
    const other = (await s.api('GET', '/category-groups')).json.find(
      (g: { name: string }) => g.name === 'Other',
    );
    expect(other).toBeTruthy();
    expect(await spentIn(s, '2026-09', s.home.id)).toBe(0);
  });

  it('picking a category by hand on manual entry is reviewed on the spot', async () => {
    const s = await setup();
    const t = await s.add('2026-09-05', 4_599, undefined, s.home.id);
    expect(t.json).toMatchObject({
      reviewState: 'reviewed',
      splits: [{ categoryId: s.home.id, amountCents: 4_599 }],
    });
    expect(await spentIn(s, '2026-09', s.home.id)).toBe(4_599);
  });

  it('setting a category is one implicit split of the whole amount', async () => {
    const s = await setup();
    const t = await s.add('2026-09-05', 4_599);
    const res = await s.api('PATCH', `/transactions/${t.json.id}`, {
      categoryId: s.home.id,
      notes: 'filters',
    });
    expect(res.json.splits).toMatchObject([
      { categoryId: s.home.id, amountCents: 4_599, periodId: '2026-09' },
    ]);
    expect(res.json.notes).toBe('filters');
    expect(await spentIn(s, '2026-09', s.home.id)).toBe(4_599);
  });

  it('splits must sum exactly to the parent (edge 11)', async () => {
    const s = await setup();
    const t = await s.add('2026-09-05', 10_000);
    const bad = await s.api('POST', `/transactions/${t.json.id}/splits`, {
      splits: [
        { categoryId: s.home.id, amountCents: 6_000 },
        { categoryId: s.kids.id, amountCents: 3_999 },
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.json.error).toMatchObject({
      code: 'SPLITS_DO_NOT_SUM',
      detail: { expectedCents: 10_000, actualCents: 9_999 },
    });
    // Rejected — the original auto-guess split (H1) is untouched, not wiped.
    expect((await s.api('GET', `/transactions/${t.json.id}`)).json.splits).toMatchObject([
      { amountCents: 10_000 },
    ]);

    const ok = await s.api('POST', `/transactions/${t.json.id}/splits`, {
      splits: [
        { categoryId: s.home.id, amountCents: 6_000 },
        { categoryId: s.kids.id, amountCents: 4_000 },
      ],
    });
    expect(ok.status).toBe(200);
    expect(await spentIn(s, '2026-09', s.home.id)).toBe(6_000);
    expect(await spentIn(s, '2026-09', s.kids.id)).toBe(4_000);
  });

  it('a split into a closed month flags it and recalculates nothing (edge 5)', async () => {
    const s = await setup();
    await s.api('PATCH', '/periods/2026-08', { expectedIncomeCents: 100_000 });
    await s.api('PATCH', `/allocations/2026-08:${s.home.id}`, { plannedCents: 20_000 });
    await s.api('POST', '/periods/2026-08/close', {});
    const carryBefore = (await s.api('GET', '/periods/2026-09')).json.categories.find(
      (c: { categoryId: string }) => c.categoryId === s.home.id,
    ).carriedInCents;

    const late = await s.add('2026-08-29', 41_230);
    await s.api('PATCH', `/transactions/${late.json.id}`, { categoryId: s.home.id });

    const aug = (await s.api('GET', '/periods/2026-08')).json.period;
    expect(aug).toMatchObject({ status: 'closed', needsRecalc: true, recalcDeltaCents: 41_230 });
    const carryAfter = (await s.api('GET', '/periods/2026-09')).json.categories.find(
      (c: { categoryId: string }) => c.categoryId === s.home.id,
    ).carriedInCents;
    expect(carryAfter).toBe(carryBefore);
  });

  it('paginates newest first with a stable cursor and filters', async () => {
    const s = await setup();
    for (let d = 1; d <= 55; d++) {
      await s.add(
        `2026-0${d <= 28 ? 8 : 9}-${String(((d - 1) % 28) + 1).padStart(2, '0')}`,
        100 + d,
        `SHOP ${d}`,
      );
    }
    const p1 = await s.api('GET', '/transactions');
    expect(p1.json.items).toHaveLength(50);
    expect(p1.json.nextCursor).toBeTruthy();
    const p2 = await s.api('GET', `/transactions?cursor=${p1.json.nextCursor}`);
    expect(p2.json.items).toHaveLength(5);
    expect(p2.json.nextCursor).toBeNull();
    const ids = new Set([...p1.json.items, ...p2.json.items].map((t: { id: string }) => t.id));
    expect(ids.size).toBe(55);
    const dates = p1.json.items.map((t: { postedAt: string }) => t.postedAt);
    expect([...dates].sort().reverse()).toEqual(dates);

    const sept = await s.api('GET', '/transactions?from=2026-09-01&to=2026-09-30');
    expect(
      sept.json.items.every((t: { postedAt: string }) => t.postedAt.startsWith('2026-09')),
    ).toBe(true);
    expect((await s.api('GET', '/transactions?q=shop%2012')).json.items[0].descriptorRaw).toBe(
      'SHOP 12',
    );
    expect((await s.api('GET', '/transactions?q=100%25')).json.items).toEqual([]);
    expect((await s.api('GET', '/transactions?cursor=***')).status).toBe(400);
  });

  it('filters by category through splits', async () => {
    const s = await setup();
    await s.add('2026-09-02', 500, 'A', s.home.id);
    await s.add('2026-09-03', 700, 'B', s.kids.id);
    const res = await s.api('GET', `/transactions?category=${s.kids.id}`);
    expect(res.json.items.map((t: { descriptorRaw: string }) => t.descriptorRaw)).toEqual(['B']);
  });

  it('filters by several categories and accounts at once', async () => {
    const s = await setup();
    const cash = (await s.api('POST', '/accounts', { name: 'Cash', kind: 'depository' })).json;
    await s.add('2026-09-02', 500, 'A', s.home.id);
    await s.add('2026-09-03', 700, 'B', s.kids.id);
    await s.add('2026-09-04', 900, 'C');
    await s.api('POST', '/transactions', {
      accountId: cash.id,
      postedAt: '2026-09-05',
      amountCents: 300,
      descriptor: 'D',
    });
    const both = await s.api('GET', `/transactions?category=${s.home.id},${s.kids.id}`);
    expect(both.json.items.map((t: { descriptorRaw: string }) => t.descriptorRaw)).toEqual([
      'B',
      'A',
    ]);
    const acct = await s.api('GET', `/transactions?account=${cash.id}`);
    expect(acct.json.items.map((t: { descriptorRaw: string }) => t.descriptorRaw)).toEqual(['D']);
    expect((await s.api('GET', '/transactions?account=,')).status).toBe(400);
  });

  it('filters by direction and amount size', async () => {
    const s = await setup();
    await s.add('2026-09-02', 500, 'small');
    await s.add('2026-09-03', 12_000, 'big');
    await s.add('2026-09-04', -250_000, 'paycheck');
    const names = async (qs: string) =>
      (await s.api('GET', `/transactions?${qs}`)).json.items.map(
        (t: { descriptorRaw: string }) => t.descriptorRaw,
      );
    expect(await names('direction=in')).toEqual(['paycheck']);
    expect(await names('direction=out')).toEqual(['big', 'small']);
    expect(await names('min=1000&max=200000')).toEqual(['big']);
    expect(await names('min=100000')).toEqual(['paycheck']);
  });

  it('sorts by amount with a cursor that neither skips nor repeats', async () => {
    const s = await setup();
    // Ties on amount make the id tiebreak do real work across the page boundary.
    for (let i = 0; i < 60; i++) await s.add('2026-09-10', 100 * (i % 7) + 100, `T${i}`);
    const p1 = await s.api('GET', '/transactions?sort=amount_desc');
    const p2 = await s.api('GET', `/transactions?sort=amount_desc&cursor=${p1.json.nextCursor}`);
    const all = [...p1.json.items, ...p2.json.items] as { id: string; amountCents: number }[];
    expect(new Set(all.map((t) => t.id)).size).toBe(60);
    const amounts = all.map((t) => t.amountCents);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    const asc = (await s.api('GET', '/transactions?sort=amount_asc')).json.items as {
      amountCents: number;
    }[];
    expect(asc[0]?.amountCents).toBe(100);
    const old = (await s.api('GET', '/transactions?sort=date_asc')).json.items as {
      postedAt: string;
    }[];
    expect(old[0]?.postedAt).toBe('2026-09-10');
    expect((await s.api('GET', '/transactions?sort=sideways')).status).toBe(400);
  });

  it('rejects unknown or foreign categories and accounts; users cannot see each other', async () => {
    const a = await setup();
    const b = await setup();
    const t = await a.add('2026-09-05', 1_000);
    expect(
      (await a.api('PATCH', `/transactions/${t.json.id}`, { categoryId: b.home.id })).status,
    ).toBe(400);
    expect((await b.api('GET', `/transactions/${t.json.id}`)).status).toBe(404);
    expect(
      (
        await b.api('POST', '/transactions', {
          accountId: a.card.id,
          postedAt: '2026-09-01',
          amountCents: 1,
          descriptor: 'x',
        })
      ).status,
    ).toBe(400);
    expect((await b.api('GET', '/transactions')).json.items).toEqual([]);
    expect(
      (await a.api('PATCH', `/transactions/${t.json.id}`, { reviewState: 'dropped' })).status,
    ).toBe(400);
  });

  it('transfers never count toward spent', async () => {
    const s = await setup();
    const pay = await s.add('2026-09-10', 8_450, 'APPLECARD GSBANK PAYMENT', s.home.id);
    await env.DB.prepare('UPDATE txn SET is_transfer = 1 WHERE user_id = ?1 AND id = ?2')
      .bind(s.userId, pay.json.id)
      .run();
    expect(await spentIn(s, '2026-09', s.home.id)).toBe(0);
  });
});
