import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { refreshRecurring } from '../src/lib/recurring';
import { centsToDecimal } from '../src/sync/mock';
import { runSync } from '../src/sync/run';
import type { SimpleFinSource } from '../src/sync/source';
import { call, signedInUser } from './helpers/http';

const sec = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 18) / 1000;

function bridge(
  accounts: {
    id: string;
    name: string;
    reported: string;
    txns: [string, string, number, string][];
  }[],
): SimpleFinSource {
  return {
    mode: 'mock',
    fetchAccounts: () =>
      Promise.resolve({
        accounts: accounts.map((a) => ({
          org: { name: 'Bank' },
          id: a.id,
          name: a.name,
          currency: 'USD',
          balance: '0.00',
          'balance-date': sec(a.reported),
          transactions: a.txns.map(([id, date, cents, desc]) => ({
            id,
            posted: sec(date),
            amount: centsToDecimal(-cents),
            description: desc,
          })),
        })),
      }),
  };
}

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const group = (await api('POST', '/category-groups', { name: 'Bills', kind: 'expense' })).json;
  const subs = (
    await api('POST', '/categories', { groupId: group.id, name: 'Subscriptions', isBill: true })
  ).json;
  return { ...u, api, subs };
}

const netflix = (extra: [string, string, number, string][] = []) =>
  bridge([
    {
      id: 'chase',
      name: 'Chase Credit',
      reported: '2026-08-20',
      txns: [
        ['n6', '2026-06-07', 1_549, 'NETFLIX.COM LOS GATOS CA'],
        ['n7', '2026-07-07', 1_549, 'NETFLIX.COM LOS GATOS CA'],
        ['n8', '2026-08-08', 1_549, 'NETFLIX.COM LOS GATOS CA'],
        ['k1', '2026-07-02', 4_210, 'KROGER #512'],
        ['k2', '2026-07-19', 2_210, 'KROGER #512'],
        ['k3', '2026-08-11', 8_950, 'KROGER #512'],
        ...extra,
      ],
    },
  ]);

describe('T31 recurring detection', () => {
  it('sync detects a monthly series from 3 charges and predicts the next', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, netflix(), {
      now: new Date('2026-08-20T20:00:00Z'),
      since: '2026-06-01',
    });
    const list = (await s.api('GET', '/recurring')).json;
    expect(list).toEqual([
      expect.objectContaining({
        merchantNormalized: 'Netflix',
        cadence: 'monthly',
        expectedAmountCents: 1_549,
        nextExpectedDate: '2026-09-07',
        status: 'active',
        categoryId: null,
      }),
    ]);
  });

  it('an established category carries over and feeds typical_post_day', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, netflix(), {
      now: new Date('2026-08-20T20:00:00Z'),
      since: '2026-06-01',
    });
    const rows = (await s.api('GET', '/transactions?q=NETFLIX')).json.items as { id: string }[];
    for (const t of rows.slice(0, 2))
      await s.api('PATCH', `/transactions/${t.id}`, { categoryId: s.subs.id });
    await refreshRecurring(env.DB, s.userId, '2026-08-20');
    expect((await s.api('GET', '/recurring')).json[0].categoryId).toBe(s.subs.id);
    const cat = (await s.api('GET', '/categories')).json.find(
      (c: { id: string }) => c.id === s.subs.id,
    );
    expect(cat.typicalPostDay).toBe(7);
  });

  it('marks a series broken when the charge is more than 7 days late; a user-ended one stays ended', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, netflix(), {
      now: new Date('2026-08-20T20:00:00Z'),
      since: '2026-06-01',
    });
    await refreshRecurring(env.DB, s.userId, '2026-09-14');
    expect((await s.api('GET', '/recurring')).json[0].status).toBe('active');
    await refreshRecurring(env.DB, s.userId, '2026-09-15');
    expect((await s.api('GET', '/recurring')).json[0].status).toBe('broken');

    await env.DB.prepare("UPDATE recurring_series SET status = 'ended' WHERE user_id = ?1")
      .bind(s.userId)
      .run();
    await refreshRecurring(env.DB, s.userId, '2026-08-20');
    expect((await s.api('GET', '/recurring')).json[0].status).toBe('ended');
  });

  it('a series that stops fitting is still flagged once overdue', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, netflix(), {
      now: new Date('2026-08-20T20:00:00Z'),
      since: '2026-06-01',
    });
    // A one-off extra charge breaks the cadence, so detection no longer finds the series.
    await runSync(
      env.DB,
      s.userId,
      netflix([['nx', '2026-08-15', 1_549, 'NETFLIX.COM LOS GATOS CA']]),
      {
        now: new Date('2026-08-21T20:00:00Z'),
      },
    );
    await refreshRecurring(env.DB, s.userId, '2026-09-15');
    expect((await s.api('GET', '/recurring')).json[0]).toMatchObject({
      status: 'broken',
      nextExpectedDate: '2026-09-07',
    });
  });

  it('refresh route re-detects on demand', async () => {
    const s = await setup();
    const res = await s.api('POST', '/recurring/refresh');
    expect(res.status).toBe(200);
    expect(res.json).toEqual([]);
  });
});

