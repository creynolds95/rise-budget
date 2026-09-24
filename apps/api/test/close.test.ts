import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const eat = (await api('POST', '/categories', { groupId: group.id, name: 'Eating out' })).json;
  const rent = (await api('POST', '/categories', { groupId: group.id, name: 'Rent', isBill: true }))
    .json;
  // No paychecks are recorded in these tests, so keep income variance out of returned surplus.
  await api('PATCH', '/me/settings', { rollIncomeVariance: false });
  // Planned amounts need income behind them, or raises hit INSUFFICIENT_POOL.
  await api('PATCH', '/periods/2026-07', { expectedIncomeCents: 500_000 });
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
  ]);
  return txn;
}

const planned = (
  view: { categories: { categoryId: string; carriedInCents: number }[] },
  id: string,
) => view.categories.find((c) => c.categoryId === id)?.carriedInCents;

describe('T20 period close', () => {
  it('refuses a month that has not ended', async () => {
    const s = await setup();
    const future = await s.api('POST', '/periods/2099-01/close', {});
    expect(future.status).toBe(409);
    expect(future.json.error.code).toBe('PERIOD_NOT_ENDED');
  });

  it('with income variance on, a missing paycheck reduces returned surplus', async () => {
    const s = await setup();
    await s.api('PATCH', '/me/settings', { rollIncomeVariance: true });
    const res = await s.api('POST', '/periods/2026-07/close', {});
    expect(res.json.period.returnedSurplusCents).toBe(-500_000);
  });

  it('freezes carry into the next month; deficits carry, bill surplus returns to pool', async () => {
    const s = await setup();
    await s.api('PATCH', '/allocations/2026-07:' + s.eat.id, { plannedCents: 30_000 });
    await s.api('PATCH', '/allocations/2026-07:' + s.rent.id, { plannedCents: 150_000 });
    await spend(s.userId, s.eat.id, 34_000, '2026-07-12');
    await spend(s.userId, s.rent.id, 145_000, '2026-07-01');

    const res = await s.api('POST', '/periods/2026-07/close', {});
    expect(res.status).toBe(200);
    expect(res.json.period).toMatchObject({ status: 'closed', returnedSurplusCents: 5_000 });

    const aug = await s.api('GET', '/periods/2026-08');
    expect(planned(aug.json, s.eat.id)).toBe(-4_000);
    expect(planned(aug.json, s.rent.id)).toBe(0);
    // July's returned surplus feeds August's pool.
    expect(aug.json.poolCents).toBe(5_000);

    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?1 AND action = 'period.closed'",
    )
      .bind(s.userId)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('is idempotent: re-closing changes nothing', async () => {
    const s = await setup();
    await s.api('PATCH', '/allocations/2026-07:' + s.eat.id, { plannedCents: 10_000 });
    await s.api('POST', '/periods/2026-07/close', {});
    await spend(s.userId, s.eat.id, 9_000, '2026-07-20'); // arrives late
    const again = await s.api('POST', '/periods/2026-07/close', {});
    expect(again.json.alreadyClosed).toBe(true);
    expect(planned((await s.api('GET', '/periods/2026-08')).json, s.eat.id)).toBe(10_000);
  });

  it('changing policy after close leaves history unchanged (edge 6)', async () => {
    const s = await setup();
    await s.api('PATCH', '/allocations/2026-07:' + s.rent.id, { plannedCents: 100_000 });
    await s.api('POST', '/periods/2026-07/close', {});
    await s.api('PATCH', `/categories/${s.rent.id}`, { rolloverPolicy: 'roll' });
    const jul = await s.api('GET', '/periods/2026-07');
    expect(jul.json.period.returnedSurplusCents).toBe(100_000);
    expect(planned((await s.api('GET', '/periods/2026-08')).json, s.rent.id)).toBe(0);
  });

  it('waits on accounts that have not reported past month end, naming them; override allowed (edge 10c)', async () => {
    const s = await setup();
    await env.DB.prepare(
      `INSERT INTO account (id, user_id, name, kind, source, include_in_budget, sync_cadence_hours, last_synced_at, created_at)
       VALUES (?1, ?2, 'Apple Card', 'credit', 'simplefin', 1, 720, '2026-07-20T12:00:00Z', ?3)`,
    )
      .bind(crypto.randomUUID(), s.userId, new Date().toISOString())
      .run();
    const view = await s.api('GET', '/periods/2026-07');
    expect(view.json.close).toMatchObject({
      ended: true,
      readiness: { ready: false, waitingOn: [{ name: 'Apple Card' }] },
    });

    const blocked = await s.api('POST', '/periods/2026-07/close', {});
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe('PERIOD_NOT_READY');
    expect(blocked.json.error.detail.waitingOn[0]).toMatchObject({
      name: 'Apple Card',
      lastSyncedDate: '2026-07-20',
    });

    const forced = await s.api('POST', '/periods/2026-07/close', { override: true });
    expect(forced.json.period.status).toBe('closed');
  });

  it('closes months in order', async () => {
    const s = await setup();
    await s.api('PATCH', '/periods/2026-06', { expectedIncomeCents: 500_000 });
    const out = await s.api('POST', '/periods/2026-07/close', {});
    expect(out.status).toBe(409);
    expect(out.json.error.message).toContain('2026-06');
  });

  // H2: a month nobody ever set income or a plan for has no `period` row at all, but a synced
  // charge can still land in it. Closing past it must not skip it, and it must still be
  // closeable afterward — not locked out because the month after it is already closed.
  it('blocks closing past an untouched month that still has real spending', async () => {
    const s = await setup();
    await spend(s.userId, s.eat.id, 2_000, '2026-06-15');
    const blocked = await s.api('POST', '/periods/2026-07/close', {});
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.message).toContain('2026-06');

    const june = await s.api('POST', '/periods/2026-06/close', {});
    expect(june.status).toBe(200);
    expect(june.json.alreadyClosed).toBe(false);
    const july = await s.api('POST', '/periods/2026-07/close', {});
    expect(july.status).toBe(200);
  });

  it('lets close skip past a month with truly nothing in it', async () => {
    const s = await setup();
    const out = await s.api('POST', '/periods/2026-07/close', {});
    expect(out.status).toBe(200);
    // June was never touched and never closed — that's fine, since it never had anything in it.
    expect((await s.api('GET', '/periods/2026-06')).json.period.status).toBe('open');
  });
});

