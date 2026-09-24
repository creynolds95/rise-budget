import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { scheduled } from '../src/index';
import { centsToDecimal, mockSimpleFin } from '../src/sync/mock';
import { runSync, windowStart } from '../src/sync/run';
import { httpSimpleFin, sourceFromEnv, type SimpleFinSource } from '../src/sync/source';
import { call, signedInUser } from './helpers/http';

const at = (iso: string) => new Date(iso);
const sec = (date: string) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 18) / 1000;

interface FakeTxn {
  id: string;
  date: string;
  cents: number; // Rise sign: spending positive
  desc: string;
  pending?: boolean;
}
interface FakeAccount {
  id: string;
  name: string;
  txns: FakeTxn[];
  balance?: number;
  currency?: string;
  reported?: string;
}

/** A hand-built bridge: exactly the rows a test needs, in SimpleFIN's wire format. */
function fake(accounts: FakeAccount[], errors: string[] = []): SimpleFinSource {
  return {
    mode: 'mock',
    fetchAccounts: () =>
      Promise.resolve({
        errors,
        accounts: accounts.map((a) => ({
          org: { name: 'Test Bank' },
          id: a.id,
          name: a.name,
          currency: a.currency ?? 'USD',
          balance: centsToDecimal(a.balance ?? 0),
          'balance-date': sec(a.reported ?? '2026-09-20'),
          transactions: a.txns.map((t) => ({
            id: t.id,
            posted: t.pending ? 0 : sec(t.date),
            transacted_at: sec(t.date),
            amount: centsToDecimal(-t.cents),
            description: t.desc,
            ...(t.pending ? { pending: true } : {}),
          })),
        })),
      }),
  };
}

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const gas = (await api('POST', '/categories', { groupId: group.id, name: 'Gas' })).json;
  const food = (await api('POST', '/categories', { groupId: group.id, name: 'Groceries' })).json;
  const txns = async (accountSourceId?: string) =>
    (
      await env.DB.prepare(
        `SELECT t.* FROM txn t JOIN account a ON a.id = t.account_id
         WHERE t.user_id = ?1 AND (?2 IS NULL OR a.source_account_id = ?2) ORDER BY t.posted_at, t.id`,
      )
        .bind(u.userId, accountSourceId ?? null)
        .all<Record<string, unknown>>()
    ).results;
  const spent = async (period: string, categoryId: string) =>
    (await api('GET', `/periods/${period}`)).json.categories.find(
      (c: { categoryId: string }) => c.categoryId === categoryId,
    ).spentCents as number;
  return { ...u, api, gas, food, txns, spent };
}

