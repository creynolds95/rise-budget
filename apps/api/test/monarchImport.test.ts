import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { listAggregates } from '../src/db';
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

/** A row as SimpleFIN sync would have written it. */
async function bankRow(userId: string, accountId: string, postedAt: string, amountCents: number) {
  await env.DB.prepare(
    `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw,
       merchant_normalized, review_state, source, source_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'BANK', 'bank', 'reviewed', 'simplefin', ?1, ?6, ?6)`,
  )
    .bind(crypto.randomUUID(), userId, accountId, postedAt, amountCents, new Date().toISOString())
    .run();
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

  it('skips every row from the day the bank feed starts on that account, even a day off', async () => {
    const s = await setup();
    await bankRow(s.userId, s.card.id, '2026-07-01', 1);
    const res = await s.rows([
      s.row({ sourceId: 'monarch:1', postedAt: '2026-06-30' }),
      s.row({ sourceId: 'monarch:2', postedAt: '2026-07-01' }),
      s.row({ sourceId: 'monarch:3', postedAt: '2026-08-14' }),
    ]);
    expect(res.json).toEqual({ imported: 1, duplicate: 0, overlap: 2, rejected: 0 });
  });

  it('rejects rows outside the window or with ids that are not yours', async () => {
    const s = await setup();
    const other = await setup();
    const res = await s.rows([
      s.row({ sourceId: 'a', postedAt: '2022-12-31' }),
      s.row({ sourceId: 'b', postedAt: '2026-09-01' }),
      s.row({ sourceId: 'd', accountId: other.card.id }),
      s.row({ sourceId: 'e', categoryId: other.groceries.id }),
      s.row({ sourceId: 'f', postedAt: '2023-01-01' }),
    ]);
    expect(res.json).toEqual({ imported: 1, duplicate: 0, overlap: 0, rejected: 4 });
    expect(await count(other.userId, 'txn')).toBe(0);
  });

  it('rejects an empty or oversized chunk', async () => {
    const s = await setup();
    expect((await s.rows([])).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => s.row({ sourceId: `m${i}` }));
    expect((await s.rows(many)).status).toBe(400);
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

describe('Monarch import: merging history into a live account', () => {
  async function pair() {
    const s = await setup();
    const setupRes = await s.api('POST', '/import/monarch/setup', {
      accounts: [{ monarchName: 'SUMMIT CLASSIC CHECKING (...4821)', kind: 'depository' }],
      categories: [],
    });
    const historyId = setupRes.json.accounts['SUMMIT CLASSIC CHECKING (...4821)'] as string;
    const live = (
      await s.api('POST', '/accounts', {
        name: 'SUMMIT CLASSIC CHECKING (4821)',
        kind: 'depository',
      })
    ).json;
    // A manual account is not a bank feed: make the twin one.
    await env.DB.prepare("UPDATE account SET source = 'simplefin' WHERE id = ?1")
      .bind(live.id)
      .run();
    await s.rows([
      s.row({ sourceId: 'monarch:1', accountId: historyId }),
      s.row({ sourceId: 'monarch:2', accountId: historyId, amountCents: 900 }),
    ]);
    return { ...s, historyId, live };
  }

  it('lists the pair, then moves the rows and removes the empty copy', async () => {
    const s = await pair();
    const list = await s.api('GET', '/import/monarch/merges');
    expect(list.json).toEqual([
      {
        historyId: s.historyId,
        historyName: 'SUMMIT CLASSIC CHECKING (...4821)',
        liveId: s.live.id,
        liveName: 'SUMMIT CLASSIC CHECKING (4821)',
        rows: 2,
        duplicates: 0,
      },
    ]);
    const done = await s.api('POST', '/import/monarch/merges', {
      historyId: s.historyId,
      liveId: s.live.id,
    });
    expect(done.json).toEqual({ moved: 2, dropped: 0 });
    const moved = await env.DB.prepare('SELECT COUNT(*) AS n FROM txn WHERE account_id = ?1')
      .bind(s.live.id)
      .first<{ n: number }>();
    expect(moved?.n).toBe(2);
    const gone = await env.DB.prepare('SELECT COUNT(*) AS n FROM account WHERE id = ?1')
      .bind(s.historyId)
      .first<{ n: number }>();
    expect(gone?.n).toBe(0);
    expect((await s.api('GET', '/import/monarch/merges')).json).toEqual([]);
  });

  it('drops rows the live bank feed already has instead of counting them twice', async () => {
    const s = await pair();
    // monarch:1 is 2025-05-05 for 4200; the feed starts the day after and repeats it a day late.
    await bankRow(s.userId, s.live.id, '2025-05-06', 4200);
    await s.rows([
      s.row({ sourceId: 'monarch:3', accountId: s.historyId, postedAt: '2025-05-20' }),
    ]);
    const [c] = (await s.api('GET', '/import/monarch/merges')).json;
    expect(c).toMatchObject({ rows: 2, duplicates: 1 });
    const done = await s.api('POST', '/import/monarch/merges', {
      historyId: s.historyId,
      liveId: s.live.id,
    });
    expect(done.json).toEqual({ moved: 2, dropped: 1 });
    const left = await env.DB.prepare(
      `SELECT source_id AS id FROM txn WHERE account_id = ?1 AND source = 'csv' ORDER BY source_id`,
    )
      .bind(s.live.id)
      .all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual(['monarch:1', 'monarch:2']);
    const may = await listAggregates(s.userId, env.DB, '2025-05', '2025-05');
    expect(may).toEqual([expect.objectContaining({ spentCents: 4200 + 900 })]);
  });

  it('refuses a pair that was not offered', async () => {
    const s = await pair();
    const other = (await s.api('POST', '/accounts', { name: 'Elsewhere', kind: 'depository' }))
      .json;
    const r = await s.api('POST', '/import/monarch/merges', {
      historyId: s.historyId,
      liveId: other.id,
    });
    expect(r.status).toBe(404);
  });

  it('does not offer a pair when two live accounts share the mask', async () => {
    const s = await pair();
    const twin = (await s.api('POST', '/accounts', { name: 'Other (4821)', kind: 'depository' }))
      .json;
    await env.DB.prepare("UPDATE account SET source = 'simplefin' WHERE id = ?1")
      .bind(twin.id)
      .run();
    expect((await s.api('GET', '/import/monarch/merges')).json).toEqual([]);
  });

  it('ignores other people’s accounts', async () => {
    const mine = await pair();
    const other = await signedInUser();
    const res = await call('GET', '/import/monarch/merges', { access: other.access });
    expect(res.json).toEqual([]);
    expect((await mine.api('GET', '/import/monarch/merges')).json).toHaveLength(1);
  });
});

describe('Monarch import: rows the bank feed also has', () => {
  it('lists imported rows a feed covers and removes them on request', async () => {
    const s = await setup();
    await s.rows([
      s.row({ sourceId: 'monarch:1', postedAt: '2026-06-02' }),
      s.row({ sourceId: 'monarch:2', postedAt: '2026-07-03' }),
      s.row({ sourceId: 'monarch:3', postedAt: '2026-08-04' }),
    ]);
    // The feed arrived after the import, starting in July.
    await bankRow(s.userId, s.card.id, '2026-07-01', 4200);
    expect((await s.api('GET', '/import/monarch/overlaps')).json).toEqual([
      {
        accountId: s.card.id,
        accountName: 'Apple Card',
        rows: 2,
        from: '2026-07-03',
        to: '2026-08-04',
      },
    ]);

    const other = await signedInUser();
    expect(
      (await call('DELETE', `/import/monarch/overlaps/${s.card.id}`, { access: other.access }))
        .status,
    ).toBe(404);

    const done = await s.api('DELETE', `/import/monarch/overlaps/${s.card.id}`);
    expect(done.json).toEqual({ removed: 2 });
    expect((await s.api('GET', '/import/monarch/overlaps')).json).toEqual([]);
    expect(await count(s.userId, 'split')).toBe(1);
    expect(await listAggregates(s.userId, env.DB, '2026-07', '2026-08')).toEqual([]);
  });
});
