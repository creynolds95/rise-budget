import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
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
  it('projects paychecks in and real bills out, never a card payment', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, feed(), {
      now: new Date('2026-09-05T20:00:00Z'),
      since: '2026-06-01',
    });
    // Called directly with an explicit `today`, same as recurring.test.ts does for
    // refreshRecurring — the GET route binds to the real wall clock, which a date-sensitive
    // test can't control.
    const result = await buildCashToPaydayProjection(env.DB, s.userId, '2026-09-10', 200_000, 0);
    // Payday (09-18), the mortgage that follows it (09-27), then two more paydays through
    // the 3-paycheck horizon — the mortgage payment is real cash out; no card ever appears.
    expect(result.points).toEqual([
      { date: '2026-09-10', balanceCents: 200_000, label: 'Today' },
      { date: '2026-09-18', balanceCents: 510_000, label: 'ACME CORP PAYROLL' },
      { date: '2026-09-27', balanceCents: 330_000, label: 'MORTGAGE SERVICING' },
      { date: '2026-10-05', balanceCents: 640_000, label: 'ACME CORP PAYROLL' },
      { date: '2026-10-20', balanceCents: 950_000, label: 'ACME CORP PAYROLL' },
    ]);
    expect(result.lowestPoint).toEqual({
      date: '2026-09-10',
      balanceCents: 200_000,
      label: 'Today',
    });
    expect(result.paySchedules).toHaveLength(1);
    expect(result.paySchedules[0]).toMatchObject({
      merchant: 'ACME CORP PAYROLL',
      series: expect.objectContaining({ cadence: 'semimonthly', anchorDays: [5, 20] }),
    });
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
});
