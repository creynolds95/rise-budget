import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

const files = import.meta.glob('../migrations/0022_transfers_never_spending.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const migration = Object.values(files)[0] as string;

describe('0022 Transfers group is never spending', () => {
  it('turns off counting for categories already in Transfers and drops them from the chart', async () => {
    const u = await signedInUser();
    const api = (method: string, path: string, body?: unknown) =>
      call(method, path, { access: u.access, body });
    const life = (await api('POST', '/category-groups', { name: 'Life', kind: 'expense' })).json;
    const xfers = (await api('POST', '/category-groups', { name: 'Transfers', kind: 'expense' }))
      .json;
    const food = (await api('POST', '/categories', { groupId: life.id, name: 'Food' })).json;
    const ccp = (
      await api('POST', '/categories', { groupId: life.id, name: 'Credit Card Payment' })
    ).json;
    const card = (await api('POST', '/accounts', { name: 'Card', kind: 'credit' })).json;
    for (const [categoryId, amountCents] of [
      [food.id, 1_000],
      [ccp.id, 50_000],
    ] as const)
      await api('POST', '/transactions', {
        accountId: card.id,
        postedAt: '2026-09-02',
        amountCents,
        descriptor: 'X',
        categoryId,
      });
    // The state prod could be in: a budgeted category sitting in Transfers.
    await env.DB.prepare('UPDATE category SET group_id = ?1 WHERE id = ?2')
      .bind(xfers.id, ccp.id)
      .run();
    expect((await api('GET', '/reports/spending?month=2026-09')).json.days).toEqual([
      { date: '2026-09-02', cents: 51_000 },
    ]);

    await env.DB.batch(
      migration
        .split(';')
        .map((s) => s.replace(/--.*$/gm, '').trim())
        .filter(Boolean)
        .map((s) => env.DB.prepare(s)),
    );

    expect((await api('GET', `/categories/${ccp.id}`)).json.budgeted).toBe(false);
    expect((await api('GET', `/categories/${food.id}`)).json.budgeted).toBe(true);
    const r = (await api('GET', '/reports/spending?month=2026-09')).json;
    expect(r.days).toEqual([{ date: '2026-09-02', cents: 1_000 }]);
    expect(r.months.at(-1)).toEqual({ periodId: '2026-09', cents: 1_000 });
    expect((await api('GET', '/periods/2026-09')).json.totals.spentCents).toBe(1_000);
  });
});
