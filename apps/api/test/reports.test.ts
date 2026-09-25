import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

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
    await env.DB.prepare("UPDATE txn SET review_state = 'dropped' WHERE id = ?1")
      .bind(dropped.id)
      .run();

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

  it('rejects a missing or malformed month', async () => {
    const u = await signedInUser();
    expect((await call('GET', '/reports/spending', { access: u.access })).status).toBe(400);
    expect(
      (await call('GET', '/reports/spending?month=2026-13', { access: u.access })).status,
    ).toBe(400);
  });
});