describe('T20 recalculate', () => {
  it('re-closes the flagged month and cascades through later closed months, only when asked', async () => {
    const s = await setup();
    await s.api('PATCH', '/periods/2026-06', { expectedIncomeCents: 500_000 });
    for (const p of ['2026-06', '2026-07']) {
      await s.api('PATCH', `/allocations/${p}:${s.eat.id}`, { plannedCents: 30_000 });
    }
    await spend(s.userId, s.eat.id, 25_000, '2026-06-10');
    await spend(s.userId, s.eat.id, 30_000, '2026-07-10');
    await s.api('POST', '/periods/2026-06/close', {});
    await s.api('POST', '/periods/2026-07/close', {});
    expect(planned((await s.api('GET', '/periods/2026-08')).json, s.eat.id)).toBe(5_000);

    // $100 of June spending arrives after June closed; flagged, nothing recalculated.
    await spend(s.userId, s.eat.id, 10_000, '2026-06-28');
    await env.DB.prepare(
      "UPDATE period SET needs_recalc = 1, recalc_delta_cents = 10000 WHERE user_id = ?1 AND id = '2026-06'",
    )
      .bind(s.userId)
      .run();
    expect(planned((await s.api('GET', '/periods/2026-08')).json, s.eat.id)).toBe(5_000);

    const r = await s.api('POST', '/periods/2026-06/recalculate');
    expect(r.status).toBe(200);
    expect(r.json.recalculated).toEqual(['2026-06', '2026-07']);
    // June now carries −5000 into July; July: −5000 + 30000 − 30000 = −5000 into August.
    expect(planned((await s.api('GET', '/periods/2026-07')).json, s.eat.id)).toBe(-5_000);
    expect(planned((await s.api('GET', '/periods/2026-08')).json, s.eat.id)).toBe(-5_000);
    expect((await s.api('GET', '/periods/2026-06')).json.period).toMatchObject({
      needsRecalc: false,
      recalcDeltaCents: 0,
    });
  });

  it('"leave as is" clears the flag and keeps frozen numbers', async () => {
    const s = await setup();
    await s.api('POST', '/periods/2026-07/close', {});
    await env.DB.prepare(
      "UPDATE period SET needs_recalc = 1, recalc_delta_cents = 500 WHERE user_id = ?1 AND id = '2026-07'",
    )
      .bind(s.userId)
      .run();
    const res = await s.api('POST', '/periods/2026-07/dismiss-recalc');
    expect(res.json.period).toMatchObject({
      status: 'closed',
      needsRecalc: false,
      recalcDeltaCents: 0,
    });
  });

  it('refuses to recalculate an open month', async () => {
    const s = await setup();
    expect((await s.api('POST', '/periods/2026-07/recalculate')).status).toBe(409);
  });
});

