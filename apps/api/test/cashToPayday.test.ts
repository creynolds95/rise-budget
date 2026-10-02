import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { upsertManualRuleStmt } from '../src/db';
import { buildCashToPaydayProjection } from '../src/lib/cashToPayday';
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
    await runSync(env.DB, s.userId, feed(), { since: '2026-06-01' });
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
    await runSync(env.DB, s.userId, feed(), { since: '2026-06-01' });
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
