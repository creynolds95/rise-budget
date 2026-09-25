import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const food = (await api('POST', '/categories', { groupId: group.id, name: 'Groceries' })).json;
  await api('PATCH', '/me/settings', { rollIncomeVariance: false });
  // Raising a plan needs income behind it (§2.6).
  for (const m of ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
    await api('PATCH', `/periods/${m}`, { expectedIncomeCents: 500_000 });
  const plan = (month: string, plannedCents: number, applyToFuture = false) =>
    api('PATCH', `/allocations/${month}:${food.id}`, { plannedCents, applyToFuture });
  const planned = async (month: string) =>
    (await api('GET', `/periods/${month}`)).json.categories.find(
      (c: { categoryId: string }) => c.categoryId === food.id,
    ).plannedCents as number;
  return { ...u, api, food, plan, planned };
}

async function spend(userId: string, categoryId: string, amountCents: number, date: string) {
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
  ]);
}

describe('SPEC §2.9 apply to all future months', () => {
  it('this month only by default; later months stay at 0', async () => {
    const s = await setup();
    expect((await s.plan('2026-08', 40_000)).status).toBe(200);
    expect(await s.planned('2026-08')).toBe(40_000);
    expect(await s.planned('2026-09')).toBe(0);
  });

  it('makes the plan every later month’s, and leaves earlier months alone', async () => {
    const s = await setup();
    expect((await s.plan('2026-08', 40_000, true)).status).toBe(200);
    expect(await s.planned('2026-07')).toBe(0);
    expect(await s.planned('2026-08')).toBe(40_000);
    expect(await s.planned('2026-09')).toBe(40_000);
    expect(await s.planned('2026-11')).toBe(40_000);
    const cat = (await s.api('GET', `/categories/${s.food.id}`)).json;
    expect(cat).toMatchObject({ planDefaultCents: 40_000, planDefaultFrom: '2026-09' });
  });

  it('a later default never changes a month the old one covered', async () => {
    const s = await setup();
    await s.plan('2026-06', 30_000, true); // default 300 from July
    expect(await s.planned('2026-08')).toBe(30_000);
    await s.plan('2026-09', 50_000, true); // default 500 from October
    expect(await s.planned('2026-07')).toBe(30_000);
    expect(await s.planned('2026-08')).toBe(30_000);
    expect(await s.planned('2026-09')).toBe(50_000);
    expect(await s.planned('2026-10')).toBe(50_000);
  });

  it('overwrites plans already set for later months', async () => {
    const s = await setup();
    await s.plan('2026-10', 10_000);
    await s.plan('2026-09', 50_000, true);
    expect(await s.planned('2026-10')).toBe(50_000);
  });

  it('a plan edit on a month the default covers starts from the default', async () => {
    const s = await setup();
    await s.plan('2026-07', 30_000, true);
    // August has no row; lowering it must land at the new value, not default ± delta twice.
    await s.plan('2026-08', 20_000);
    expect(await s.planned('2026-08')).toBe(20_000);
    expect(await s.planned('2026-09')).toBe(30_000);
  });

  it('closing a month keeps the default on the next month’s new carry row', async () => {
    const s = await setup();
    await s.plan('2026-07', 40_000, true); // default from August
    await spend(s.userId, s.food.id, 10_000, '2026-07-12');
    // Months close in order; June exists because setup gave it income.
    expect((await s.api('POST', '/periods/2026-06/close', { override: true })).status).toBe(200);
    expect((await s.api('POST', '/periods/2026-07/close', { override: true })).status).toBe(200);
    const aug = (await s.api('GET', '/periods/2026-08')).json.categories.find(
      (c: { categoryId: string }) => c.categoryId === s.food.id,
    );
    expect(aug).toMatchObject({ carriedInCents: 30_000, plannedCents: 40_000 });
  });

  it('history reads the resolved plan', async () => {
    const s = await setup();
    await s.plan('2026-08', 40_000, true);
    const h = (await s.api('GET', `/categories/${s.food.id}/history?months=36`)).json as {
      periodId: string;
      plannedCents: number;
    }[];
    expect(h.find((r) => r.periodId === '2026-09')?.plannedCents).toBe(40_000);
    expect(h.find((r) => r.periodId === '2026-07')?.plannedCents).toBe(0);
  });
});

describe('SPEC §2.10 deleting a category', () => {
  it('is refused while the category holds money in an open month', async () => {
    const s = await setup();
    await s.plan('2026-09', 10_000);
    const r = await s.api('DELETE', `/categories/${s.food.id}`);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('CATEGORY_IN_USE');
  });

  it('is refused while it has spending in an open month', async () => {
    const s = await setup();
    await spend(s.userId, s.food.id, 1_200, '2026-09-03');
    expect((await s.api('DELETE', `/categories/${s.food.id}`)).status).toBe(409);
  });

  it('archives an empty category and removes its rules, audited', async () => {
    const s = await setup();
    await s.api('POST', '/rules', {
      matchField: 'merchant',
      matchType: 'equals',
      matchValue: 'ALDI',
      categoryId: s.food.id,
    });
    const r = await s.api('DELETE', `/categories/${s.food.id}`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ archived: s.food.id, rulesDeleted: 1, transactionsMoved: 0 });
    expect((await s.api('GET', '/categories')).json).toEqual([]);
    expect((await s.api('GET', '/rules')).json).toEqual([]);
    const audit = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE user_id = ?1 AND action = 'rule.deleted'",
    )
      .bind(s.userId)
      .all();
    expect(audit.results).toHaveLength(1);
  });
});

describe('category emoji', () => {
  it('sets and clears', async () => {
    const s = await setup();
    const set = await s.api('PATCH', `/categories/${s.food.id}`, { emoji: '🥕' });
    expect(set.json.emoji).toBe('🥕');
    const cleared = await s.api('PATCH', `/categories/${s.food.id}`, { emoji: null });
    expect(cleared.json.emoji).toBeNull();
  });
});
