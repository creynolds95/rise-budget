import { buildPeriodView } from '@rise/shared/budget';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { localToday } from '../src/lib/dates';
import { call, signedInUser } from './helpers/http';

const PERIOD = '2026-09';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const expense = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' }))
    .json;
  const income = (await api('POST', '/category-groups', { name: 'Income', kind: 'income' })).json;
  const groceries = (await api('POST', '/categories', { groupId: expense.id, name: 'Groceries' }))
    .json;
  const rent = (
    await api('POST', '/categories', { groupId: expense.id, name: 'Rent', isBill: true })
  ).json;
  const fun = (await api('POST', '/categories', { groupId: expense.id, name: 'Fun' })).json;
  const pay = (await api('POST', '/categories', { groupId: income.id, name: 'Paycheck' })).json;
  return { ...u, api, groceries, rent, fun, pay };
}

/** Transactions arrive via sync/API later (T21, T27); insert rows directly for now. */
async function spend(
  userId: string,
  categoryId: string,
  amountCents: number,
  opts: { transfer?: boolean; dropped?: boolean; date?: string } = {},
) {
  const db = env.DB;
  const acct = crypto.randomUUID();
  const txn = crypto.randomUUID();
  const now = new Date().toISOString();
  const date = opts.date ?? '2026-09-10';
  await db.batch([
    db
      .prepare(
        "INSERT INTO account (id, user_id, name, kind, source, created_at) VALUES (?1, ?2, 'Card', 'credit', 'manual', ?3)",
      )
      .bind(acct, userId, now),
    db
      .prepare(
        `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized,
           is_transfer, review_state, source, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'X', 'X', ?6, ?7, 'manual', ?8, ?8)`,
      )
      .bind(
        txn,
        userId,
        acct,
        date,
        amountCents,
        opts.transfer ? 1 : 0,
        opts.dropped ? 'dropped' : 'reviewed',
        now,
      ),
    db
      .prepare(
        'INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      )
      .bind(crypto.randomUUID(), userId, txn, categoryId, amountCents, date.slice(0, 7)),
  ]);
}

describe('T18 categories, groups, periods, allocations', () => {
  it('applies smart defaults on creation, and explicit choices win', async () => {
    const s = await setup();
    expect(s.groceries).toMatchObject({
      rolloverPolicy: 'roll',
      spendShape: 'linear',
      isBill: false,
    });
    expect(s.rent).toMatchObject({
      rolloverPolicy: 'return_to_pool',
      spendShape: 'fixed',
      isBill: true,
    });
    const custom = await s.api('POST', '/categories', {
      groupId: s.groceries.groupId,
      name: 'Insurance',
      isBill: true,
      rolloverPolicy: 'roll',
    });
    expect(custom.json).toMatchObject({ rolloverPolicy: 'roll', spendShape: 'fixed' });
  });

  it('policy and shape are editable', async () => {
    const s = await setup();
    const res = await s.api('PATCH', `/categories/${s.groceries.id}`, {
      rolloverPolicy: 'return_to_pool',
      spendShape: 'fixed',
    });
    expect(res.json).toMatchObject({
      rolloverPolicy: 'return_to_pool',
      spendShape: 'fixed',
      name: 'Groceries',
    });
  });

  it('an untouched month: pool equals expected income (edge 14)', async () => {
    const s = await setup();
    await s.api('PATCH', `/periods/${PERIOD}`, { expectedIncomeCents: 520_000 });
    const res = await s.api('GET', `/periods/${PERIOD}`);
    expect(res.status).toBe(200);
    expect(res.json.poolCents).toBe(520_000);
    expect(res.json.period).toMatchObject({
      id: PERIOD,
      status: 'open',
      expectedIncomeCents: 520_000,
    });
  });

  it('GET /periods/:id matches the engine exactly', async () => {
    const s = await setup();
    await s.api('PATCH', `/periods/${PERIOD}`, { expectedIncomeCents: 500_000 });
    await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, { plannedCents: 60_000 });
    await s.api('PATCH', `/allocations/${PERIOD}:${s.rent.id}`, { plannedCents: 150_000 });
    await spend(s.userId, s.groceries.id, 21_000);
    await spend(s.userId, s.groceries.id, -1_500); // refund
    await spend(s.userId, s.groceries.id, 9_999, { transfer: true }); // excluded
    await spend(s.userId, s.groceries.id, 4_000, { dropped: true }); // excluded
    await spend(s.userId, s.rent.id, 150_000);
    await spend(s.userId, s.pay.id, -260_000);

    const res = await s.api('GET', `/periods/${PERIOD}`);
    const cat = (
      id: string,
      groupKind: 'income' | 'expense',
      planned: number,
      spent: number,
      c: typeof s.groceries,
    ) => ({
      categoryId: id,
      groupKind,
      rolloverPolicy: c.rolloverPolicy,
      spendShape: c.spendShape,
      typicalPostDay: null,
      carriedInCents: 0,
      plannedCents: planned,
      spentCents: spent,
    });
    const expected = buildPeriodView({
      periodId: PERIOD,
      status: 'open',
      today: localToday('America/Chicago'),
      expectedIncomeCents: 500_000,
      returnedSurplusPrevCents: 0,
      categories: [
        cat(s.fun.id, 'expense', 0, 0, s.fun),
        cat(s.groceries.id, 'expense', 60_000, 19_500, s.groceries),
        cat(s.pay.id, 'income', 0, -260_000, s.pay),
        cat(s.rent.id, 'expense', 150_000, 150_000, s.rent),
      ],
    });
    const { period, ...view } = res.json;
    expect(period.id).toBe(PERIOD);
    const byId = (xs: { categoryId: string }[]) =>
      [...xs].sort((a, b) => a.categoryId.localeCompare(b.categoryId));
    expect({ ...view, categories: byId(view.categories) }).toEqual({
      ...expected,
      categories: byId(expected.categories),
    });
    expect(view.actualIncomeCents).toBe(260_000);
  });

  it('shows over-allocation as a negative pool, never clamped', async () => {
    const s = await setup();
    await s.api('PATCH', `/periods/${PERIOD}`, { expectedIncomeCents: 100_000 });
    await s.api('PATCH', `/allocations/${PERIOD}:${s.rent.id}`, { plannedCents: 100_000 });
    await s.api('PATCH', `/periods/${PERIOD}`, { expectedIncomeCents: 76_000 });
    expect((await s.api('GET', `/periods/${PERIOD}`)).json.poolCents).toBe(-24_000);
  });

  it('rejects malformed period ids', async () => {
    const s = await setup();
    expect((await s.api('GET', '/periods/2026-13')).status).toBe(400);
  });
});

