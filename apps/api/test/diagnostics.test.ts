import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { runHousekeeping } from '../src/backup/run';
import { centsToDecimal } from '../src/sync/mock';
import { runSync } from '../src/sync/run';
import type { SimpleFinSource } from '../src/sync/source';
import { call, signedInUser } from './helpers/http';

const at = (iso: string) => new Date(iso);
const sec = (date: string) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 18) / 1000;

interface T {
  id: string;
  date: string;
  cents: number;
  desc: string;
  pending?: boolean;
}

/** One made-up account in SimpleFIN's wire format. */
const bank = (txns: T[], balance = 100_000, errors: string[] = []): SimpleFinSource => ({
  mode: 'mock',
  fetchAccounts: () =>
    Promise.resolve({
      errors,
      accounts: [
        {
          org: { name: 'Fictional Savings Bank' },
          id: 'ACCT-000123456789',
          name: 'Everyday Checking Gold',
          currency: 'USD',
          balance: centsToDecimal(balance),
          'balance-date': sec('2026-09-20'),
          transactions: txns.map((t) => ({
            id: t.id,
            posted: t.pending ? 0 : sec(t.date),
            transacted_at: sec(t.date),
            amount: centsToDecimal(-t.cents),
            description: t.desc,
            ...(t.pending ? { pending: true } : {}),
          })),
        },
      ],
    }),
});

async function setup() {
  const u = await signedInUser();
  const api = (path: string) => call('GET', path, { access: u.access });
  return { ...u, api };
}

const STORE = 'MERCHANT-ONLY-IN-DESCRIPTOR';

