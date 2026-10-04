import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { linkTransferStmts, upsertManualEventStmt, upsertManualRuleStmt } from '../src/db';
import { buildCashToPaydayProjection } from '../src/lib/cashToPayday';
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
  const checking = (await api('POST', '/accounts', { name: 'USAA Checking', kind: 'depository' }))
    .json;
  await api('POST', `/accounts/${checking.id}/snapshots`, {
    asOf: '2026-09-25',
    balanceCents: 200_000,
  });
  return { ...u, api, checking };
}

// Income transactions carry a negative amount_cents; a mortgage-style bill is positive.
const feed = () =>
  bridge([
    {
      id: 'chk',
      name: 'USAA Checking',
      reported: '2026-09-25',
      txns: [
        ['p1', '2026-07-20', -310_000, 'ACME CORP PAYROLL'],
        ['p2', '2026-08-05', -310_000, 'ACME CORP PAYROLL'],
        ['p3', '2026-08-20', -310_000, 'ACME CORP PAYROLL'],
        ['p4', '2026-09-05', -310_000, 'ACME CORP PAYROLL'],
        ['m1', '2026-06-27', 180_000, 'MORTGAGE SERVICING'],
        ['m2', '2026-07-27', 180_000, 'MORTGAGE SERVICING'],
        ['m3', '2026-08-27', 180_000, 'MORTGAGE SERVICING'],
      ],
    },
  ]);

describe('cash to payday', () => {
  it('suggests what sync found in cash, and projects only what the user adds', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, feed(), {
      now: new Date('2026-09-05T20:00:00Z'),
      since: '2026-06-01',
    });
    // Called directly with an explicit `today` — the GET route binds to the real wall clock,
    // which a date-sensitive test can't control.
    const project = () => buildCashToPaydayProjection(env.DB, s.userId, '2026-09-10', 200_000, 0);
    const before = await project();
    expect(before.points).toEqual([{ date: '2026-09-10', balanceCents: 200_000, label: 'Today' }]);
    expect(before.paySchedules).toEqual([]);
    expect(before.suggestions).toEqual([
      expect.objectContaining({
        merchant: 'ACME CORP PAYROLL',
        kind: 'income',
        amountCents: 310_000,
        cadence: 'semimonthly',
        anchorDays: [5, 20],
      }),
      expect.objectContaining({ merchant: 'MORTGAGE SERVICING', kind: 'expense' }),
    ]);

    // Added through the same statement the Surplus "Add" saves with.
    await env.DB.batch([
      upsertManualRuleStmt(
        s.userId,
        env.DB,
        'ACME CORP PAYROLL',
        'semimonthly',
        -310_000,
        '2026-09-18',
        [5, 20],
      ),
      upsertManualRuleStmt(
        s.userId,
        env.DB,
        'MORTGAGE SERVICING',
        'monthly',
        180_000,
        '2026-09-27',
      ),
    ]);
    const after = await project();
    expect(after.suggestions).toEqual([]);
    // Payday (09-18), the mortgage that follows it (09-27), then two more paydays through
    // the 3-paycheck horizon — the mortgage payment is real cash out; no card ever appears.
    expect(after.points).toEqual([
      { date: '2026-09-10', balanceCents: 200_000, label: 'Today' },
      { date: '2026-09-18', balanceCents: 510_000, label: 'ACME CORP PAYROLL' },
      { date: '2026-09-27', balanceCents: 330_000, label: 'MORTGAGE SERVICING' },
      { date: '2026-10-05', balanceCents: 640_000, label: 'ACME CORP PAYROLL' },
      { date: '2026-10-20', balanceCents: 950_000, label: 'ACME CORP PAYROLL' },
    ]);
  });

  it('a dismissed suggestion stays gone, and the page names its account', async () => {
    const s = await setup();
    // Pinned to a day the feed's series are current; on the wall clock they lapse.
    await runSync(env.DB, s.userId, feed(), {
      now: new Date('2026-09-10T20:00:00Z'),
      since: '2026-06-01',
    });
    const listed = (await s.api('GET', '/cash-to-payday')).json;
    const mortgage = listed.suggestions.find(
      (r: { merchant: string }) => r.merchant === 'MORTGAGE SERVICING',
    );
    expect(mortgage?.accountName).toBe('USAA Checking');
    await s.api('PATCH', '/me/settings', {
      dismissedPayMerchants: [{ merchant: 'MORTGAGE SERVICING', displayName: 'Mortgage' }],
    });
    const after = (await s.api('GET', '/cash-to-payday')).json;
    expect(after.suggestions.map((r: { merchant: string }) => r.merchant)).not.toContain(
      'MORTGAGE SERVICING',
    );
  });

  it('suggests nothing from an account outside the cash accounts', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, feed(), {
      now: new Date('2026-09-10T20:00:00Z'),
      since: '2026-06-01',
    });
    await s.api('PATCH', '/me/settings', { cashAccountIds: [s.checking.id] });
    expect((await s.api('GET', '/cash-to-payday')).json.suggestions).toEqual([]);
  });

  it('a plain empty settings default counts every budgeted depository account as cash', async () => {
    const s = await setup();
    const res = await s.api('GET', '/cash-to-payday');
    expect(res.json.cashAccounts).toEqual([{ id: s.checking.id, name: 'USAA Checking' }]);
    expect(res.json.cushionCents).toBe(50_000);
  });

  it('honours a configured cushion', async () => {
    const s = await setup();
    await s.api('PATCH', '/me/settings', { cushionCents: 50_000 });
    const res = await s.api('GET', '/cash-to-payday');
    expect(res.json.cushionCents).toBe(50_000);
    expect(res.json.freeToMoveCents).toBe(150_000); // 200,000 - 50,000, no events
  });
});