describe('T27 SimpleFIN sync', () => {
  it('discovers Caleb’s seven accounts from the mock bridge with sensible defaults', async () => {
    const s = await setup();
    const r = await runSync(
      env.DB,
      s.userId,
      mockSimpleFin(() => at('2026-09-24T15:00:00Z')),
    );
    expect(r.status).toBe('ok');
    expect(r.accountsTouched).toBe(7);
    expect(r.rowsInserted).toBeGreaterThan(20);
    const accounts = (await s.api('GET', '/accounts')).json as {
      name: string;
      kind: string;
      includeInBudget: boolean;
      syncCadenceHours: number;
    }[];
    const by = Object.fromEntries(accounts.map((a) => [a.name, a]));
    expect(Object.keys(by).sort()).toEqual([
      'Apple Card',
      'Apple Savings',
      'Chase Credit',
      'Citi Credit',
      'USAA Checking',
      'USAA Credit',
      'USAA Savings',
    ]);
    expect(by['USAA Checking']).toMatchObject({
      kind: 'depository',
      includeInBudget: true,
      syncCadenceHours: 24,
    });
    expect(by['USAA Savings']).toMatchObject({ kind: 'depository', includeInBudget: false });
    expect(by['Chase Credit']).toMatchObject({ kind: 'credit', includeInBudget: true });
    expect(by['Apple Card']).toMatchObject({ kind: 'credit', syncCadenceHours: 720 });
    expect(by['Apple Savings']).toMatchObject({
      kind: 'depository',
      includeInBudget: false,
      syncCadenceHours: 720,
    });
    // Everything new waits for review, but every row already has a real category (H1) — a
    // guess, even if wrong, never nothing.
    const rows = await s.txns();
    expect(rows.every((t) => t.review_state === 'needs_review')).toBe(true);
    const splits = await env.DB.prepare('SELECT COUNT(*) AS n FROM split WHERE user_id = ?1')
      .bind(s.userId)
      .first<{ n: number }>();
    expect(splits?.n).toBe(rows.length);
  });

  it('#12 re-running over the same window inserts zero rows (edge 12)', async () => {
    const s = await setup();
    const src = mockSimpleFin(() => at('2026-09-24T15:00:00Z'));
    await runSync(env.DB, s.userId, src);
    const before = (await s.txns()).length;
    const again = await runSync(env.DB, s.userId, src);
    expect(again).toMatchObject({ status: 'ok', rowsInserted: 0, rowsUpdated: 0 });
    expect((await s.txns()).length).toBe(before);
  });

  it('pending rows post two days later under a new id without duplicating', async () => {
    const s = await setup();
    await runSync(
      env.DB,
      s.userId,
      mockSimpleFin(() => at('2026-09-24T15:00:00Z')),
    );
    const pendingBefore = (await s.txns()).filter((t) => t.is_pending === 1);
    expect(pendingBefore.length).toBeGreaterThan(0);
    const r = await runSync(
      env.DB,
      s.userId,
      mockSimpleFin(() => at('2026-09-26T15:00:00Z')),
    );
    expect(r.status).toBe('ok');
    const after = await s.txns();
    for (const p of pendingBefore) {
      const same = after.find((t) => t.id === p.id);
      expect(same).toMatchObject({
        is_pending: 0,
        source_id: String(p.source_id).replace('-pending', ''),
      });
    }
    const ids = after.map((t) => `${String(t.account_id)}:${String(t.source_id)}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('#4 a posted amount drift updates in place and keeps category, splits, notes, review (edge 4)', async () => {
    const s = await setup();
    const hold: FakeTxn = {
      id: 'p-1',
      date: '2026-09-18',
      cents: 5_037,
      desc: 'QT 0412 OUTSIDE TULSA OK',
      pending: true,
    };
    await runSync(env.DB, s.userId, fake([{ id: 'card', name: 'USAA Credit', txns: [hold] }]), {
      now: at('2026-09-18T20:00:00Z'),
    });
    const [row] = await s.txns();
    const id = String(row?.id);
    await s.api('PATCH', `/transactions/${id}`, {
      categoryId: s.gas.id,
      notes: 'road trip',
      reviewState: 'reviewed',
    });
    expect(await s.spent('2026-09', s.gas.id)).toBe(5_037); // pending counts toward spent

    const posted: FakeTxn = {
      id: 'q-1',
      date: '2026-09-19',
      cents: 5_000,
      desc: 'QT 0412 OUTSIDE TULSA OK',
    };
    const r = await runSync(
      env.DB,
      s.userId,
      fake([{ id: 'card', name: 'USAA Credit', txns: [posted] }]),
      {
        now: at('2026-09-20T20:00:00Z'),
      },
    );
    expect(r).toMatchObject({ rowsInserted: 0, rowsUpdated: 1 });
    const t = (await s.api('GET', `/transactions/${id}`)).json;
    expect(t).toMatchObject({
      amountCents: 5_000,
      postedAt: '2026-09-19',
      isPending: false,
      sourceId: 'q-1',
      notes: 'road trip',
      reviewState: 'reviewed',
      splits: [{ categoryId: s.gas.id, amountCents: 5_000 }],
    });
    expect(await s.spent('2026-09', s.gas.id)).toBe(5_000);
    expect((await s.txns()).length).toBe(1);
  });

  it('a multi-split pending row: the last split absorbs the drift', async () => {
    const s = await setup();
    const src = (t: FakeTxn) => fake([{ id: 'card', name: 'Chase Credit', txns: [t] }]);
    await runSync(
      env.DB,
      s.userId,
      src({ id: 'p', date: '2026-09-10', cents: 10_000, desc: 'KROGER #512', pending: true }),
      {
        now: at('2026-09-10T20:00:00Z'),
      },
    );
    const id = String((await s.txns())[0]?.id);
    await s.api('POST', `/transactions/${id}/splits`, {
      splits: [
        { categoryId: s.food.id, amountCents: 7_000 },
        { categoryId: s.gas.id, amountCents: 3_000 },
      ],
    });
    await runSync(
      env.DB,
      s.userId,
      src({ id: 'q', date: '2026-09-11', cents: 9_900, desc: 'KROGER #512' }),
      {
        now: at('2026-09-12T20:00:00Z'),
      },
    );
    expect((await s.api('GET', `/transactions/${id}`)).json.splits).toMatchObject([
      { categoryId: s.food.id, amountCents: 7_000 },
      { categoryId: s.gas.id, amountCents: 2_900 },
    ]);
  });

  it('a vanished pending row is dropped after 14 days and stops counting', async () => {
    const s = await setup();
    const card = (txns: FakeTxn[]) => fake([{ id: 'card', name: 'Citi Credit', txns }]);
    await runSync(
      env.DB,
      s.userId,
      card([{ id: 'p', date: '2026-09-01', cents: 2_500, desc: 'KROGER', pending: true }]),
      {
        now: at('2026-09-01T20:00:00Z'),
      },
    );
    const id = String((await s.txns())[0]?.id);
    await s.api('PATCH', `/transactions/${id}`, { categoryId: s.food.id });
    await runSync(env.DB, s.userId, card([]), { now: at('2026-09-14T20:00:00Z') });
    expect(await s.spent('2026-09', s.food.id)).toBe(2_500);
    const r = await runSync(env.DB, s.userId, card([]), { now: at('2026-09-15T20:00:00Z') });
    expect(r.rowsUpdated).toBe(1);
    expect((await s.api('GET', `/transactions/${id}`)).json.reviewState).toBe('dropped');
    expect(await s.spent('2026-09', s.food.id)).toBe(0);
  });

  it('a posted row landing in a closed month only flags it (edge 5 via sync)', async () => {
    const s = await setup();
    await s.api('PATCH', '/me/settings', { rollIncomeVariance: false });
    const card = (t: FakeTxn) =>
      fake([{ id: 'card', name: 'Chase Credit', txns: [t], reported: '2026-09-02' }]);
    await runSync(
      env.DB,
      s.userId,
      card({ id: 'p', date: '2026-08-30', cents: 4_000, desc: 'SHELL OIL', pending: true }),
      {
        now: at('2026-08-30T20:00:00Z'),
        since: '2026-08-01',
      },
    );
    const id = String((await s.txns())[0]?.id);
    await s.api('PATCH', `/transactions/${id}`, { categoryId: s.gas.id });
    expect((await s.api('POST', '/periods/2026-08/close', { override: true })).status).toBe(200);
    await runSync(
      env.DB,
      s.userId,
      card({ id: 'q', date: '2026-08-31', cents: 4_060, desc: 'SHELL OIL' }),
      {
        now: at('2026-09-02T20:00:00Z'),
      },
    );
    const aug = (await s.api('GET', '/periods/2026-08')).json.period;
    expect(aug).toMatchObject({ status: 'closed', needsRecalc: true, recalcDeltaCents: 60 });
  });

  it('one failing account yields partial without rolling back the others', async () => {
    const s = await setup();
    const r = await runSync(
      env.DB,
      s.userId,
      fake([
        {
          id: 'good',
          name: 'USAA Checking',
          txns: [{ id: 'g1', date: '2026-09-10', cents: 1_000, desc: 'KROGER' }],
        },
        { id: 'bad', name: 'Points Card', currency: 'https://example.com/points', txns: [] },
      ]),
      { now: at('2026-09-12T20:00:00Z') },
    );
    expect(r).toMatchObject({ status: 'partial', accountsTouched: 1, rowsInserted: 1 });
    expect(r.errors).toEqual([
      { account: 'Points Card', message: 'Unsupported currency https://example.com/points' },
    ]);
    const run = await env.DB.prepare(
      'SELECT status, error_json FROM sync_run WHERE user_id = ?1 AND id = ?2',
    )
      .bind(s.userId, r.id)
      .first<{ status: string; error_json: string }>();
    expect(run?.status).toBe('partial');
    expect(JSON.parse(run?.error_json ?? '[]')).toHaveLength(1);
  });

  it('a bridge that cannot be reached fails the run and writes nothing else', async () => {
    const s = await setup();
    const down: SimpleFinSource = {
      mode: 'live',
      fetchAccounts: () => Promise.reject(new Error('Could not reach SimpleFIN')),
    };
    const r = await runSync(env.DB, s.userId, down);
    expect(r).toMatchObject({
      status: 'failed',
      accountsTouched: 0,
      errors: [{ message: 'Could not reach SimpleFIN' }],
    });
    const odd: SimpleFinSource = {
      mode: 'live',
      fetchAccounts: () => Promise.resolve({ nope: true }),
    };
    expect((await runSync(env.DB, s.userId, odd)).errors[0]?.message).toMatch(/unexpected shape/);
    expect((await s.api('GET', '/accounts')).json).toEqual([]);
  });

  it('SimpleFIN’s own warnings make the run partial', async () => {
    const s = await setup();
    const r = await runSync(
      env.DB,
      s.userId,
      fake([{ id: 'a', name: 'USAA Checking', txns: [] }], ['USAA needs attention']),
    );
    expect(r).toMatchObject({ status: 'partial', errors: [{ message: 'USAA needs attention' }] });
  });

  it('balances land as sync snapshots dated by the bank; last_synced_at is when the bank reported', async () => {
    const s = await setup();
    await runSync(
      env.DB,
      s.userId,
      fake([{ id: 'a', name: 'Apple Card', balance: -12_345, reported: '2026-09-01', txns: [] }]),
      {
        now: at('2026-09-20T20:00:00Z'),
      },
    );
    const [a] = (await s.api('GET', '/accounts')).json;
    expect(a).toMatchObject({ balanceCents: -12_345, kind: 'credit' });
    expect(String(a.lastSyncedAt).slice(0, 10)).toBe('2026-09-01');
  });

  it('skips an account the user archived', async () => {
    const s = await setup();
    const src = fake([
      {
        id: 'a',
        name: 'USAA Checking',
        txns: [{ id: 't', date: '2026-09-05', cents: 100, desc: 'X' }],
      },
    ]);
    await runSync(env.DB, s.userId, src, { now: at('2026-09-06T20:00:00Z') });
    await env.DB.prepare("UPDATE account SET archived_at = '2026-09-07' WHERE user_id = ?1")
      .bind(s.userId)
      .run();
    await env.DB.prepare('DELETE FROM txn WHERE user_id = ?1').bind(s.userId).run();
    const r = await runSync(env.DB, s.userId, src, { now: at('2026-09-08T20:00:00Z') });
    expect(r).toMatchObject({ status: 'ok', accountsTouched: 0 });
    expect(await s.txns()).toEqual([]);
  });

  it('new rows get suggestions and the merchant’s display name', async () => {
    const s = await setup();
    await s.api('POST', '/rules', {
      matchField: 'merchant',
      matchType: 'equals',
      matchValue: 'Kroger',
      categoryId: s.food.id,
    });
    await s.api('PATCH', '/merchants/Kroger', { displayName: 'Kroger (Main St)' });
    await runSync(
      env.DB,
      s.userId,
      fake([
        {
          id: 'a',
          name: 'Chase Credit',
          txns: [{ id: 't', date: '2026-09-05', cents: 4_210, desc: 'KROGER #512 TULSA OK' }],
        },
      ]),
      {
        now: at('2026-09-06T20:00:00Z'),
      },
    );
    expect((await s.txns())[0]).toMatchObject({
      merchant_normalized: 'Kroger',
      merchant_display: 'Kroger (Main St)',
      suggested_category_id: s.food.id,
      suggestion_confidence: 1,
      review_state: 'needs_review',
    });
  });

  it('window: overlap before the earliest report, floored at the month each account was first seen', () => {
    const a = (
      last: string | null,
      created = '2026-07-15T00:00:00Z',
      archived: string | null = null,
    ) => ({
      id: 'x',
      kind: 'depository',
      source_account_id: 'x',
      last_synced_at: last,
      include_in_budget: 1,
      archived_at: archived,
      created_at: created,
    });
    expect(windowStart([], '2026-09-24')).toBe('2026-09-01');
    expect(windowStart([a('2026-09-20T12:00:00Z')], '2026-09-24')).toBe('2026-09-01');
    expect(windowStart([a('2026-09-03T12:00:00Z')], '2026-09-24')).toBe('2026-08-29');
    expect(windowStart([a('2026-09-03T12:00:00Z', '2026-09-24T00:00:00Z')], '2026-09-24')).toBe(
      '2026-09-01',
    );
    expect(windowStart([a('2026-10-20T12:00:00Z')], '2026-10-24')).toBe('2026-10-01');
    expect(windowStart([a('2026-10-03T12:00:00Z'), a(null)], '2026-10-24')).toBe('2026-09-28');
    expect(
      windowStart([a('2026-08-03T12:00:00Z', '2026-07-01T00:00:00Z', '2026-09-01')], '2026-10-24'),
    ).toBe('2026-10-01');
    expect(windowStart([], '2026-09-24', '2026-07-01')).toBe('2026-07-01');
  });
});

describe('T29 transfers', () => {
  const payday = (extra: FakeTxn[] = []) =>
    fake([
      {
        id: 'chk',
        name: 'USAA Checking',
        balance: 100_000,
        txns: [
          { id: 'c1', date: '2026-09-03', cents: 84_500, desc: 'CHASE CREDIT CRD AUTOPAY' },
          { id: 'c2', date: '2026-09-15', cents: 20_000, desc: 'USAA FUNDS TRANSFER DB' },
        ],
      },
      {
        id: 'card',
        name: 'Chase Credit',
        balance: -5_000,
        txns: [
          { id: 'k1', date: '2026-09-03', cents: -84_500, desc: 'AUTOMATIC PAYMENT - THANK YOU' },
          { id: 'k2', date: '2026-09-04', cents: 6_150, desc: 'KROGER #512' },
          ...extra,
        ],
      },
      {
        id: 'sav',
        name: 'USAA Savings',
        balance: 800_000,
        txns: [{ id: 's1', date: '2026-09-15', cents: -20_000, desc: 'USAA FUNDS TRANSFER CR' }],
      },
    ]);

  it('#3 a credit-card payment from checking is a transfer and never counts as spending (edge 3)', async () => {
    const s = await setup();
    const r = await runSync(env.DB, s.userId, payday(), { now: at('2026-09-20T20:00:00Z') });
    expect(r.transfersLinked).toBe(1);
    const rows = await s.txns();
    const bySource = Object.fromEntries(rows.map((t) => [String(t.source_id), t]));
    expect(bySource.c1).toMatchObject({
      is_transfer: 1,
      transfer_pair_id: bySource.k1?.id,
      review_state: 'needs_review',
    });
    expect(bySource.k1).toMatchObject({ is_transfer: 1, transfer_pair_id: bySource.c1?.id });
    // Checking → savings is medium confidence: not auto-linked.
    expect(bySource.c2?.is_transfer).toBe(0);

    // Even if both legs get a category, only the purchase counts.
    for (const t of rows)
      await s.api('PATCH', `/transactions/${String(t.id)}`, { categoryId: s.food.id });
    expect(await s.spent('2026-09', s.food.id)).toBe(6_150 + 20_000 - 20_000);
  });

  it('never re-labels a row the user already categorised', async () => {
    const s = await setup();
    const checking = fake([
      {
        id: 'chk',
        name: 'USAA Checking',
        txns: [{ id: 'c1', date: '2026-09-03', cents: 84_500, desc: 'CHASE CREDIT CRD AUTOPAY' }],
      },
    ]);
    await runSync(env.DB, s.userId, checking, { now: at('2026-09-03T20:00:00Z') });
    const id = String((await s.txns())[0]?.id);
    await s.api('PATCH', `/transactions/${id}`, { categoryId: s.gas.id });
    const r = await runSync(env.DB, s.userId, payday(), { now: at('2026-09-20T20:00:00Z') });
    expect(r.transfersLinked).toBe(0);
    expect((await s.api('GET', `/transactions/${id}`)).json.isTransfer).toBe(false);
  });

  it('manual link and unlink move spending out of and back into the budget', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, payday(), { now: at('2026-09-20T20:00:00Z') });
    const rows = await s.txns();
    const c2 = rows.find((t) => t.source_id === 'c2');
    const s1 = rows.find((t) => t.source_id === 's1');
    const k2 = rows.find((t) => t.source_id === 'k2');
    await s.api('PATCH', `/transactions/${String(c2?.id)}`, { categoryId: s.food.id });
    expect(await s.spent('2026-09', s.food.id)).toBe(20_000);

    const link = await s.api('POST', `/transactions/${String(c2?.id)}/transfer-link`, {
      otherTxnId: s1?.id,
    });
    expect(link.status).toBe(200);
    expect(link.json.items.map((t: { isTransfer: boolean }) => t.isTransfer)).toEqual([true, true]);
    expect(await s.spent('2026-09', s.food.id)).toBe(0);

    expect(
      (await s.api('POST', `/transactions/${String(c2?.id)}/transfer-link`, { otherTxnId: s1?.id }))
        .status,
    ).toBe(409);
    expect(
      (await s.api('POST', `/transactions/${String(k2?.id)}/transfer-link`, { otherTxnId: c2?.id }))
        .status,
    ).toBe(422);
    expect(
      (await s.api('POST', `/transactions/${String(k2?.id)}/transfer-link`, { otherTxnId: k2?.id }))
        .status,
    ).toBe(422);
    expect(
      (
        await s.api('POST', `/transactions/${String(k2?.id)}/transfer-link`, {
          otherTxnId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(404);

    const unlink = await s.api('DELETE', `/transactions/${String(s1?.id)}/transfer-link`);
    expect(unlink.json.items.map((t: { isTransfer: boolean }) => t.isTransfer)).toEqual([
      false,
      false,
    ]);
    // Unlinking reverts each leg's category from the default Transfer category back to the
    // catch-all, not to whatever it was categorized before linking (A5) — the row is back in
    // the review queue to be filed, same as any other unconfirmed guess.
    expect(unlink.json.items.map((t: { reviewState: string }) => t.reviewState)).toEqual([
      'needs_review',
      'needs_review',
    ]);
    expect(await s.spent('2026-09', s.food.id)).toBe(0);
    expect((await s.api('DELETE', `/transactions/${String(s1?.id)}/transfer-link`)).status).toBe(
      409,
    );
    expect(
      (await s.api('DELETE', `/transactions/${crypto.randomUUID()}/transfer-link`)).status,
    ).toBe(404);
  });
});

describe('sync plumbing', () => {
  it('the live source sends credentials as a header and never leaks them in errors', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetcher = ((url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return Promise.resolve(
        new Response('{"accounts":[]}', { status: seen.length === 1 ? 200 : 403 }),
      );
    }) as typeof fetch;
    const src = httpSimpleFin('https://user:s3cret@bridge.simplefin.org/simplefin', fetcher);
    expect(await src.fetchAccounts(1_700_000_000)).toEqual({ accounts: [] });
    expect(seen[0]).toEqual({
      url: 'https://bridge.simplefin.org/simplefin/accounts?start-date=1700000000&pending=1',
      auth: `Basic ${btoa('user:s3cret')}`,
    });
    const err = await src.fetchAccounts(0).catch((e: Error) => e.message);
    expect(err).toBe('SimpleFIN refused the access URL (403)');
    expect(err).not.toContain('s3cret');

    const broken = httpSimpleFin('https://u:p@x.test/sf', (() =>
      Promise.reject(new Error('https://u:p@x.test'))) as typeof fetch);
    expect(await broken.fetchAccounts(0).catch((e: Error) => e.message)).toBe(
      'Could not reach SimpleFIN',
    );
    const html = httpSimpleFin('https://u:p@x.test/sf', (() =>
      Promise.resolve(new Response('<html>', { status: 200 }))) as typeof fetch);
    expect(await html.fetchAccounts(0).catch((e: Error) => e.message)).toBe(
      'SimpleFIN returned invalid JSON',
    );
    const down = httpSimpleFin('https://u:p@x.test/sf', (() =>
      Promise.resolve(new Response('', { status: 502 }))) as typeof fetch);
    expect(await down.fetchAccounts(0).catch((e: Error) => e.message)).toBe(
      'SimpleFIN returned 502',
    );
  });

  it('never falls back to mock data unless asked', () => {
    expect(sourceFromEnv({ ...env })).toBeNull();
    expect(sourceFromEnv({ ...env, SIMPLEFIN_MOCK: '1' })?.mode).toBe('mock');
    expect(
      sourceFromEnv({ ...env, SIMPLEFIN_MOCK: '1', SIMPLEFIN_ACCESS_URL: 'https://u:p@x.test/sf' })
        ?.mode,
    ).toBe('live');
  });

  it('routes: not connected → 409; status reports mode and runs', async () => {
    const s = await setup();
    expect((await s.api('POST', '/sync/run', {})).status).toBe(409);
    await runSync(env.DB, s.userId, fake([{ id: 'a', name: 'USAA Checking', txns: [] }]));
    const st = await s.api('GET', '/sync/status');
    expect(st.json.mode).toBe('off');
    expect(st.json.runs[0]).toMatchObject({ status: 'ok', accountsTouched: 1, errors: [] });
  });

  it('the cron syncs the configured owner, and does nothing when unconfigured', async () => {
    const s = await setup();
    const ctl = {} as ScheduledController;
    await scheduled(ctl, { ...env, SIMPLEFIN_MOCK: '1' });
    await scheduled(ctl, {
      ...env,
      SIMPLEFIN_MOCK: '1',
      SIMPLEFIN_OWNER_EMAIL: 'nobody@example.com',
    });
    expect((await s.api('GET', '/accounts')).json).toEqual([]);
    await scheduled(ctl, { ...env, SIMPLEFIN_MOCK: '1', SIMPLEFIN_OWNER_EMAIL: s.email });
    expect((await s.api('GET', '/accounts')).json).toHaveLength(7);
  });
});

describe('lone transfer legs', () => {
  it('a card payment whose other side has not arrived can be marked, stops counting, and can be undone', async () => {
    const s = await setup();
    const checking = fake([
      {
        id: 'chk',
        name: 'USAA Checking',
        txns: [{ id: 'c1', date: '2026-09-03', cents: 29_005, desc: 'APPLECARD GSBANK PAYMENT' }],
      },
    ]);
    await runSync(env.DB, s.userId, checking, { now: at('2026-09-04T20:00:00Z') });
    const id = String((await s.txns())[0]?.id);
    await s.api('PATCH', `/transactions/${id}`, { categoryId: s.food.id });
    expect(await s.spent('2026-09', s.food.id)).toBe(29_005);

    const marked = await s.api('POST', `/transactions/${id}/mark-transfer`);
    expect(marked.json).toMatchObject({
      isTransfer: true,
      transferPairId: null,
      reviewState: 'reviewed',
    });
    expect(await s.spent('2026-09', s.food.id)).toBe(0);
    expect((await s.api('POST', `/transactions/${id}/mark-transfer`)).status).toBe(409);

    const undone = await s.api('DELETE', `/transactions/${id}/transfer-link`);
    expect(undone.json.items[0]).toMatchObject({ isTransfer: false, reviewState: 'needs_review' });
    // As above: undoing the mark reverts the category from Transfer to the catch-all, not
    // back to "food" — the user picked "food" before marking, but marking overwrote it, and
    // undoing puts the row back in the review queue rather than guessing "food" was still right.
    expect(await s.spent('2026-09', s.food.id)).toBe(0);
    expect((await s.api('POST', `/transactions/${crypto.randomUUID()}/mark-transfer`)).status).toBe(
      404,
    );
  });
});