describe('sync diagnostics log', () => {
  it('records pending → posted as one thread, with the reason', async () => {
    const s = await setup();
    await runSync(
      env.DB,
      s.userId,
      bank([{ id: 'p-1', date: '2026-09-18', cents: 5_037, desc: STORE, pending: true }]),
      { now: at('2026-09-18T20:00:00Z') },
    );
    await runSync(
      env.DB,
      s.userId,
      bank([{ id: 'q-1', date: '2026-09-19', cents: 5_000, desc: STORE }]),
      { now: at('2026-09-20T20:00:00Z') },
    );
    const snap = (await s.api('/diagnostics?days=60')).json;
    const events = snap.runs.flatMap((r: { events: unknown[] }) => r.events) as {
      kind: string;
      txn: string;
      wasPending: boolean | null;
      isPending: boolean | null;
      amountCents: number;
    }[];
    expect(events.map((e) => e.kind).sort()).toEqual(['insert', 'pending_to_posted']);
    const posted = events.find((e) => e.kind === 'pending_to_posted');
    expect(posted).toMatchObject({ wasPending: true, isPending: false, amountCents: 5_000 });

    const thread = (await s.api(`/diagnostics/transactions/${String(posted?.txn)}`)).json;
    expect(thread.txn).toMatchObject({ isPending: false, amountCents: 5_000 });
    expect(thread.history.map((h: { kind: string }) => h.kind).sort()).toEqual([
      'insert',
      'pending_to_posted',
    ]);
  });

  it('keeps every balance the bank reported, with the pending rows sent alongside', async () => {
    const s = await setup();
    await runSync(
      env.DB,
      s.userId,
      bank([{ id: 'p-1', date: '2026-09-18', cents: 2_500, desc: STORE, pending: true }], 90_000),
      { now: at('2026-09-18T20:00:00Z') },
    );
    const { balances } = (await s.api('/diagnostics?days=60')).json;
    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({
      account: 'acct-1',
      balanceCents: 90_000,
      sent: { txns: 1, pending: 1, pendingCents: 2_500 },
    });
  });

  it('flags a balance that moved while no row arrived', async () => {
    const s = await setup();
    await runSync(env.DB, s.userId, bank([], 100_000), { now: at('2026-09-18T20:00:00Z') });
    await runSync(env.DB, s.userId, bank([], 96_500), { now: at('2026-09-19T20:00:00Z') });
    const { signals } = (await s.api('/diagnostics?days=60')).json;
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ account: 'acct-1', kind: 'balance_moved_without_rows' });
    expect(signals[0].message).toContain('-3500');
  });

  it('records a pending row dropped after 14 days and a bank row skipped as deleted', async () => {
    const s = await setup();
    await runSync(
      env.DB,
      s.userId,
      bank([{ id: 'p-1', date: '2026-09-01', cents: 1_000, desc: STORE, pending: true }]),
      { now: at('2026-09-01T20:00:00Z') },
    );
    await runSync(env.DB, s.userId, bank([]), { now: at('2026-09-20T20:00:00Z') });
    const { runs } = (await s.api('/diagnostics?days=60')).json;
    const kinds = runs.flatMap((r: { events: { kind: string }[] }) => r.events.map((e) => e.kind));
    expect(kinds).toContain('drop');
    const last = runs[0].accounts[0];
    expect(last).toMatchObject({ dropped: 1 });
  });

  it('masks names, institutions, account numbers and merchants everywhere', async () => {
    const s = await setup();
    await runSync(
      env.DB,
      s.userId,
      bank([{ id: 'p-1', date: '2026-09-18', cents: 5_037, desc: STORE, pending: true }], 100_000, [
        'Connection to Fictional Savings Bank may need attention (000123456789)',
      ]),
      { now: at('2026-09-18T20:00:00Z') },
    );
    const text = JSON.stringify((await s.api('/diagnostics/export?days=60')).json);
    for (const secret of [
      'Fictional',
      'Everyday Checking',
      '000123456789',
      'ACCT-000123',
      STORE,
      'Savings Bank',
    ])
      expect(text).not.toContain(secret);
    expect(text).toContain('Bank A');
    expect(text).toContain('[name]');
  });

  it("never shows another user's rows", async () => {
    const a = await setup();
    const b = await setup();
    await runSync(
      env.DB,
      a.userId,
      bank([{ id: 'p-1', date: '2026-09-18', cents: 1_234, desc: STORE }]),
      { now: at('2026-09-18T20:00:00Z') },
    );
    const mine = (await a.api('/diagnostics?days=60')).json;
    const id = mine.runs[0].events[0].txn as string;
    expect((await a.api(`/diagnostics/transactions/${id}`)).status).toBe(200);
    expect((await b.api(`/diagnostics/transactions/${id}`)).status).toBe(404);
    expect((await b.api('/diagnostics?days=60')).json.runs).toEqual([]);
    expect((await b.api('/diagnostics?days=60')).json.balances).toEqual([]);
  });

  it('needs a sign-in', async () => {
    expect((await call('GET', '/diagnostics')).status).toBe(401);
  });

  it('nightly housekeeping prunes the log past its retention', async () => {
    const s = await setup();
    await runSync(
      env.DB,
      s.userId,
      bank([{ id: 'p-1', date: '2026-09-18', cents: 1_234, desc: STORE }]),
      { now: at('2026-09-18T20:00:00Z') },
    );
    const count = async (table: string) =>
      (
        await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`)
          .bind(s.userId)
          .first<{ n: number }>()
      )?.n;
    expect(await count('sync_event')).toBeGreaterThan(0);
    // The rows were written "now" (wall clock); run housekeeping far in the future.
    await runHousekeeping(env.DB, env.BACKUPS, new Date(Date.now() + 61 * 86_400_000));
    expect(await count('sync_event')).toBe(0);
    expect(await count('balance_observation')).toBe(0);
  });

  it('is offered to the Claude connector as read-only tools', async () => {
    const s = await setup();
    const on = await call('POST', '/connector', {
      access: s.access,
      headers: { 'x-step-up': s.stepUp },
    });
    const path = new URL(on.json.url as string).pathname.replace(/^\/api/, '');
    const rpc = (method: string, params?: unknown) =>
      call('POST', path, { body: { jsonrpc: '2.0', id: 1, method, params } });
    const tools = (await rpc('tools/list')).json.result.tools as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['sync_diagnostics', 'transaction_history']),
    );
    const res = (await rpc('tools/call', { name: 'sync_diagnostics', arguments: { days: '7' } }))
      .json.result;
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ windowDays: 7 });
  });
});