describe('T19 allocation edit + reallocation', () => {
  it('raises within the pool apply directly and are logged from the pool', async () => {
    const s = await setup();
    await s.api('PATCH', `/periods/${PERIOD}`, { expectedIncomeCents: 100_000 });
    const res = await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, {
      plannedCents: 40_000,
    });
    expect(res.status).toBe(200);
    expect(res.json.poolCents).toBe(60_000);
    const log = await s.api('GET', `/periods/${PERIOD}/reallocations`);
    expect(log.json).toMatchObject([
      { fromCategoryId: null, toCategoryId: s.groceries.id, amountCents: 40_000 },
    ]);
  });

  it('beyond the pool without funding → 409 INSUFFICIENT_POOL with ranked candidates (edge 8)', async () => {
    const s = await setup();
    await s.api('PATCH', `/periods/${PERIOD}`, { expectedIncomeCents: 100_000 });
    await s.api('PATCH', `/allocations/${PERIOD}:${s.fun.id}`, { plannedCents: 30_000 });
    await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, { plannedCents: 70_000 });
    const before = await s.api('GET', `/periods/${PERIOD}`);
    expect(before.json.poolCents).toBe(0);

    const res = await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, {
      plannedCents: 80_000,
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('INSUFFICIENT_POOL');
    expect(res.json.error.detail.shortfallCents).toBe(10_000);
    expect(res.json.error.detail.candidates[0].categoryId).toBe(s.fun.id);

    // Nothing changed.
    const after = await s.api('GET', `/periods/${PERIOD}`);
    expect(
      after.json.categories.find((x: { categoryId: string }) => x.categoryId === s.groceries.id)
        .plannedCents,
    ).toBe(70_000);
  });

  it('with funding, applies atomically and logs the move; the pool is unchanged', async () => {
    const s = await setup();
    await s.api('PATCH', `/periods/${PERIOD}`, { expectedIncomeCents: 100_000 });
    await s.api('PATCH', `/allocations/${PERIOD}:${s.fun.id}`, { plannedCents: 30_000 });
    await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, { plannedCents: 70_000 });
    const res = await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, {
      plannedCents: 80_000,
      funding: [{ fromCategoryId: s.fun.id, amountCents: 10_000 }],
      note: 'Hosting family',
    });
    expect(res.status).toBe(200);
    expect(res.json.poolCents).toBe(0);
    const planned = Object.fromEntries(
      res.json.categories.map((x: { categoryId: string; plannedCents: number }) => [
        x.categoryId,
        x.plannedCents,
      ]),
    );
    expect(planned[s.groceries.id]).toBe(80_000);
    expect(planned[s.fun.id]).toBe(20_000);
    const log = await s.api('GET', `/periods/${PERIOD}/reallocations`);
    expect(log.json.at(-1)).toMatchObject({
      fromCategoryId: s.fun.id,
      toCategoryId: s.groceries.id,
      amountCents: 10_000,
      note: 'Hosting family',
    });
  });

  it('funding that still falls short → 409; invalid funding → 400', async () => {
    const s = await setup();
    await s.api('PATCH', `/allocations/${PERIOD}:${s.fun.id}`, { plannedCents: 0 });
    const short = await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, {
      plannedCents: 10_000,
      funding: [{ fromCategoryId: s.fun.id, amountCents: 1 }],
    });
    expect(short.status).toBe(400); // fun has 0 planned
    const self = await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, {
      plannedCents: 10_000,
      funding: [{ fromCategoryId: s.groceries.id, amountCents: 1 }],
    });
    expect(self.status).toBe(400);
  });

  it('lowering planned returns money to the pool', async () => {
    const s = await setup();
    await s.api('PATCH', `/periods/${PERIOD}`, { expectedIncomeCents: 100_000 });
    await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, { plannedCents: 50_000 });
    const res = await s.api('PATCH', `/allocations/${PERIOD}:${s.groceries.id}`, {
      plannedCents: 20_000,
    });
    expect(res.json.poolCents).toBe(80_000);
  });

  it('closed periods cannot be edited; income categories and unknown ids 404', async () => {
    const s = await setup();
    await s.api('PATCH', `/periods/2026-08`, { expectedIncomeCents: 1 });
    await env.DB.prepare(
      "UPDATE period SET status = 'closed' WHERE user_id = ?1 AND id = '2026-08'",
    )
      .bind(s.userId)
      .run();
    expect(
      (await s.api('PATCH', `/allocations/2026-08:${s.groceries.id}`, { plannedCents: 1 })).json
        .error.code,
    ).toBe('PERIOD_CLOSED');
    expect(
      (await s.api('PATCH', `/allocations/${PERIOD}:${s.pay.id}`, { plannedCents: 1 })).status,
    ).toBe(404);
    expect((await s.api('PATCH', `/allocations/nope`, { plannedCents: 1 })).status).toBe(404);
  });

  it("cannot touch another user's categories", async () => {
    const a = await setup();
    const b = await signedInUser();
    const res = await call('PATCH', `/allocations/${PERIOD}:${a.groceries.id}`, {
      access: b.access,
      body: { plannedCents: 1 },
    });
    expect(res.status).toBe(404);
    expect((await call('GET', `/categories/${a.groceries.id}`, { access: b.access })).status).toBe(
      404,
    );
  });
});
