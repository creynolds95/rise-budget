import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { listAggregates, periodHasActivity } from '../src/db';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const groceries = (await api('POST', '/categories', { groupId: group.id, name: 'Groceries' }))
    .json;
  const card = (await api('POST', '/accounts', { name: 'Apple Card', kind: 'credit' })).json;
  const batchId = crypto.randomUUID();
  const row = (over: Record<string, unknown> = {}) => ({
    sourceId: 'monarch:1',
    postedAt: '2025-05-05',
    amountCents: 4200,
    merchant: 'Sprouts',
    originalStatement: 'SPROUTS FARMERS MARKET #12',
    notes: '',
    accountId: card.id,
    categoryId: groceries.id,
    isTransfer: false,
    reviewed: true,
    ...over,
  });
  const rows = (rs: unknown[], id = batchId) =>
    api('POST', '/import/monarch/rows', { batchId: id, rows: rs });
  return { ...u, api, group, groceries, card, batchId, row, rows };
}

const count = async (userId: string, table: string) =>
  (
    await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`)
      .bind(userId)
      .first<{ n: number }>()
  )?.n;

describe('Monarch import: setup', () => {
  it('puts a new category in the group the person picked, and rejects an unknown one', async () => {
    const { api, group } = await setup();
    const picked = await api('POST', '/import/monarch/setup', {
      accounts: [],
      categories: [{ monarchName: 'Gym', kind: 'expense', groupId: group.id }],
    });
    const gym = await env.DB.prepare('SELECT group_id AS g FROM category WHERE id = ?1')
      .bind(picked.json.categories.Gym)
      .first<{ g: string }>();
    expect(gym?.g).toBe(group.id);
    const bad = await api('POST', '/import/monarch/setup', {
      accounts: [],
      categories: [{ monarchName: 'Pool', kind: 'expense', groupId: crypto.randomUUID() }],
    });
    expect(bad.status).toBe(400);
  });

  it('creates history-only accounts and categories, once', async () => {
    const u = await signedInUser();
    const api = (m: string, p: string, b?: unknown) => call(m, p, { access: u.access, body: b });
    const body = {
      accounts: [{ monarchName: 'CREDIT CARD (...4905)', kind: 'credit' }],
      categories: [
        { monarchName: 'Gym', kind: 'expense' },
        { monarchName: 'Paychecks', kind: 'income' },
        { monarchName: 'Transfer', kind: 'transfer' },
        { monarchName: 'Credit Card Payment', kind: 'transfer' },
      ],
    };
    const first = await api('POST', '/import/monarch/setup', body);
    expect(first.status).toBe(200);
    const again = await api('POST', '/import/monarch/setup', body);
    expect(again.json).toEqual(first.json);

    const made = await env.DB.prepare(
      'SELECT include_in_net_worth AS nw, include_in_budget AS bud, archived_at AS arch FROM account WHERE id = ?1',
    )
      .bind(first.json.accounts['CREDIT CARD (...4905)'])
      .first<{ nw: number; bud: number; arch: string | null }>();
    expect(made).toMatchObject({ nw: 0, bud: 0 });
    expect(made?.arch).toBeTruthy();

    const groups = (await api('GET', '/category-groups')).json as { name: string; kind: string }[];
    expect(groups.map((g) => `${g.name}:${g.kind}`).sort()).toEqual(
      expect.arrayContaining(['Imported:expense', 'Imported income:income', 'Transfers:expense']),
    );
    const cats = (await api('GET', '/categories')).json as {
      id: string;
      name: string;
      budgeted: boolean;
    }[];
    const budgeted = (n: string) => cats.find((c) => c.id === first.json.categories[n])?.budgeted;
    expect(budgeted('Gym')).toBe(true);
    expect(budgeted('Credit Card Payment')).toBe(false);
    expect(budgeted('Transfer')).toBe(false);
    expect(cats.filter((c) => c.name === 'Transfer')).toHaveLength(1);
  });
});

describe('Monarch import: rows', () => {
  it('writes the transaction, its one split and the spending cache, and nothing about the plan', async () => {
    const s = await setup();
    const periodsBefore = await count(s.userId, 'period');
    const allocBefore = await count(s.userId, 'allocation');
    const res = await s.rows([
      s.row(),
      s.row({ sourceId: 'monarch:2', postedAt: '2025-05-20', amountCents: 800 }),
      s.row({ sourceId: 'monarch:3', postedAt: '2025-06-01', amountCents: -500 }),
    ]);
    expect(res.json).toEqual({ imported: 3, duplicate: 0, overlap: 0, rejected: 0 });

    const t = await env.DB.prepare(
      `SELECT * FROM txn WHERE user_id = ?1 AND source_id = 'monarch:1'`,
    )
      .bind(s.userId)
      .first<Record<string, unknown>>();
    expect(t).toMatchObject({
      source: 'csv',
      amount_cents: 4200,
      posted_at: '2025-05-05',
      review_state: 'reviewed',
      is_transfer: 0,
      is_pending: 0,
      import_batch_id: s.batchId,
      merchant_display: 'Sprouts',
      descriptor_raw: 'SPROUTS FARMERS MARKET #12',
    });
    expect(await count(s.userId, 'split')).toBe(3);

    const agg = await listAggregates(s.userId, env.DB, '2025-05', '2025-06');
    expect(agg.map((a) => [a.periodId, a.spentCents, a.txnCount])).toEqual([
      ['2025-05', 5000, 2],
      ['2025-06', -500, 1],
    ]);

    // Zero rollover: no month, plan, carry or surplus row was written.
    expect(await count(s.userId, 'period')).toBe(periodsBefore);
    expect(await count(s.userId, 'allocation')).toBe(allocBefore);
  });

  it('leaves the budget going forward exactly as it was', async () => {
    const s = await setup();
    const before = (await s.api('GET', '/periods/2026-09')).json;
    await s.rows([s.row(), s.row({ sourceId: 'monarch:2', postedAt: '2026-08-30' })]);
    const after = (await s.api('GET', '/periods/2026-09')).json;
    expect(after).toEqual(before);
  });

  it('is safe to run twice: the same Monarch id lands once', async () => {
    const s = await setup();
    await s.rows([s.row()]);
    const again = await s.rows([s.row()], crypto.randomUUID());
    expect(again.json).toEqual({ imported: 0, duplicate: 1, overlap: 0, rejected: 0 });
    expect(await count(s.userId, 'txn')).toBe(1);
  });

  it('keeps two identical purchases that have different Monarch ids', async () => {
    const s = await setup();
    const res = await s.rows([s.row(), s.row({ sourceId: 'monarch:2' })]);
    expect(res.json.imported).toBe(2);
  });

  it('skips a row the bank feed already has on that account, day and amount', async () => {
    const s = await setup();
    await s.api('POST', '/transactions', {
      accountId: s.card.id,
      postedAt: '2025-05-05',
      amountCents: 4200,
      descriptor: 'Sprouts',
    });
    const res = await s.rows([s.row(), s.row({ sourceId: 'monarch:2', amountCents: 999 })]);
    expect(res.json).toEqual({ imported: 1, duplicate: 0, overlap: 1, rejected: 0 });
    expect(await count(s.userId, 'split')).toBe(2);
  });

  it('rejects rows outside the window, in a closed month, or with ids that are not yours', async () => {
    const s = await setup();
    const other = await setup();
    await env.DB.prepare(
      `INSERT INTO period (id, user_id, status) VALUES ('2024-03', ?1, 'closed')`,
    )
      .bind(s.userId)
      .run();
    const res = await s.rows([
      s.row({ sourceId: 'a', postedAt: '2022-12-31' }),
      s.row({ sourceId: 'b', postedAt: '2026-09-01' }),
      s.row({ sourceId: 'c', postedAt: '2024-03-10' }),
      s.row({ sourceId: 'd', accountId: other.card.id }),
      s.row({ sourceId: 'e', categoryId: other.groceries.id }),
      s.row({ sourceId: 'f', postedAt: '2023-01-01' }),
    ]);
    expect(res.json).toEqual({ imported: 1, duplicate: 0, overlap: 0, rejected: 5 });
    expect(await count(other.userId, 'txn')).toBe(0);
  });

  it('rejects an empty or oversized chunk', async () => {
    const s = await setup();
    expect((await s.rows([])).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => s.row({ sourceId: `m${i}` }));
    expect((await s.rows(many)).status).toBe(400);
  });
});

describe('Monarch import: history months', () => {
  it('are never offered for closing and never make a later month wait', async () => {
    const s = await setup();
    await s.rows([s.row({ postedAt: '2026-08-10' })]);
    expect(await periodHasActivity(s.userId, env.DB, '2026-08')).toBe(false);
    const view = (await s.api('GET', '/periods/2026-08')).json;
    expect(view.close.ended).toBe(false);
    const close = await s.api('POST', '/periods/2026-08/close', {});
    expect(close.status).toBe(409);
    expect(close.json.error.message).toMatch(/imported history/);
  });

  it('count as activity again once a real transaction lands in them', async () => {
    const s = await setup();
    await s.rows([s.row({ postedAt: '2026-08-10' })]);
    await s.api('POST', '/transactions', {
      accountId: s.card.id,
      postedAt: '2026-08-12',
      amountCents: 100,
      descriptor: 'Coffee',
    });
    expect(await periodHasActivity(s.userId, env.DB, '2026-08')).toBe(true);
  });
});

describe('Monarch import: batches and undo', () => {
  it('lists an import and takes it back, rebuilding the spending cache', async () => {
    const s = await setup();
    await s.rows([s.row(), s.row({ sourceId: 'monarch:2', postedAt: '2025-07-01' })]);
    const batches = (await s.api('GET', '/import/monarch/batches')).json;
    expect(batches).toEqual([
      expect.objectContaining({
        batchId: s.batchId,
        rows: 2,
        from: '2025-05-05',
        to: '2025-07-01',
      }),
    ]);

    expect((await s.api('DELETE', `/import/monarch/batches/${s.batchId}`)).status).toBe(204);
    expect(await count(s.userId, 'txn')).toBe(0);
    expect(await count(s.userId, 'split')).toBe(0);
    expect(await listAggregates(s.userId, env.DB, '2025-01', '2025-12')).toEqual([]);
    expect((await s.api('GET', '/import/monarch/batches')).json).toEqual([]);
    expect((await s.api('DELETE', `/import/monarch/batches/${s.batchId}`)).status).toBe(404);
  });

  it("never touches another user's import", async () => {
    const a = await setup();
    const b = await setup();
    await a.rows([a.row()]);
    expect((await b.api('DELETE', `/import/monarch/batches/${a.batchId}`)).status).toBe(404);
    expect(await count(a.userId, 'txn')).toBe(1);
    expect((await b.api('GET', '/import/monarch/batches')).json).toEqual([]);
  });
});
