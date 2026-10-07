import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { refreshAggregateStmts } from '../src/db';
import { call, signedInUser } from './helpers/http';

describe('T23 period_aggregate refresh writes only what moved', () => {
  it('an unchanged month writes nothing; a category that stops counting leaves the cache', async () => {
    const u = await signedInUser();
    const api = (method: string, path: string, body?: unknown) =>
      call(method, path, { access: u.access, body });
    const life = (await api('POST', '/category-groups', { name: 'Life', kind: 'expense' })).json;
    const food = (await api('POST', '/categories', { groupId: life.id, name: 'Food' })).json;
    const fun = (await api('POST', '/categories', { groupId: life.id, name: 'Fun' })).json;
    const card = (await api('POST', '/accounts', { name: 'Card', kind: 'credit' })).json;
    const add = async (amountCents: number, categoryId: string) =>
      (
        await api('POST', '/transactions', {
          accountId: card.id,
          postedAt: '2026-09-04',
          amountCents,
          descriptor: 'X',
          categoryId,
        })
      ).json;
    await add(1_200, food.id);
    const film = await add(900, fun.id);
    const cache = async () =>
      (
        await env.DB.prepare(
          `SELECT category_id, spent_cents, txn_count FROM period_aggregate
           WHERE user_id = ?1 AND period_id = '2026-09' ORDER BY spent_cents`,
        )
          .bind(u.userId)
          .all()
      ).results;
    const refresh = async () =>
      (await env.DB.batch(refreshAggregateStmts(u.userId, env.DB, '2026-09'))).reduce(
        (n, r) => n + (r.meta.rows_written ?? 0),
        0,
      );
    expect(await cache()).toEqual([
      { category_id: fun.id, spent_cents: 900, txn_count: 1 },
      { category_id: food.id, spent_cents: 1_200, txn_count: 1 },
    ]);
    expect(await refresh()).toBe(0);

    await env.DB.prepare("UPDATE txn SET review_state = 'dropped' WHERE id = ?1")
      .bind(film.id)
      .run();
    expect(await refresh()).toBeGreaterThan(0);
    expect(await cache()).toEqual([{ category_id: food.id, spent_cents: 1_200, txn_count: 1 }]);
    expect(await refresh()).toBe(0);
    await add(300, food.id); // its own batch refreshes the month: the row is updated in place
    expect(await cache()).toEqual([{ category_id: food.id, spent_cents: 1_500, txn_count: 2 }]);
  });
});

