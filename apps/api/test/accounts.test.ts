import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

describe('T17 accounts & snapshots', () => {
  it('creates a manual account and patches without resetting other fields', async () => {
    const u = await signedInUser();
    const created = await call('POST', '/accounts', {
      access: u.access,
      body: {
        name: 'Car loan',
        kind: 'loan',
        includeInBudget: false,
        expectedPaymentCents: 41_500,
        paymentDay: 15,
      },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      source: 'manual',
      includeInBudget: false,
      staleness: { stale: false },
    });

    const patched = await call('PATCH', `/accounts/${created.json.id}`, {
      access: u.access,
      body: { name: 'Honda loan' },
    });
    expect(patched.json).toMatchObject({
      name: 'Honda loan',
      includeInBudget: false,
      expectedPaymentCents: 41_500,
    });
  });

  it("returns 404 for another user's account", async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    const acct = await call('POST', '/accounts', {
      access: a.access,
      body: { name: 'House', kind: 'other' },
    });
    expect((await call('GET', `/accounts/${acct.json.id}`, { access: b.access })).status).toBe(404);
    expect(
      (
        await call('PATCH', `/accounts/${acct.json.id}`, {
          access: b.access,
          body: { name: 'mine' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('POST', `/accounts/${acct.json.id}/snapshots`, {
          access: b.access,
          body: { asOf: '2026-09-01', balanceCents: 1 },
        })
      ).status,
    ).toBe(404);
  });

  it('snapshots upsert by date and the newest sets the current balance', async () => {
    const u = await signedInUser();
    const acct = await call('POST', '/accounts', {
      access: u.access,
      body: { name: 'House', kind: 'other' },
    });
    const id = acct.json.id;
    const snap = (asOf: string, balanceCents: number) =>
      call('POST', `/accounts/${id}/snapshots`, { access: u.access, body: { asOf, balanceCents } });

    await snap('2026-09-01', 30_000_000);
    await snap('2026-06-01', 29_000_000); // older: must not become current
    expect((await call('GET', `/accounts/${id}`, { access: u.access })).json.balanceCents).toBe(
      30_000_000,
    );
    await snap('2026-09-01', 30_500_000); // same day: replaces
    const list = await call('GET', `/accounts/${id}/snapshots`, { access: u.access });
    expect(list.json).toEqual([
      { asOf: '2026-06-01', balanceCents: 29_000_000 },
      { asOf: '2026-09-01', balanceCents: 30_500_000 },
    ]);
    expect((await call('GET', `/accounts/${id}`, { access: u.access })).json.balanceCents).toBe(
      30_500_000,
    );
  });

  it('rejects float money', async () => {
    const u = await signedInUser();
    const acct = await call('POST', '/accounts', {
      access: u.access,
      body: { name: 'Cash', kind: 'depository' },
    });
    const res = await call('POST', `/accounts/${acct.json.id}/snapshots`, {
      access: u.access,
      body: { asOf: '2026-09-01', balanceCents: 100.5 },
    });
    expect(res.status).toBe(400);
  });
});

describe('T17 net worth', () => {
  it('interpolates between snapshots, flags inferred points, and liabilities reduce it', async () => {
    const u = await signedInUser();
    const house = await call('POST', '/accounts', {
      access: u.access,
      body: { name: 'House', kind: 'other' },
    });
    const loan = await call('POST', '/accounts', {
      access: u.access,
      body: { name: 'Mortgage', kind: 'loan' },
    });
    const snap = (id: string, asOf: string, balanceCents: number) =>
      call('POST', `/accounts/${id}/snapshots`, { access: u.access, body: { asOf, balanceCents } });
    await snap(house.json.id, '2026-09-01', 1_000_000);
    await snap(house.json.id, '2026-09-03', 1_100_000);
    await snap(loan.json.id, '2026-09-01', -400_000);
    await snap(loan.json.id, '2026-09-03', -400_000);

    const nw = await call('GET', '/networth?from=2026-09-01&to=2026-09-03', { access: u.access });
    expect(nw.status).toBe(200);
    expect(nw.json.points).toEqual([
      { date: '2026-09-01', netWorthCents: 600_000, inferred: false },
      { date: '2026-09-02', netWorthCents: 650_000, inferred: true },
      { date: '2026-09-03', netWorthCents: 700_000, inferred: false },
    ]);
  });

  it('starts at the first reported balance, not at a made-up $0', async () => {
    const u = await signedInUser();
    const empty = await call('GET', '/networth?from=2026-08-01&to=2026-08-03', {
      access: u.access,
    });
    expect(empty.json.points).toEqual([]);
    const a = await call('POST', '/accounts', {
      access: u.access,
      body: { name: 'Car', kind: 'other' },
    });
    await call('POST', `/accounts/${a.json.id}/snapshots`, {
      access: u.access,
      body: { asOf: '2026-08-02', balanceCents: 900_000 },
    });
    const nw = await call('GET', '/networth?from=2026-08-01&to=2026-08-03', { access: u.access });
    expect(nw.json.points.map((p: { date: string }) => p.date)).toEqual([
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('validates the range', async () => {
    const u = await signedInUser();
    expect((await call('GET', '/networth', { access: u.access })).status).toBe(400);
    expect(
      (await call('GET', '/networth?from=2026-09-03&to=2026-09-01', { access: u.access })).status,
    ).toBe(400);
  });
});
