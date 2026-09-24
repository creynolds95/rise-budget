import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const eat = (await api('POST', '/categories', { groupId: group.id, name: 'Eating out' })).json;
  const card = (await api('POST', '/accounts', { name: 'Citi Credit', kind: 'credit' })).json;
  return { ...u, api, eat, card };
}

const thisMonth = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
})
  .format(new Date())
  .slice(0, 7);

async function carry(userId: string, categoryId: string, cents: number) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO period (id, user_id, status) VALUES (?1, ?2, 'open')",
    ).bind(thisMonth, userId),
    env.DB.prepare(
      `INSERT INTO allocation (id, user_id, period_id, category_id, planned_cents, carried_in_cents)
       VALUES (?1, ?2, ?3, ?4, 0, ?5)`,
    ).bind(`${thisMonth}:${categoryId}`, userId, thisMonth, categoryId, cents),
  ]);
}

describe('T42 forgiveness', () => {
  it('zeroes this month’s carried deficit only when the confirmed amount matches, with a reason', async () => {
    const s = await setup();
    await carry(s.userId, s.eat.id, -4_000);
    const path = `/categories/${s.eat.id}/forgive`;
    expect(
      (await s.api('POST', path, { amountCents: 3_999, reason: 'birthday' })).json.error.code,
    ).toBe('AMOUNT_MISMATCH');
    expect((await s.api('POST', path, { amountCents: 4_000, reason: ' ' })).status).toBe(400);
    const ok = await s.api('POST', path, { amountCents: 4_000, reason: 'birthday dinner' });
    expect(ok.json).toEqual({ periodId: thisMonth, forgivenCents: 4_000 });
    const view = (await s.api('GET', `/periods/${thisMonth}`)).json;
    expect(
      view.categories.find((c: { categoryId: string }) => c.categoryId === s.eat.id).carriedInCents,
    ).toBe(0);
    expect(
      (await s.api('POST', path, { amountCents: 4_000, reason: 'again' })).json.error.code,
    ).toBe('NOTHING_TO_FORGIVE');
    const audit = await env.DB.prepare(
      "SELECT detail_json FROM audit_log WHERE user_id = ?1 AND action = 'category.deficit_forgiven'",
    )
      .bind(s.userId)
      .first<{ detail_json: string }>();
    expect(JSON.parse(audit?.detail_json ?? '{}')).toMatchObject({
      amountCents: 4_000,
      reason: 'birthday dinner',
    });
    expect(
      (
        await s.api('POST', `/categories/${crypto.randomUUID()}/forgive`, {
          amountCents: 1,
          reason: 'x',
        })
      ).status,
    ).toBe(404);
  });
});

describe('T42 category history', () => {
  it('month by month plan, carry and spend, oldest first', async () => {
    const s = await setup();
    await s.api('PATCH', `/periods/${thisMonth}`, { expectedIncomeCents: 100_000 });
    await s.api('PATCH', `/allocations/${thisMonth}:${s.eat.id}`, { plannedCents: 30_000 });
    await s.api('POST', '/transactions', {
      accountId: s.card.id,
      postedAt: `${thisMonth}-01`,
      amountCents: 1_234,
      descriptor: 'CHIPOTLE',
      categoryId: s.eat.id,
    });
    const h = (await s.api('GET', `/categories/${s.eat.id}/history?months=3`)).json;
    expect(h).toHaveLength(3);
    expect(h[2]).toEqual({
      periodId: thisMonth,
      plannedCents: 30_000,
      carriedInCents: 0,
      spentCents: 1_234,
    });
    expect(h[0].spentCents).toBe(0);
    expect((await s.api('GET', `/categories/${s.eat.id}/history?months=999`)).json).toHaveLength(
      36,
    );
    expect((await s.api('GET', `/categories/${crypto.randomUUID()}/history`)).status).toBe(404);
  });
});

describe('T36 review queue', () => {
  it('lists what needs review with the merchant’s top categories, and recent drops', async () => {
    const s = await setup();
    const now = new Date().toISOString();
    const insert = (id: string, state: string, merchant: string) =>
      env.DB.prepare(
        `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized,
           review_state, source, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1000, ?5, ?5, ?6, 'simplefin', ?7, ?7)`,
      )
        .bind(id, s.userId, s.card.id, now.slice(0, 10), merchant, state, now)
        .run();
    const a = crypto.randomUUID();
    await insert(a, 'needs_review', 'Chipotle');
    await insert(crypto.randomUUID(), 'reviewed', 'Chipotle');
    await insert(crypto.randomUUID(), 'dropped', 'Shell');
    await s.api('PATCH', `/transactions/${a}`, { categoryId: s.eat.id });
    await insert(crypto.randomUUID(), 'needs_review', 'Chipotle');
    const q = (await s.api('GET', '/review/queue')).json;
    expect(q.count).toBe(2);
    expect(
      q.items.every((t: { topCategoryIds: string[] }) => t.topCategoryIds[0] === s.eat.id),
    ).toBe(true);
    expect(q.dropped).toHaveLength(1);
    // Fallback chips for unlearned merchants: the categories actually used lately.
    expect(q.frequentCategoryIds).toEqual([s.eat.id]);
  });
});