describe('T41 dashboard spending report', () => {
  it('counts what the budget counts: budgeted expense splits, not income, unbudgeted or dropped', async () => {
    const u = await signedInUser();
    const api = (method: string, path: string, body?: unknown) =>
      call(method, path, { access: u.access, body });
    const expense = (await api('POST', '/category-groups', { name: 'Life', kind: 'expense' })).json;
    const income = (await api('POST', '/category-groups', { name: 'In', kind: 'income' })).json;
    const food = (await api('POST', '/categories', { groupId: expense.id, name: 'Food' })).json;
    const pay = (await api('POST', '/categories', { groupId: income.id, name: 'Pay' })).json;
    const xfer = (
      await api('POST', '/categories', { groupId: expense.id, name: 'Move', budgeted: false })
    ).json;
    const card = (await api('POST', '/accounts', { name: 'Card', kind: 'credit' })).json;
    const txn = async (postedAt: string, amountCents: number, categoryId: string) =>
      (
        await api('POST', '/transactions', {
          accountId: card.id,
          postedAt,
          amountCents,
          descriptor: 'X',
          categoryId,
        })
      ).json;

    await txn('2026-04-15', 7_000, food.id); // before the six-month window
    await txn('2026-05-02', 1_000, food.id);
    await txn('2026-08-03', 2_000, food.id);
    await txn('2026-08-03', 500, food.id);
    await txn('2026-09-01', 3_000, food.id);
    await txn('2026-09-01', -300, food.id); // refund lowers spending
    await txn('2026-09-02', -250_000, pay.id); // income is not spending
    await txn('2026-09-02', 40_000, xfer.id); // unbudgeted is not spending
    const dropped = await txn('2026-09-03', 9_999, food.id);
    await env.DB.batch([
      env.DB.prepare("UPDATE txn SET review_state = 'dropped' WHERE id = ?1").bind(dropped.id),
      ...refreshAggregateStmts(u.userId, env.DB, '2026-09'),
    ]);

    const r = await api('GET', '/reports/spending?month=2026-09');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      month: '2026-09',
      days: [
        { date: '2026-08-03', cents: 2_500 },
        { date: '2026-09-01', cents: 2_700 },
      ],
      months: [
        { periodId: '2026-04', cents: 7_000 },
        { periodId: '2026-05', cents: 1_000 },
        { periodId: '2026-06', cents: 0 },
        { periodId: '2026-07', cents: 0 },
        { periodId: '2026-08', cents: 2_500 },
        { periodId: '2026-09', cents: 2_700 },
      ],
    });
  });

  it('never counts the Transfers group: card payments made or moved there stay out', async () => {
    const u = await signedInUser();
    const api = (method: string, path: string, body?: unknown) =>
      call(method, path, { access: u.access, body });
    const life = (await api('POST', '/category-groups', { name: 'Life', kind: 'expense' })).json;
    const xfers = (await api('POST', '/category-groups', { name: 'Transfers', kind: 'expense' }))
      .json;
    const food = (await api('POST', '/categories', { groupId: life.id, name: 'Food' })).json;
    // Created in Transfers asking to count: refused.
    const ccp = (
      await api('POST', '/categories', {
        groupId: xfers.id,
        name: 'Credit Card Payment',
        budgeted: true,
      })
    ).json;
    expect(ccp.budgeted).toBe(false);
    // Created as spending, with history, then dragged into Transfers: its history leaves.
    const moved = (await api('POST', '/categories', { groupId: life.id, name: 'Venmo out' })).json;
    expect(moved.budgeted).toBe(true);
    const card = (await api('POST', '/accounts', { name: 'Card', kind: 'credit' })).json;
    const txn = (postedAt: string, amountCents: number, categoryId: string) =>
      api('POST', '/transactions', {
        accountId: card.id,
        postedAt,
        amountCents,
        descriptor: 'X',
        categoryId,
      });
    await txn('2026-09-01', 1_000, food.id);
    await txn('2026-09-02', 50_000, ccp.id);
    await txn('2026-09-03', 20_000, moved.id);
    const patched = (await api('PATCH', `/categories/${moved.id}`, { groupId: xfers.id })).json;
    expect(patched.budgeted).toBe(false);
    // Asking to count while in Transfers is refused too.
    const again = (await api('PATCH', `/categories/${moved.id}`, { budgeted: true })).json;
    expect(again.budgeted).toBe(false);

    const r = await api('GET', '/reports/spending?month=2026-09');
    expect(r.json.days).toEqual([{ date: '2026-09-01', cents: 1_000 }]);
    expect(r.json.months.at(-1)).toEqual({ periodId: '2026-09', cents: 1_000 });
    const period = await api('GET', '/periods/2026-09');
    expect(period.json.totals.spentCents).toBe(1_000);
  });

  it('rejects a missing or malformed month', async () => {
    const u = await signedInUser();
    expect((await call('GET', '/reports/spending', { access: u.access })).status).toBe(400);
    expect(
      (await call('GET', '/reports/spending?month=2026-13', { access: u.access })).status,
    ).toBe(400);
  });
});