describe('hand-declared manual cash events (cold start, no transactions yet)', () => {
  it('projects a manually declared income and expense, and lists/removes them', async () => {
    const s = await setup();
    const income = (
      await s.api('POST', '/cash-to-payday/manual-events', {
        label: "Wife's paycheck",
        kind: 'income',
        amountCents: 250_000,
        cadence: 'monthly',
        anchorDate: '2020-01-01',
      })
    ).json;
    await s.api('POST', '/cash-to-payday/manual-events', {
      label: 'Car payment',
      kind: 'expense',
      amountCents: 40_000,
      cadence: 'monthly',
      anchorDate: '2020-01-01',
    });

    const list = (await s.api('GET', '/cash-to-payday/manual-events')).json;
    expect(list).toHaveLength(2);
    expect(list).toContainEqual(
      expect.objectContaining({ label: "Wife's paycheck", kind: 'income', amountCents: 250_000 }),
    );
    expect(list).toContainEqual(
      expect.objectContaining({ label: 'Car payment', kind: 'expense', amountCents: 40_000 }),
    );

    const projection = (await s.api('GET', '/cash-to-payday')).json;
    expect(projection.paySchedules).toContainEqual(
      expect.objectContaining({ displayName: "Wife's paycheck" }),
    );
    expect(projection.points.some((p: { label: string }) => p.label === 'Car payment')).toBe(true);

    const del = await s.api('DELETE', `/cash-to-payday/manual-events/${income.id}`);
    expect(del.status).toBe(204);
    const after = (await s.api('GET', '/cash-to-payday/manual-events')).json;
    expect(after).toHaveLength(1);
    expect(after[0].label).toBe('Car payment');
  });

  it('404s deleting an event that is not yours or does not exist', async () => {
    const s = await setup();
    const res = await s.api('DELETE', '/cash-to-payday/manual-events/not-real');
    expect(res.status).toBe(404);
  });

  describe('editing schedules from Surplus', () => {
    const declare = (s: Awaited<ReturnType<typeof setup>>, extra: object = {}) =>
      s.api('POST', '/cash-to-payday/manual-events', {
        label: 'Church payroll',
        kind: 'income',
        amountCents: 230_840,
        cadence: 'semimonthly',
        anchorDate: '2026-10-01',
        anchorDays: [15, 31],
        ...extra,
      });

    it('lists every schedule with its days, and a last-day pin survives', async () => {
      const s = await setup();
      await declare(s);
      const { schedules } = (await s.api('GET', '/cash-to-payday')).json;
      expect(schedules).toContainEqual(
        expect.objectContaining({
          displayName: 'Church payroll',
          kind: 'income',
          cadence: 'semimonthly',
          anchorDays: [15, 31],
          isHandAdded: true,
        }),
      );
    });

    it('a twice-a-month declaration needs its two days', async () => {
      const s = await setup();
      const res = await declare(s, { anchorDays: undefined });
      expect(res.status).toBe(400);
    });

    it('edits a hand-added schedule in place, name included', async () => {
      const s = await setup();
      const { id } = (await declare(s)).json;
      const put = await s.api('PUT', '/cash-to-payday/schedules', {
        id,
        kind: 'income',
        amountCents: 240_000,
        cadence: 'monthly',
        anchorDate: '2026-10-01',
        anchorDays: [31, 31],
        label: 'Payroll',
      });
      expect(put.status).toBe(200);
      const list = (await s.api('GET', '/cash-to-payday/manual-events')).json;
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual(
        expect.objectContaining({
          label: 'Payroll',
          amountCents: 240_000,
          cadence: 'monthly',
          anchorDays: [31, 31],
        }),
      );
    });

    it('404s editing a schedule that does not exist, and removing one', async () => {
      const s = await setup();
      const put = await s.api('PUT', '/cash-to-payday/schedules', {
        id: 'nope',
        kind: 'expense',
        amountCents: 100,
        cadence: 'weekly',
        anchorDate: '2026-10-01',
      });
      expect(put.status).toBe(404);
      expect((await s.api('DELETE', '/cash-to-payday/schedules/nope')).status).toBe(404);
    });

    it('takes a detected schedule over by merchant, then removes the manual copy', async () => {
      const s = await setup();
      const put = await s.api('PUT', '/cash-to-payday/schedules', {
        merchant: 'acme payroll',
        kind: 'income',
        amountCents: 300_000,
        cadence: 'semimonthly',
        anchorDate: '2026-10-01',
        anchorDays: [1, 15],
      });
      expect(put.status).toBe(200);
      const { schedules } = (await s.api('GET', '/cash-to-payday')).json;
      const row = schedules.find((r: { merchant: string }) => r.merchant === 'acme payroll');
      expect(row).toEqual(expect.objectContaining({ isHandAdded: false }));
      const del = await s.api(
        'DELETE',
        `/cash-to-payday/schedules/${encodeURIComponent(put.json.id)}`,
      );
      expect(del.status).toBe(204);
    });

    it('needs an id or a merchant', async () => {
      const s = await setup();
      const res = await s.api('PUT', '/cash-to-payday/schedules', {
        kind: 'expense',
        amountCents: 100,
        cadence: 'weekly',
        anchorDate: '2026-10-01',
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('Surplus counts every non-card dollar leaving checking (Caleb, 2026-10-04)', () => {
  const TODAY = '2026-09-20';
  const months = ['2026-07', '2026-08', '2026-09'];
  // Checking pays a synced loan, moves money to synced savings, and pays a card. Each pair
  // links as a transfer at sync.
  const feedWithTransfers = () =>
    bridge([
      {
        id: 'chk',
        name: 'USAA Checking',
        reported: '2026-09-25',
        txns: months.flatMap((m, i) => [
          [`l${i}`, `${m}-14`, 106_054, 'THECB LOAN PYMT'],
          [`s${i}`, `${m}-15`, 25_000, 'USAA FUNDS TRANSFER DB'],
          [`c${i}`, `${m}-10`, 80_000 + i * 13_117, 'CITI CARD PAYMENT'],
        ]) as [string, string, number, string][],
      },
      {
        id: 'loan',
        name: 'THECB Student Loan',
        reported: '2026-09-25',
        txns: months.map((m, i) => [`L${i}`, `${m}-14`, -106_054, 'PAYMENT RECEIVED']) as [
          string,
          string,
          number,
          string,
        ][],
      },
      {
        id: 'sav',
        name: 'USAA Savings',
        reported: '2026-09-25',
        txns: months.map((m, i) => [`S${i}`, `${m}-15`, -25_000, 'USAA FUNDS TRANSFER CR']) as [
          string,
          string,
          number,
          string,
        ][],
      },
      {
        id: 'citi',
        name: 'Citi Credit Card',
        reported: '2026-09-25',
        txns: months.map((m, i) => [
          `C${i}`,
          `${m}-10`,
          -(80_000 + i * 13_117),
          'PAYMENT THANK YOU',
        ]) as [string, string, number, string][],
      },
    ]);

  async function synced() {
    const s = await setup();
    await runSync(env.DB, s.userId, feedWithTransfers(), {
      now: new Date('2026-09-20T20:00:00Z'),
      since: '2026-06-01',
    });
    const accounts = (await s.api('GET', '/accounts')).json as {
      id: string;
      name: string;
      kind: string;
      source: string;
    }[];
    const id = (name: string) => accounts.find((a) => a.name === name && a.source !== 'manual')?.id;
    // Sync links the loan and card pairs itself; the savings pair is linked by hand in review.
    const idOf = async (sourceId: string) =>
      (
        await env.DB.prepare('SELECT id FROM txn WHERE user_id = ?1 AND source_id = ?2')
          .bind(s.userId, sourceId)
          .first<{ id: string }>()
      )?.id as string;
    for (const i of [0, 1, 2]) {
      await env.DB.batch(
        linkTransferStmts(s.userId, env.DB, await idOf(`s${i}`), await idOf(`S${i}`)),
      );
    }
    const txns = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM txn WHERE user_id = ?1 AND is_transfer = 1',
    )
      .bind(s.userId)
      .first<{ n: number }>();
    return { ...s, id, transfers: txns?.n ?? 0 };
  }

  it('suggests the loan payment and the savings transfer from checking, never the card payment', async () => {
    const s = await synced();
    expect(s.transfers).toBe(18); // every leg linked: the case that used to hide them
    await s.api('PATCH', '/me/settings', { cashAccountIds: [s.id('USAA Checking')] });
    await refreshRecurring(env.DB, s.userId, TODAY);
    const { suggestions } = await buildCashToPaydayProjection(env.DB, s.userId, TODAY, 0, 0);
    expect(suggestions.map((r: { merchant: string }) => r.merchant).sort()).toEqual([
      'THECB LOAN PYMT',
      'USAA FUNDS TRANSFER DB',
    ]);
  });

  it('a transfer between two cash accounts nets to nothing', async () => {
    const s = await synced();
    await s.api('PATCH', '/me/settings', {
      cashAccountIds: [s.id('USAA Checking'), s.id('USAA Savings')],
    });
    await refreshRecurring(env.DB, s.userId, TODAY);
    const { suggestions } = await buildCashToPaydayProjection(env.DB, s.userId, TODAY, 0, 0);
    expect(suggestions.map((r: { merchant: string }) => r.merchant)).toEqual(['THECB LOAN PYMT']);
  });

  it('a tagged loan rule on a transfer advances when its debit posts', async () => {
    const s = await synced();
    await env.DB.batch([
      upsertManualRuleStmt(s.userId, env.DB, 'THECB LOAN PYMT', 'monthly', 106_054, '2026-09-14'),
    ]);
    await refreshRecurring(env.DB, s.userId, TODAY);
    const row = await env.DB.prepare(
      "SELECT next_expected_date, status FROM recurring_series WHERE user_id = ?1 AND merchant_normalized = 'THECB LOAN PYMT'",
    )
      .bind(s.userId)
      .first();
    expect(row).toEqual({ next_expected_date: '2026-10-14', status: 'active' });
  });
});

describe('Surplus never drops a schedule whose date has passed', () => {
  it('a late mortgage still counts today; a hand-added paycheck walks on', async () => {
    const s = await setup();
    await env.DB.batch([
      upsertManualRuleStmt(
        s.userId,
        env.DB,
        'MORTGAGE SERVICING',
        'monthly',
        196_811,
        '2026-10-01',
      ),
    ]);
    await s.api('POST', '/cash-to-payday/manual-events', {
      label: 'Church payroll',
      kind: 'income',
      amountCents: 230_840,
      cadence: 'monthly',
      anchorDate: '2026-09-15',
    });
    // Months later, nothing has posted: the hand-added date is stale in the database.
    await env.DB.prepare(
      "UPDATE recurring_series SET next_expected_date = '2026-06-15' WHERE user_id = ?1 AND label IS NOT NULL",
    )
      .bind(s.userId)
      .run();
    const p = await buildCashToPaydayProjection(env.DB, s.userId, '2026-10-03', 200_000, 0);
    expect(p.points.slice(0, 3)).toEqual([
      { date: '2026-10-03', balanceCents: 200_000, label: 'Today' },
      { date: '2026-10-03', balanceCents: 3_189, label: 'MORTGAGE SERVICING' },
      { date: '2026-10-15', balanceCents: 234_029, label: 'Church payroll' },
    ]);
    expect(p.freeToMoveCents).toBe(3_189);
    expect(p.schedules.find((r) => r.isHandAdded)?.nextExpectedDate).toBe('2026-10-15');
  });

  it('refresh keeps a hand-added schedule current and never flags it missed', async () => {
    const s = await setup();
    await s.api('POST', '/cash-to-payday/manual-events', {
      label: 'Church payroll',
      kind: 'income',
      amountCents: 230_840,
      cadence: 'semimonthly',
      anchorDate: '2026-10-01',
      anchorDays: [15, 31],
    });
    await env.DB.prepare(
      "UPDATE recurring_series SET next_expected_date = '2026-06-15' WHERE user_id = ?1",
    )
      .bind(s.userId)
      .run();
    await refreshRecurring(env.DB, s.userId, '2026-10-04');
    const row = await env.DB.prepare(
      'SELECT next_expected_date, status FROM recurring_series WHERE user_id = ?1',
    )
      .bind(s.userId)
      .first<{ next_expected_date: string; status: string }>();
    expect(row?.status).toBe('active');
    expect(row?.next_expected_date).toBe('2026-10-15');
  });
});

describe('a suggestion already in Surplus under another name', () => {
  it('a suggestion that looks like a hand-added mortgage says so, and still shows', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, feed(), {
      now: new Date('2026-09-10T20:00:00Z'),
      since: '2026-06-01',
    });
    const names = async () =>
      (await buildCashToPaydayProjection(env.DB, s.userId, '2026-09-10', 0, 0)).suggestions.map(
        (r) => [r.merchant, r.likelySameAs],
      );
    expect(await names()).toContainEqual(['MORTGAGE SERVICING', null]);
    await env.DB.batch([
      upsertManualEventStmt(
        s.userId,
        env.DB,
        'hand1',
        'Mortgage',
        'monthly',
        180_000,
        '2026-09-27',
      ),
    ]);
    expect(await names()).toEqual([
      ['ACME CORP PAYROLL', null],
      ['MORTGAGE SERVICING', 'Mortgage'],
    ]);
  });
});
