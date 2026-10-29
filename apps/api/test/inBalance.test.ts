import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { upsertManualRuleStmt } from '../src/db';
import { trackBalanceSeen } from '../src/lib/balanceSeen';
import { buildCashToPaydayProjection } from '../src/lib/cashToPayday';
import { call, signedInUser } from './helpers/http';

const TODAY = '2026-10-14';

/** A cash account with a balance before the bills and one after, and the owner's bills. */
async function setup(before: number, after: number) {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const checking = (await api('POST', '/accounts', { name: 'Summit Checking', kind: 'depository' }))
    .json as { id: string };
  await api('POST', `/accounts/${checking.id}/snapshots`, {
    asOf: '2026-10-10',
    balanceCents: before,
  });
  await api('POST', `/accounts/${checking.id}/snapshots`, { asOf: TODAY, balanceCents: after });
  await api('PATCH', '/me/settings', { cashAccountIds: [checking.id] });
  await env.DB.batch([
    upsertManualRuleStmt(u.userId, env.DB, 'LOAN SERVICER PYMT', 'monthly', 106_054, TODAY),
    upsertManualRuleStmt(u.userId, env.DB, 'CORNER GYM', 'monthly', 33_100, TODAY),
    upsertManualRuleStmt(u.userId, env.DB, 'ACME CORP PAYROLL', 'monthly', -300_000, '2026-10-20'),
  ]);
  const project = (today = TODAY) =>
    buildCashToPaydayProjection(env.DB, u.userId, today, after, 0, [], [checking.id]);
  const rule = (merchant: string) =>
    env.DB.prepare(
      `SELECT id, balance_seen_due, balance_seen_on, balance_seen_twice, balance_lag_days
       FROM recurring_series WHERE user_id = ?1 AND merchant_normalized = ?2`,
    )
      .bind(u.userId, merchant)
      .first<{
        id: string;
        balance_seen_due: string | null;
        balance_seen_on: string | null;
        balance_seen_twice: number;
        balance_lag_days: number | null;
      }>();
  return { ...u, api, checking, project, rule };
}

const labels = (p: { points: { date: string; label: string }[] }, date: string) =>
  p.points.filter((x) => x.date === date).map((x) => x.label);

describe('Surplus reads bills the bank balance already took', () => {
  it('does not subtract bills the balance shows before their rows arrive', async () => {
    const s = await setup(232_670, 93_516);
    const p = await s.project();
    expect(labels(p, TODAY)).toEqual(['Today']);
    expect(p.freeToMoveCents).toBe(93_516);
    expect(
      p.schedules
        .filter((r) => r.inBalance)
        .map((r) => r.merchant)
        .sort(),
    ).toEqual(['CORNER GYM', 'LOAN SERVICER PYMT']);
  });

  it('still subtracts them when the balance has not moved', async () => {
    const s = await setup(232_670, 232_670);
    const p = await s.project();
    expect(labels(p, TODAY).sort()).toEqual(['CORNER GYM', 'LOAN SERVICER PYMT', 'Today']);
    expect(p.schedules.some((r) => r.inBalance)).toBe(false);
  });

  it('remembers what it saw, then learns the lag when the row comes', async () => {
    const s = await setup(232_670, 93_516);
    await trackBalanceSeen(env.DB, s.userId, TODAY);
    expect(await s.rule('LOAN SERVICER PYMT')).toMatchObject({
      balance_seen_due: TODAY,
      balance_seen_on: TODAY,
      balance_seen_twice: 0,
      balance_lag_days: null,
    });

    // Two days on, the loan's row lands and its rule moves to next month.
    const loan = await s.rule('LOAN SERVICER PYMT');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO txn (id, user_id, account_id, posted_at, amount_cents, descriptor_raw,
           merchant_normalized, source, source_id, created_at, updated_at)
         VALUES ('t-loan', ?1, ?2, '2026-10-16', 106054, 'LOAN SERVICER PYMT',
           'LOAN SERVICER PYMT', 'simplefin', 'sf-1', '2026-10-16T15:00:00Z', '2026-10-16T15:00:00Z')`,
      ).bind(s.userId, s.checking.id),
      env.DB.prepare(
        `UPDATE recurring_series SET next_expected_date = '2026-11-14' WHERE user_id = ?1 AND id = ?2`,
      ).bind(s.userId, loan?.id),
    ]);
    await trackBalanceSeen(env.DB, s.userId, '2026-10-16');
    expect(await s.rule('LOAN SERVICER PYMT')).toMatchObject({
      balance_seen_due: null,
      balance_seen_on: null,
      balance_lag_days: 2,
    });
    // The gym's row hasn't come: still waiting.
    expect(await s.rule('CORNER GYM')).toMatchObject({ balance_seen_due: TODAY });

    // Still nothing two weeks on: it is let go.
    await trackBalanceSeen(env.DB, s.userId, '2026-10-29');
    expect(await s.rule('CORNER GYM')).toMatchObject({ balance_seen_due: null });
  });

  it('records a bill the balance moved by twice', async () => {
    const s = await setup(232_670, 166_470);
    await trackBalanceSeen(env.DB, s.userId, TODAY);
    expect(await s.rule('CORNER GYM')).toMatchObject({ balance_seen_twice: 1 });
  });
});