describe('money-flow (Sankey) report', () => {
  it('flows income through group totals into categories, with leftover', async () => {
    const u = await signedInUser();
    const api = (method: string, path: string, body?: unknown) =>
      call(method, path, { access: u.access, body });
    const expense = (await api('POST', '/category-groups', { name: 'Food', kind: 'expense' })).json;
    const income = (await api('POST', '/category-groups', { name: 'In', kind: 'income' })).json;
    const food = (await api('POST', '/categories', { groupId: expense.id, name: 'Groceries' }))
      .json;
    const pay = (await api('POST', '/categories', { groupId: income.id, name: 'Paycheck' })).json;
    const card = (await api('POST', '/accounts', { name: 'Card', kind: 'credit' })).json;
    const txn = async (postedAt: string, amountCents: number, categoryId: string) =>
      api('POST', '/transactions', {
        accountId: card.id,
        postedAt,
        amountCents,
        descriptor: 'X',
        categoryId,
      });

    await txn('2026-09-02', -1_000, pay.id);
    await txn('2026-09-03', 300, food.id);

    const r = await api('GET', '/reports/money-flow?month=2026-09');
    expect(r.status).toBe(200);
    expect(r.json.month).toBe('2026-09');
    // Node/link order follows category id order, which is random — compare as sets.
    expect(new Set(r.json.nodes.map((n: { id: string }) => n.id))).toEqual(
      new Set(['income', `group:${expense.id}`, `cat:${food.id}`, `cat:${pay.id}`, 'leftover']),
    );
    expect(r.json.links).toContainEqual({
      source: 'income',
      target: `group:${expense.id}`,
      valueCents: 300,
    });
    expect(r.json.links).toContainEqual({
      source: `cat:${pay.id}`,
      target: 'income',
      valueCents: 1_000,
    });
    expect(r.json.links).toContainEqual({
      source: `group:${expense.id}`,
      target: `cat:${food.id}`,
      valueCents: 300,
    });
    expect(r.json.links).toContainEqual({ source: 'income', target: 'leftover', valueCents: 700 });
    expect(r.json.links).toHaveLength(4);
  });

  it('keeps an archived category’s (and group’s) money, so it totals what cash flow does', async () => {
    const u = await signedInUser();
    const api = (method: string, path: string, body?: unknown) =>
      call(method, path, { access: u.access, body });
    const old = (await api('POST', '/category-groups', { name: 'Old', kind: 'expense' })).json;
    const income = (await api('POST', '/category-groups', { name: 'In', kind: 'income' })).json;
    const gone = (await api('POST', '/categories', { groupId: old.id, name: 'Gym' })).json;
    const pay = (await api('POST', '/categories', { groupId: income.id, name: 'Paycheck' })).json;
    const card = (await api('POST', '/accounts', { name: 'Card', kind: 'credit' })).json;
    const txn = (postedAt: string, amountCents: number, categoryId: string) =>
      api('POST', '/transactions', {
        accountId: card.id,
        postedAt,
        amountCents,
        descriptor: 'X',
        categoryId,
      });
    await txn('2026-08-02', -1_000, pay.id);
    await txn('2026-08-03', 400, gone.id);
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('UPDATE category SET archived_at = ?2 WHERE id = ?1').bind(gone.id, now),
      env.DB.prepare('UPDATE category_group SET archived_at = ?2 WHERE id = ?1').bind(old.id, now),
    ]);

    const r = await api('GET', '/reports/money-flow?month=2026-08');
    expect(r.json.links).toContainEqual({
      source: `group:${old.id}`,
      target: `cat:${gone.id}`,
      valueCents: 400,
    });
    expect(r.json.links).toContainEqual({ source: 'income', target: 'leftover', valueCents: 600 });
    const cf = await api('GET', '/reports/cash-flow?month=2026-08');
    expect(cf.json.months.at(-1)).toMatchObject({ expenseCents: 400, incomeCents: 1_000 });
  });

  it('rejects a missing or malformed month', async () => {
    const u = await signedInUser();
    expect((await call('GET', '/reports/money-flow', { access: u.access })).status).toBe(400);
  });
});
