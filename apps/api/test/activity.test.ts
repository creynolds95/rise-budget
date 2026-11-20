import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { pruneOperational } from '../src/db';
import { centsToDecimal } from '../src/sync/mock';
import { runSync } from '../src/sync/run';
import type { SimpleFinSource } from '../src/sync/source';
import { call, signedInUser } from './helpers/http';

const sec = (date: string) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 18) / 1000;

const bank = (cents: number): SimpleFinSource => ({
  mode: 'mock',
  fetchAccounts: () =>
    Promise.resolve({
      errors: [],
      accounts: [
        {
          org: { name: 'Fictional Savings Bank' },
          id: 'ACCT-000123456789',
          name: 'Everyday Checking Gold',
          currency: 'USD',
          balance: centsToDecimal(100_000),
          'balance-date': sec('2026-09-20'),
          transactions: [
            {
              id: 't-1',
              posted: sec('2026-09-19'),
              transacted_at: sec('2026-09-19'),
              amount: centsToDecimal(-cents),
              description: 'MERCHANT-ONLY-IN-DESCRIPTOR',
            },
          ],
        },
      ],
    }),
});

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, ...(body === undefined ? {} : { body }) });
  await runSync(env.DB, u.userId, bank(5_000), { now: new Date('2026-09-20T20:00:00Z') });
  const txns = (await api('GET', '/transactions?limit=5')).json.items as { id: string }[];
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const home = (await api('POST', '/categories', { groupId: group.id, name: 'Home' })).json;
  return { ...u, api, txnId: txns[0]?.id as string, home };
}

