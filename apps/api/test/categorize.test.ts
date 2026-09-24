import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const gas = (await api('POST', '/categories', { groupId: group.id, name: 'Gas' })).json;
  const home = (await api('POST', '/categories', { groupId: group.id, name: 'Home' })).json;
  const kids = (await api('POST', '/categories', { groupId: group.id, name: 'Kids' })).json;
  const card = (await api('POST', '/accounts', { name: 'USAA Credit', kind: 'credit' })).json;

  /** A synced row waiting in the review queue. */
  const queued = async (descriptor: string, merchant: string, amountCents = 4_000) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw, merchant_normalized,
         review_state, source, source_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, '2026-09-10', ?4, ?5, ?6, 'needs_review', 'simplefin', ?1, ?7, ?7)`,
    )
      .bind(id, u.userId, card.id, amountCents, descriptor, merchant, now)
      .run();
    return id;
  };
  const txn = async (id: string) => (await api('GET', `/transactions/${id}`)).json;
  /** The user picks a category for a queued row. */
  const pick = (id: string, categoryId: string) =>
    api('PATCH', `/transactions/${id}`, { categoryId, reviewState: 'reviewed' });
  return { ...u, api, gas, home, kids, card, queued, txn, pick };
}

describe('T25 categorisation', () => {
  it('memory pre-fills the queue with shrinkage: n=2 → 0.67, a flagged guess', async () => {
    const s = await setup();
    for (let i = 0; i < 2; i++) await s.pick(await s.queued('SHELL OIL 5741', 'Shell'), s.gas.id);
    const waiting = await s.txn(await s.queued('SHELL OIL 9999', 'Shell'));
    expect(waiting.suggestedCategoryId).toBeNull(); // not refreshed until something changes
    await s.pick(await s.queued('SHELL OIL 1', 'Shell'), s.gas.id); // n=3 → 0.75
    const after = await s.txn(waiting.id);
    expect(after.suggestedCategoryId).toBe(s.gas.id);
    expect(after.suggestionConfidence).toBeCloseTo(0.75, 10);
    expect(after.splits).toEqual([]); // a suggestion is never money
  });

  it('one observation is not enough to pre-fill', async () => {
    const s = await setup();
    const waiting = await s.queued('SHELL OIL 9999', 'Shell');
    await s.pick(await s.queued('SHELL OIL 1', 'Shell'), s.gas.id);
    expect((await s.txn(waiting)).suggestedCategoryId).toBeNull();
    expect((await s.txn(waiting)).suggestionConfidence).toBe(0.5);
  });

  it('Amazon Marketplace is never pre-filled, however consistent the history', async () => {
    const s = await setup();
    const waiting = await s.queued('AMZN Mktp US*2K1AB3CD4', 'Amazon Marketplace');
    for (let i = 0; i < 6; i++)
      await s.pick(await s.queued('AMZN Mktp US*X', 'Amazon Marketplace'), s.home.id);
    expect((await s.txn(waiting)).suggestedCategoryId).toBeNull();
    const m = await s.api('GET', `/merchants/${encodeURIComponent('Amazon Marketplace')}`);
    expect(m.json.topCategoryIds).toEqual([s.home.id]);
  });

  it('rules beat memory and pre-fill at 1.0', async () => {
    const s = await setup();
    for (let i = 0; i < 5; i++) await s.pick(await s.queued('QT 12', 'QuikTrip'), s.gas.id);
    const waiting = await s.queued('QT 99', 'QuikTrip');
    const rule = await s.api('POST', '/rules', {
      matchField: 'merchant',
      matchType: 'equals',
      matchValue: 'QuikTrip',
      categoryId: s.kids.id,
    });
    expect(rule.status).toBe(201);
    expect(await s.txn(waiting)).toMatchObject({
      suggestedCategoryId: s.kids.id,
      suggestionConfidence: 1,
      splits: [],
    });
    const del = await s.api('DELETE', `/rules/${rule.json.id}`);
    expect(del.status).toBe(204);
    expect((await s.txn(waiting)).suggestedCategoryId).toBe(s.gas.id);
    const audit = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE user_id = ?1 AND action LIKE 'rule.%' ORDER BY created_at",
    )
      .bind(s.userId)
      .all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toEqual(['rule.created', 'rule.deleted']);
  });

  it('rejects a broken regex and unknown categories', async () => {
    const s = await setup();
    const bad = await s.api('POST', '/rules', {
      matchField: 'descriptor',
      matchType: 'regex',
      matchValue: '(',
      categoryId: s.gas.id,
    });
    expect(bad.status).toBe(400);
    const other = await s.api('POST', '/rules', {
      matchField: 'merchant',
      matchType: 'equals',
      matchValue: 'X',
      categoryId: crypto.randomUUID(),
    });
    expect(other.status).toBe(400);
    expect((await s.api('GET', '/rules')).json).toEqual([]);
    expect((await s.api('DELETE', `/rules/${crypto.randomUUID()}`)).status).toBe(404);
  });

  it('accept all confident applies only ≥ 0.90 suggestions', async () => {
    const s = await setup();
    const qt = await s.queued('QT 1', 'QuikTrip', 3_210);
    await s.api('POST', '/rules', {
      matchField: 'merchant',
      matchType: 'equals',
      matchValue: 'QuikTrip',
      categoryId: s.gas.id,
    });
    for (let i = 0; i < 2; i++) await s.pick(await s.queued('SHELL', 'Shell'), s.gas.id);
    const shell = await s.queued('SHELL', 'Shell');
    await s.pick(await s.queued('SHELL', 'Shell'), s.gas.id); // shell guess at 0.75
    const res = await s.api('POST', '/transactions/bulk-accept', { minConfidence: 0.9 });
    expect(res.json.accepted).toEqual([qt]);
    expect(await s.txn(qt)).toMatchObject({
      reviewState: 'reviewed',
      splits: [{ categoryId: s.gas.id, amountCents: 3_210 }],
    });
    expect((await s.txn(shell)).reviewState).toBe('needs_review');
    // A swipe accepts a guess by id.
    const swipe = await s.api('POST', '/transactions/bulk-accept', { ids: [shell] });
    expect(swipe.json.accepted).toEqual([shell]);
    expect((await s.txn(shell)).splits).toHaveLength(1);
    expect((await s.api('POST', '/transactions/bulk-accept', { minConfidence: 0.5 })).status).toBe(
      400,
    );
  });

  it('a merchant rename applies to past transactions', async () => {
    const s = await setup();
    const id = await s.queued('APPLE.COM/BILL 866-712-7753 CA', 'Apple Services');
    const path = `/merchants/${encodeURIComponent('Apple Services')}`;
    const r = await s.api('PATCH', path, { displayName: 'iCloud' });
    expect(r.json.displayName).toBe('iCloud');
    expect((await s.txn(id)).merchantDisplay).toBe('iCloud');
  });
});

describe('T26 rule offers', () => {
  it('fires after exactly 3 identical categorisations and creates nothing by itself', async () => {
    const s = await setup();
    const offers = [];
    for (let i = 0; i < 3; i++) {
      offers.push((await s.pick(await s.queued('QT 1', 'QuikTrip'), s.gas.id)).json.ruleOffer);
    }
    expect(offers).toEqual([null, null, { merchant: 'QuikTrip', categoryId: s.gas.id }]);
    expect((await s.api('GET', '/rules')).json).toEqual([]);
  });

  it('"Not now" re-arms after 3 more; "No" suppresses permanently', async () => {
    const s = await setup();
    const run = async (n: number) => {
      const out = [];
      for (let i = 0; i < n; i++)
        out.push(
          (await s.pick(await s.queued('QT 1', 'QuikTrip'), s.gas.id)).json.ruleOffer !== null,
        );
      return out;
    };
    expect(await run(6)).toEqual([false, false, true, false, false, true]);
    const no = await s.api('PATCH', '/merchants/QuikTrip', { suppressRuleOffer: true });
    expect(no.json.suppressRuleOffer).toBe(true);
    expect(await run(6)).toEqual([false, false, false, false, false, false]);
  });

  it('a split breaks the streak; a rule that already covers the merchant means no offer', async () => {
    const s = await setup();
    await s.pick(await s.queued('QT 1', 'QuikTrip'), s.gas.id);
    await s.pick(await s.queued('QT 1', 'QuikTrip'), s.gas.id);
    const split = await s.queued('QT 1', 'QuikTrip', 1_000);
    await s.api('POST', `/transactions/${split}/splits`, {
      splits: [
        { categoryId: s.gas.id, amountCents: 600 },
        { categoryId: s.kids.id, amountCents: 400 },
      ],
    });
    expect((await s.pick(await s.queued('QT 1', 'QuikTrip'), s.gas.id)).json.ruleOffer).toBeNull();

    await s.api('POST', '/rules', {
      matchField: 'descriptor',
      matchType: 'contains',
      matchValue: 'QT',
      categoryId: s.home.id,
    });
    const offers = [];
    for (let i = 0; i < 4; i++)
      offers.push((await s.pick(await s.queued('QT 1', 'QuikTrip'), s.gas.id)).json.ruleOffer);
    expect(offers.every((o) => o === null)).toBe(true);
  });
});
