import { env } from 'cloudflare:workers';
import { refreshAggregateStmts } from '../src/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const eat = (await api('POST', '/categories', { groupId: group.id, name: 'Eating out' })).json;
  const rent = (await api('POST', '/categories', { groupId: group.id, name: 'Rent', isBill: true }))
    .json;
  // Planned amounts need income behind them, or raises hit INSUFFICIENT_POOL.
  for (const m of ['2026-09', '2026-10', '2026-11', '2026-12'])
    await api('PATCH', `/periods/${m}`, { expectedIncomeCents: 500_000 });
  return { ...u, api, eat, rent };
}

async function spend(
  userId: string,
  categoryId: string,
  amountCents: number,
  date: string,
): Promise<string> {
  const db = env.DB;
  const acct = crypto.randomUUID();
  const txn = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO account (id, user_id, name, kind, source, created_at) VALUES (?1, ?2, 'Card', 'credit', 'manual', ?3)",
      )
      .bind(acct, userId, now),
    db
      .prepare(
        `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized,
           review_state, source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'X', 'X', 'reviewed', 'manual', ?6, ?6)`,
      )
      .bind(txn, userId, acct, date, amountCents, now),
    db
      .prepare(
        'INSERT INTO split (id, user_id, txn_id, category_id, amount_cents, period_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      )
      .bind(crypto.randomUUID(), userId, txn, categoryId, amountCents, date.slice(0, 7)),
    ...refreshAggregateStmts(userId, db, date.slice(0, 7)),
  ]);
  return txn;
}

type View = { categories: { categoryId: string; carriedInCents: number }[]; poolCents: number };
const carried = (view: View, id: string) =>
  view.categories.find((c) => c.categoryId === id)?.carriedInCents;

describe('live rollover', () => {
  // Most cases look back from after the months they test, so every month in them has ended.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-15T18:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('carries a rollover category both ways from October, and a non-rollover one not at all', async () => {
    const s = await setup();
    await s.api('PATCH', `/categories/${s.rent.id}`, { rolloverPolicy: 'return_to_pool' });
    await s.api('PATCH', `/allocations/2026-10:${s.eat.id}`, { plannedCents: 30_000 });
    await s.api('PATCH', `/allocations/2026-10:${s.rent.id}`, { plannedCents: 150_000 });
    await spend(s.userId, s.eat.id, 34_000, '2026-10-12');
    await spend(s.userId, s.rent.id, 145_000, '2026-10-01');

    const nov = (await s.api('GET', '/periods/2026-11')).json as View;
    expect(carried(nov, s.eat.id)).toBe(-4_000);
    expect(carried(nov, s.rent.id)).toBe(0);
    // Leftovers never feed the pool: November's pool is just its income less its plans.
    expect(nov.poolCents).toBe(500_000);
  });

  it('income never rolls: a month that earned more changes nothing about the next', async () => {
    const s = await setup();
    const before = ((await s.api('GET', '/periods/2026-11')).json as View).poolCents;
    await s.api('PATCH', '/periods/2026-10', { expectedIncomeCents: 900_000 });
    expect(((await s.api('GET', '/periods/2026-11')).json as View).poolCents).toBe(before);
  });

  it('there is nothing to close or recalculate', async () => {
    const s = await setup();
    expect((await s.api('POST', '/periods/2026-10/close', {})).status).toBe(404);
    expect((await s.api('POST', '/periods/2026-10/recalculate', {})).status).toBe(404);
  });

  it('months before October are history: nothing carries out of them', async () => {
    const s = await setup();
    await s.api('PATCH', `/allocations/2026-09:${s.eat.id}`, { plannedCents: 30_000 });
    await spend(s.userId, s.eat.id, 10_000, '2026-09-10');
    const sep = (await s.api('GET', '/periods/2026-09')).json as View;
    expect(carried(sep, s.eat.id)).toBe(0);
    expect(carried((await s.api('GET', '/periods/2026-10')).json, s.eat.id)).toBe(0);
  });

  it('a late recategorisation into a past month flows through every later month (edge 5)', async () => {
    const s = await setup();
    await s.api('PATCH', `/allocations/2026-10:${s.eat.id}`, { plannedCents: 30_000 });
    await s.api('PATCH', `/allocations/2026-11:${s.eat.id}`, { plannedCents: 30_000 });
    await spend(s.userId, s.eat.id, 25_000, '2026-10-10');
    // October leaves 5,000; November adds its own 30,000 plan, unspent.
    expect(carried((await s.api('GET', '/periods/2026-12')).json, s.eat.id)).toBe(35_000);

    // $100 of October spending turns up in December; nothing was asked for or confirmed.
    await spend(s.userId, s.eat.id, 10_000, '2026-10-28');
    expect(carried((await s.api('GET', '/periods/2026-11')).json, s.eat.id)).toBe(-5_000);
    expect(carried((await s.api('GET', '/periods/2026-12')).json, s.eat.id)).toBe(25_000);
  });

  it('a month that has not ended rolls nothing forward', async () => {
    vi.setSystemTime(new Date('2026-11-10T18:00:00Z'));
    const s = await setup();
    await s.api('PATCH', `/allocations/2026-10:${s.eat.id}`, { plannedCents: 30_000 });
    await s.api('PATCH', `/allocations/2026-11:${s.eat.id}`, { plannedCents: 30_000 });
    await s.api('PATCH', `/allocations/2026-12:${s.eat.id}`, { plannedCents: 30_000 });
    await spend(s.userId, s.eat.id, 25_000, '2026-10-10');
    // October has ended: November gets its 5,000. November's unspent plan is not projected,
    // so December and January show October's carry, unchanged.
    expect(carried((await s.api('GET', '/periods/2026-11')).json, s.eat.id)).toBe(5_000);
    expect(carried((await s.api('GET', '/periods/2026-12')).json, s.eat.id)).toBe(5_000);
    expect(carried((await s.api('GET', '/periods/2027-01')).json, s.eat.id)).toBe(5_000);
  });

  it('changing the rollover policy applies to the whole chain', async () => {
    const s = await setup();
    await s.api('PATCH', `/allocations/2026-10:${s.eat.id}`, { plannedCents: 30_000 });
    expect(carried((await s.api('GET', '/periods/2026-11')).json, s.eat.id)).toBe(30_000);
    await s.api('PATCH', `/categories/${s.eat.id}`, { rolloverPolicy: 'return_to_pool' });
    expect(carried((await s.api('GET', '/periods/2026-11')).json, s.eat.id)).toBe(0);
  });

  it('plans stay editable in any month', async () => {
    const s = await setup();
    await spend(s.userId, s.eat.id, 1_000, '2026-10-02');
    const res = await s.api('PATCH', `/allocations/2026-10:${s.eat.id}`, { plannedCents: 5_000 });
    expect(res.status).toBe(200);
  });
});