describe('T32 late arrivals and close readiness through sync', () => {
  it('names the account a month is waiting on, from the bank’s own report dates (edge 10c)', async () => {
    const s = await setup();
    await runSync(
      env.DB,
      s.userId,
      bridge([
        { id: 'chk', name: 'USAA Checking', reported: '2026-09-02', txns: [] },
        { id: 'apple', name: 'Apple Card', reported: '2026-08-01', txns: [] },
        { id: 'sav', name: 'Apple Savings', reported: '2026-08-01', txns: [] },
      ]),
      { now: new Date('2026-09-02T20:00:00Z') },
    );
    const close = (await s.api('GET', '/periods/2026-08')).json.close;
    // Savings is out of the budget, so only the card holds the month open.
    expect(close.readiness).toMatchObject({
      ready: false,
      waitingOn: [{ name: 'Apple Card', lastSyncedDate: '2026-08-01' }],
    });

    await runSync(
      env.DB,
      s.userId,
      bridge([{ id: 'apple', name: 'Apple Card', reported: '2026-09-01', txns: [] }]),
      {
        now: new Date('2026-09-03T20:00:00Z'),
      },
    );
    expect((await s.api('GET', '/periods/2026-08')).json.close.readiness.ready).toBe(true);
  });

  it('a late split into a closed month flags it and recalculates nothing', async () => {
    const s = await setup();
    await s.api('PATCH', '/me/settings', { rollIncomeVariance: false });
    await s.api('POST', '/periods/2026-08/close', { override: true });
    await runSync(
      env.DB,
      s.userId,
      bridge([
        {
          id: 'chase',
          name: 'Chase Credit',
          reported: '2026-09-05',
          txns: [['late', '2026-08-30', 1_549, 'NETFLIX.COM']],
        },
      ]),
      { now: new Date('2026-09-05T20:00:00Z'), since: '2026-08-01' },
    );
    const before = (await s.api('GET', '/periods/2026-08')).json.period;
    expect(before).toMatchObject({ status: 'closed', needsRecalc: false }); // uncategorised: nothing counts yet
    const [t] = (await s.api('GET', '/transactions?q=NETFLIX')).json.items as { id: string }[];
    await s.api('PATCH', `/transactions/${String(t?.id)}`, { categoryId: s.subs.id });
    const after = (await s.api('GET', '/periods/2026-08')).json;
    expect(after.period).toMatchObject({
      status: 'closed',
      needsRecalc: true,
      recalcDeltaCents: 1_549,
    });
    expect(after.period.returnedSurplusCents).toBe(before.returnedSurplusCents);
  });
});
