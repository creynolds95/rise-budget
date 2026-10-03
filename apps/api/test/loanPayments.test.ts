import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { applyLoanPayments } from '../src/lib/loanPayments';
import { call, signedInUser } from './helpers/http';

type U = Awaited<ReturnType<typeof signedInUser>>;
const NOV_1 = new Date('2026-11-01T18:00:00Z');

async function setup(
  u: U,
  opts: { autoApply?: boolean; debitCents?: number | null; merchant?: string } = {},
) {
  const mk = async (name: string, kind: string) =>
    (await call('POST', '/accounts', { access: u.access, body: { name, kind } })).json.id as string;
  const checking = await mk('Checking', 'depository');
  const loanA = await mk('Fed 1-03', 'loan');
  const loanB = await mk('Fed 1-04', 'loan');
  for (const [id, owed] of [
    [loanA, 195_827],
    [loanB, 139_359],
  ] as const)
    await call('POST', `/accounts/${id}/snapshots`, {
      access: u.access,
      body: { asOf: '2026-10-02', balanceCents: -owed },
    });
  const loan = (accountId: string, paymentCents: number) => ({
    accountId,
    aprMilliPct: 3660,
    paymentCents,
    dueDay: 1,
    group: 'student',
    appliedThrough: '2026-10',
    merchant: opts.merchant ?? '',
  });
  await call('PATCH', '/me/settings', {
    access: u.access,
    body: {
      debt: {
        loans: [loan(loanA, 4_114), loan(loanB, 3_814)],
        autoApply: opts.autoApply ?? true,
      },
    },
  });
  if (opts.debitCents !== null)
    await call('POST', '/transactions', {
      access: u.access,
      body: {
        accountId: checking,
        postedAt: '2026-11-01',
        amountCents: opts.debitCents ?? 7_928,
        descriptor: 'MOHELA AUTOPAY',
      },
    });
  return { loanA, loanB };
}

const balance = async (u: U, id: string) =>
  (await call('GET', `/accounts/${id}`, { access: u.access })).json.balanceCents as number;
const debt = async (u: U) => (await call('GET', '/me', { access: u.access })).json.settings.debt;

describe('automatic monthly loan balances', () => {
  it('a debit equal to the loans’ total applies both, marks the month, and records it', async () => {
    const u = await signedInUser();
    const { loanA, loanB } = await setup(u);
    expect(await applyLoanPayments(env.DB, u.userId, NOV_1)).toBe(2);
    // $1,958.27 owed at 3.66%: + $5.97 interest − $41.14 payment
    expect(await balance(u, loanA)).toBe(-(195_827 + 597 - 4_114));
    expect(await balance(u, loanB)).toBe(-(139_359 + 425 - 3_814));
    const d = await debt(u);
    expect(d.loans.map((l: { appliedThrough: string }) => l.appliedThrough)).toEqual([
      '2026-11',
      '2026-11',
    ]);
    expect(d.lastAuto.period).toBe('2026-11');
    expect(d.lastAuto.loans).toHaveLength(2);
  });

  it('runs once: a second sync the same month changes nothing', async () => {
    const u = await signedInUser();
    const { loanA } = await setup(u);
    await applyLoanPayments(env.DB, u.userId, NOV_1);
    const after = await balance(u, loanA);
    expect(await applyLoanPayments(env.DB, u.userId, NOV_1)).toBe(0);
    expect(await balance(u, loanA)).toBe(after);
  });

  it('no matching debit means nothing changes and the month stays open', async () => {
    const u = await signedInUser();
    const { loanA } = await setup(u, { debitCents: 7_900 });
    expect(await applyLoanPayments(env.DB, u.userId, NOV_1)).toBe(0);
    expect(await balance(u, loanA)).toBe(-195_827);
    expect((await debt(u)).loans[0].appliedThrough).toBe('2026-10');
  });

  it('does nothing when the debit has not posted yet, or before the due day', async () => {
    const u = await signedInUser();
    await setup(u, { debitCents: null });
    expect(await applyLoanPayments(env.DB, u.userId, NOV_1)).toBe(0);
    expect(await applyLoanPayments(env.DB, u.userId, new Date('2026-10-31T18:00:00Z'))).toBe(0);
  });

  it('does nothing when the user turned it off', async () => {
    const u = await signedInUser();
    const { loanA } = await setup(u, { autoApply: false });
    expect(await applyLoanPayments(env.DB, u.userId, NOV_1)).toBe(0);
    expect(await balance(u, loanA)).toBe(-195_827);
  });

  it('does nothing without a debt plan', async () => {
    const u = await signedInUser();
    expect(await applyLoanPayments(env.DB, u.userId, NOV_1)).toBe(0);
  });

  it('with a debit name set, any amount from that merchant applies the plan payments', async () => {
    const u = await signedInUser();
    const { loanA } = await setup(u, { merchant: 'MOHELA', debitCents: 12_345 });
    expect(await applyLoanPayments(env.DB, u.userId, NOV_1)).toBe(2);
    expect(await balance(u, loanA)).toBe(-(195_827 + 597 - 4_114));
    const run = (await debt(u)).lastAuto;
    expect(run.debitCents).toBe(12_345);
    expect(run.plannedCents).toBe(7_928);
  });

  it('with a debit name set, a debit from another merchant applies nothing', async () => {
    const u = await signedInUser();
    await setup(u, { merchant: 'thecb', debitCents: 7_928 });
    expect(await applyLoanPayments(env.DB, u.userId, NOV_1)).toBe(0);
  });
});