describe('activity log', () => {
  it('records an edit with before/after, and never the text of a note', async () => {
    const s = await setup();
    const NOTE = 'private note about the gift';
    const r = await s.api('PATCH', `/transactions/${s.txnId}`, {
      categoryId: s.home.id,
      notes: NOTE,
    });
    expect(r.status).toBe(200);

    const rep = (await s.api('GET', '/diagnostics/activity?days=7&mode=detail')).json;
    const ev = rep.edits.events.find(
      (e: { action: string }) => e.action === 'PATCH /transactions/:id',
    );
    expect(ev).toMatchObject({ entity: 'txn', id: s.txnId, status: 200 });
    const fields = ev.changes.fields as { field: string; changed?: boolean; after?: string }[];
    expect(fields.find((f) => f.field === 'splits')?.after).toContain(s.home.id);
    expect(fields.find((f) => f.field === 'notes')).toMatchObject({
      changed: true,
      length: NOTE.length,
    });
    expect(JSON.stringify(rep)).not.toContain(NOTE);
    expect(JSON.stringify(rep)).not.toContain('MERCHANT-ONLY-IN-DESCRIPTOR');
    expect(JSON.stringify(rep)).not.toContain('000123456789');
  });

  it('records settings edits by key only, and counts them in the summary', async () => {
    const s = await setup();
    await s.api('PATCH', '/me/settings', { cushionCents: 12_345 });
    const rep = (await s.api('GET', '/diagnostics/activity?days=7&mode=detail')).json;
    const ev = rep.edits.events.find((e: { entity: string }) => e.entity === 'settings');
    expect(ev.changes.fields).toEqual([{ field: 'cushionCents', changed: true }]);
    expect(JSON.stringify(ev)).not.toContain('12345');
    const sum = (await s.api('GET', '/diagnostics/activity?days=7')).json;
    expect(sum.edits.events).toBeUndefined();
    expect(sum.edits.byAction.find((a: { entity: string }) => a.entity === 'settings').n).toBe(1);
  });

  it('records a failed edit with its status', async () => {
    const s = await setup();
    const r = await s.api('PATCH', '/transactions/does-not-exist', { notes: 'x' });
    expect(r.status).toBe(404);
    const rep = (await s.api('GET', '/diagnostics/activity?mode=detail')).json;
    expect(rep.edits.failed).toBe(1);
  });

  it('keeps per-run timing and the provider response on the sync', async () => {
    const s = await setup();
    const rep = (await s.api('GET', '/diagnostics/activity?days=7')).json;
    expect(rep.sync.runs).toBe(1);
    expect(rep.sync.runDuration.n).toBe(1);
    expect(rep.sync.accounts[0]).toMatchObject({
      account: 'acct-1',
      runs: 1,
      fetched: 1,
      inserted: 1,
    });
    expect(rep.sync.rowsByDay.some((d: { kind: string }) => d.kind === 'insert')).toBe(true);
  });

  it('aggregates API latency per route pattern, hourly', async () => {
    const s = await setup();
    await s.api('GET', '/accounts');
    await s.api('GET', '/accounts');
    const rep = (await s.api('GET', '/diagnostics/activity?days=1')).json;
    const row = rep.performance.api.find((p: { route: string }) => p.route === 'GET /api/accounts');
    expect(row.requests).toBeGreaterThanOrEqual(2);
  });

  it('takes browser timings as aggregates, and rejects junk', async () => {
    const s = await setup();
    const ok = await s.api('POST', '/diagnostics/client', {
      samples: [{ route: 'GET /transactions', n: 4, errors: 1, msTotal: 800, msMax: 400 }],
    });
    expect(ok.status).toBe(204);
    expect((await s.api('POST', '/diagnostics/client', { samples: [{ route: '' }] })).status).toBe(
      400,
    );
    const rep = (await s.api('GET', '/diagnostics/activity?days=1')).json;
    expect(rep.performance.client[0]).toMatchObject({
      requests: 4,
      errors: 1,
      avgMs: 200,
      maxMs: 400,
    });
    // The client report itself is not an "edit".
    expect(
      rep.edits.byAction.some((a: { action: string }) => a.action.includes('/diagnostics')),
    ).toBe(false);
  });

  it('is reachable read-only from the connector as review_activity', async () => {
    const s = await setup();
    const link = (
      await call('POST', '/connector', {
        access: s.access,
        headers: { 'x-step-up': s.stepUp },
      })
    ).json.url as string;
    const path = new URL(link).pathname.replace(/^\/api/, '');
    const rpc = (body: unknown) => call('POST', path, { body });
    const list = (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json;
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('review_activity');
    const res = (
      await rpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'review_activity', arguments: { days: 7 } },
      })
    ).json;
    expect(res.result.isError).toBe(false);
    expect(JSON.parse(res.result.content[0].text)).toMatchObject({
      mode: 'summary',
      windowDays: 7,
    });
  });

  it('rolls old detail into daily totals before pruning it', async () => {
    const s = await setup();
    const old = '2026-01-10T12:00:00.000Z';
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO activity_event (id, user_id, at, entity, action, status, ms) VALUES ('a1', ?1, ?2, 'txn', 'PATCH /transactions/:id', 200, 30), ('a2', ?1, ?2, 'txn', 'PATCH /transactions/:id', 500, 50)`,
      ).bind(s.userId, old),
      env.DB.prepare(
        `INSERT INTO sync_event (id, user_id, run_id, account_id, kind, amount_cents, created_at) VALUES ('s1', ?1, 'r', 'a', 'insert', -250, ?2)`,
      ).bind(s.userId, old),
      env.DB.prepare(
        `INSERT INTO perf_hour (hour, kind, route, requests, errors, ms_total, ms_max) VALUES ('2026-01-10T12', 'api', 'GET /api/x', 3, 1, 90, 60)`,
      ),
    ]);
    await pruneOperational(env.DB, new Date('2026-09-21T09:30:00Z'));
    const left = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM activity_event WHERE at < '2026-02-01') AS a,
              (SELECT COUNT(*) FROM sync_event WHERE created_at < '2026-02-01') AS s,
              (SELECT COUNT(*) FROM perf_hour WHERE hour < '2026-02') AS p`,
    ).first<{ a: number; s: number; p: number }>();
    expect(left).toEqual({ a: 0, s: 0, p: 0 });
    const days = (
      await env.DB.prepare(
        'SELECT stream, key, n, sum_a, sum_b, peak FROM log_day WHERE day = 20260110 ORDER BY stream',
      ).all()
    ).results;
    expect(days).toEqual([
      { stream: 'activity', key: 'txn', n: 2, sum_a: 80, sum_b: 1, peak: 50 },
      { stream: 'perf', key: 'api GET /api/x', n: 3, sum_a: 90, sum_b: 1, peak: 60 },
      { stream: 'sync_event', key: 'insert', n: 1, sum_a: 250, sum_b: 0, peak: 0 },
    ]);
  });
});
