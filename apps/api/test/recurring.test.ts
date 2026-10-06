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

describe('idle cron syncs skip recurring re-detection', () => {
  it('only when nothing is new and a sync already ran today; manual syncs always run it', async () => {
    const s = await setup();
    const opts = { now: new Date('2026-08-20T20:00:00Z'), since: '2026-06-01' };
    const mark = async () => {
      await env.DB.prepare("UPDATE recurring_series SET updated_at = 'MARK' WHERE user_id = ?1")
        .bind(s.userId)
        .run();
    };
    const stamp = async () =>
      (
        await env.DB.prepare('SELECT updated_at FROM recurring_series WHERE user_id = ?1')
          .bind(s.userId)
          .first<{ updated_at: string }>()
      )?.updated_at;

    // The first run of the day has no earlier sync to lean on, so it always detects.
    await runSync(env.DB, s.userId, netflix(), { ...opts, skipRecurringWhenIdle: true });
    expect(await stamp()).not.toBe('MARK');

    await mark();
    await runSync(env.DB, s.userId, netflix(), { ...opts, skipRecurringWhenIdle: true });
    expect(await stamp()).toBe('MARK'); // idle: skipped

    await runSync(env.DB, s.userId, netflix(), opts); // manual
    expect(await stamp()).not.toBe('MARK');

    await mark();
    const fresh = netflix([['h1', '2026-08-19', 777, 'HULU 877-8244']]);
    await runSync(env.DB, s.userId, fresh, { ...opts, skipRecurringWhenIdle: true });
    expect(await stamp()).not.toBe('MARK'); // new rows: detected
  });
});

/** The card keeps reporting (groceries on Sep 12), so a missed Netflix there is knowable. */
const reportThrough = (userId: string, extra: [string, string, number, string][] = []) =>
  runSync(
    env.DB,
    userId as never,
    netflix([['k4', '2026-09-12', 3_100, 'KROGER #512'], ...extra]),
    {
      now: new Date('2026-09-14T20:00:00Z'),
    },
  );

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
      await s.api('PATCH', `/transactions/${t.id}`, {
        categoryId: s.subs.id,
        reviewState: 'reviewed',
      });
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
    await reportThrough(s.userId);
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
    await reportThrough(s.userId);
    await refreshRecurring(env.DB, s.userId, '2026-09-15');
    expect((await s.api('GET', '/recurring')).json[0]).toMatchObject({
      status: 'broken',
      nextExpectedDate: '2026-09-07',
    });
  });

  it("a miss on a card that hasn't reported past the due date isn't flagged (Apple Card)", async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, netflix(), {
      now: new Date('2026-08-20T20:00:00Z'),
      since: '2026-06-01',
    });
    await refreshRecurring(env.DB, s.userId, '2026-09-20');
    expect((await s.api('GET', '/recurring')).json[0].status).toBe('active');
  });

  it('a charge under a drifted name keeps the series quiet', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, netflix(), {
      now: new Date('2026-08-20T20:00:00Z'),
      since: '2026-06-01',
    });
    await reportThrough(s.userId, [['np', '2026-09-08', 1_549, 'NETFLIX PREMIUM']]);
    await refreshRecurring(env.DB, s.userId, '2026-09-20');
    const netflixRow = (await s.api('GET', '/recurring')).json.find(
      (r: { merchantNormalized: string }) => r.merchantNormalized === 'Netflix',
    );
    expect(netflixRow.status).toBe('active');
  });

  it('a series that missed two cycles lapses instead of nagging; a new charge revives it', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, netflix(), {
      now: new Date('2026-08-20T20:00:00Z'),
      since: '2026-06-01',
    });
    await reportThrough(s.userId);
    await refreshRecurring(env.DB, s.userId, '2026-10-15');
    expect((await s.api('GET', '/recurring')).json[0].status).toBe('broken');
    await refreshRecurring(env.DB, s.userId, '2026-10-16');
    expect((await s.api('GET', '/recurring')).json[0].status).toBe('lapsed');
  });

  it('"It ended" sticks through refresh; "Track again" hands it back', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, netflix(), {
      now: new Date('2026-08-20T20:00:00Z'),
      since: '2026-06-01',
    });
    await reportThrough(s.userId);
    await refreshRecurring(env.DB, s.userId, '2026-09-20');
    const [row] = (await s.api('GET', '/recurring')).json;
    const path = `/recurring/${encodeURIComponent(row.id)}`;
    expect((await s.api('PATCH', path, { status: 'ended' })).status).toBe(204);
    await refreshRecurring(env.DB, s.userId, '2026-09-20');
    expect((await s.api('GET', '/recurring')).json[0].status).toBe('ended');
    expect((await s.api('PATCH', path, { status: 'active' })).status).toBe(204);
    await refreshRecurring(env.DB, s.userId, '2026-09-20');
    expect((await s.api('GET', '/recurring')).json[0].status).toBe('broken');
    expect((await s.api('PATCH', '/recurring/nope', { status: 'ended' })).status).toBe(404);
    expect((await s.api('PATCH', path, { status: 'broken' })).status).toBe(400);
  });

  it('refresh route re-detects on demand', async () => {
    const s = await setup();
    const res = await s.api('POST', '/recurring/refresh');
    expect(res.status).toBe(200);
    expect(res.json).toEqual([]);
  });
});

describe('T32 late arrivals through sync', () => {
  it('a late split into a past month lands with a real category and changes that month only', async () => {
    const s = await setup();
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
    const [t] = (await s.api('GET', '/transactions?q=NETFLIX')).json.items as { id: string }[];
    // H1: it landed with a real (guessed) category already, so it is real money on arrival.
    const spent = async () => {
      const row = await env.DB.prepare(
        "SELECT COALESCE(SUM(spent_cents), 0) AS n FROM period_aggregate WHERE user_id = ?1 AND period_id = '2026-08'",
      )
        .bind(s.userId)
        .first<{ n: number }>();
      return row?.n;
    };
    expect(await spent()).toBe(1_549);
    await s.api('PATCH', `/transactions/${String(t?.id)}`, { categoryId: s.subs.id });
    // Correcting the category moves no money.
    expect(await spent()).toBe(1_549);
  });
});
