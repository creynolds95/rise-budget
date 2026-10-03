import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { applyFollows } from '../src/lib/follow';
import { call, signedInUser } from './helpers/http';

type U = Awaited<ReturnType<typeof signedInUser>>;
const NOW = new Date('2026-10-10T18:00:00Z');

async function setup(u: U, match = 'apple gs') {
  const mk = async (name: string, kind: string) =>
    (await call('POST', '/accounts', { access: u.access, body: { name, kind } })).json.id as string;
  const checking = await mk('Checking', 'depository');
  const savings = await mk('Apple Savings', 'depository');
  await call('POST', `/accounts/${savings}/snapshots`, {
    access: u.access,
    body: { asOf: '2026-10-02', balanceCents: 500_000 },
  });
  await call('PATCH', '/me/settings', {
    access: u.access,
    body: { follow: { rules: [{ accountId: savings, match, since: '2026-10-05' }] } },
  });
  return { checking, savings };
}

const txn = (u: U, accountId: string, postedAt: string, amountCents: number, descriptor: string) =>
  call('POST', '/transactions', {
    access: u.access,
    body: { accountId, postedAt, amountCents, descriptor },
  });
const balance = async (u: U, id: string) =>
  (await call('GET', `/accounts/${id}`, { access: u.access })).json.balanceCents as number;
const log = async (u: U) =>
  (await call('GET', '/me', { access: u.access })).json.settings.follow.log as {
    txnId: string;
    undone: boolean;
  }[];

describe('follow transfers', () => {
  it('adds a matching transfer to the followed balance once, and leaves the row alone', async () => {
    const u = await signedInUser();
    const { checking, savings } = await setup(u);
    const t = await txn(u, checking, '2026-10-08', 100_000, 'APPLE GS SAVINGS TRANSFER');
    await txn(u, checking, '2026-10-08', 4_000, 'NETFLIX');

    expect(await applyFollows(env.DB, u.userId, NOW)).toBe(1);
    expect(await balance(u, savings)).toBe(600_000);
    expect(await applyFollows(env.DB, u.userId, NOW)).toBe(0);
    expect(await balance(u, savings)).toBe(600_000);

    const row = (await call('GET', `/transactions/${t.json.id}`, { access: u.access })).json;
    expect(row.isTransfer).toBeFalsy();
  });

  it('a transfer back out lowers it, and rows before the rule started are ignored', async () => {
    const u = await signedInUser();
    const { checking, savings } = await setup(u);
    await txn(u, checking, '2026-10-01', 90_000, 'APPLE GS SAVINGS TRANSFER');
    await txn(u, checking, '2026-10-09', -25_000, 'APPLE GS SAVINGS TRANSFER');
    expect(await applyFollows(env.DB, u.userId, NOW)).toBe(1);
    expect(await balance(u, savings)).toBe(475_000);
  });

  it('undo restores the balance and the row is never followed again', async () => {
    const u = await signedInUser();
    const { checking, savings } = await setup(u);
    const t = await txn(u, checking, '2026-10-08', 100_000, 'APPLE GS SAVINGS TRANSFER');
    await applyFollows(env.DB, u.userId, NOW);

    const res = await call('POST', `/accounts/${savings}/follow-undo`, {
      access: u.access,
      body: { txnId: t.json.id },
    });
    expect(res.status).toBe(200);
    expect(await balance(u, savings)).toBe(500_000);
    expect((await log(u))[0]?.undone).toBe(true);
    expect(await applyFollows(env.DB, u.userId, NOW)).toBe(0);
    expect(await balance(u, savings)).toBe(500_000);

    const again = await call('POST', `/accounts/${savings}/follow-undo`, {
      access: u.access,
      body: { txnId: t.json.id },
    });
    expect(again.status).toBe(404);
  });

  it('saving rules keeps the server-side log, and does nothing without rules', async () => {
    const u = await signedInUser();
    expect(await applyFollows(env.DB, u.userId, NOW)).toBe(0);
    const { checking, savings } = await setup(u);
    await txn(u, checking, '2026-10-08', 100_000, 'APPLE GS SAVINGS TRANSFER');
    await applyFollows(env.DB, u.userId, NOW);
    await call('PATCH', '/me/settings', {
      access: u.access,
      body: { follow: { rules: [{ accountId: savings, match: 'apple gs', since: '2026-10-05' }] } },
    });
    expect(await log(u)).toHaveLength(1);
  });

  it('skips a rule whose account is not a live manual asset account', async () => {
    const u = await signedInUser();
    const { checking, savings } = await setup(u);
    await call('POST', `/accounts/${savings}/archive`, { access: u.access, body: {} });
    await txn(u, checking, '2026-10-08', 100_000, 'APPLE GS SAVINGS TRANSFER');
    expect(await applyFollows(env.DB, u.userId, NOW)).toBe(0);
  });
});