describe('M1/M2 late edits to closed months', () => {
  it('editing expected income after close flags needsRecalc (M1)', async () => {
    const s = await setup();
    await s.api('POST', '/periods/2026-07/close', {});
    await s.api('PATCH', '/periods/2026-07', { expectedIncomeCents: 600_000 });
    const jul = await s.api('GET', '/periods/2026-07');
    expect(jul.json.period).toMatchObject({
      status: 'closed',
      needsRecalc: true,
      recalcDeltaCents: 100_000,
    });
  });

  it('a net-zero recategorization in a closed month still flags needsRecalc (M2)', async () => {
    const s = await setup();
    const txn = await spend(s.userId, s.eat.id, 5_000, '2026-07-10');
    await s.api('POST', '/periods/2026-07/close', {});
    const res = await s.api('PATCH', `/transactions/${txn}`, { categoryId: s.rent.id });
    expect(res.status).toBe(200);
    const jul = await s.api('GET', '/periods/2026-07');
    expect(jul.json.period).toMatchObject({
      status: 'closed',
      needsRecalc: true,
      recalcDeltaCents: 0,
    });
  });

  it('moving a transaction into another closed month flags both sides (M1)', async () => {
    const s = await setup();
    await s.api('POST', '/periods/2026-06/close', {});
    await s.api('POST', '/periods/2026-07/close', {});
    const txn = await spend(s.userId, s.eat.id, 5_000, '2026-06-10');

    const res = await s.api('PATCH', `/transactions/${txn}`, { postedAt: '2026-07-15' });
    expect(res.status).toBe(200);
    expect(res.json.postedAt).toBe('2026-07-15');

    const june = await s.api('GET', '/periods/2026-06');
    const july = await s.api('GET', '/periods/2026-07');
    expect(june.json.period).toMatchObject({ needsRecalc: true, recalcDeltaCents: -5_000 });
    expect(july.json.period).toMatchObject({ needsRecalc: true, recalcDeltaCents: 5_000 });
  });

  it('moving a transaction within the same month does not flag anything', async () => {
    const s = await setup();
    await s.api('POST', '/periods/2026-07/close', {});
    const txn = await spend(s.userId, s.eat.id, 5_000, '2026-07-10');
    const res = await s.api('PATCH', `/transactions/${txn}`, { postedAt: '2026-07-20' });
    expect(res.status).toBe(200);
    const jul = await s.api('GET', '/periods/2026-07');
    expect(jul.json.period).toMatchObject({ needsRecalc: false, recalcDeltaCents: 0 });
  });
});
