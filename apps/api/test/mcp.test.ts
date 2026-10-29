import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
    call(method, path, { access: u.access, body, ...(headers ? { headers } : {}) });
  return { ...u, api };
}

/** Turn the connector on; the link's path, ready for `call`. */
async function turnOn(s: Awaited<ReturnType<typeof setup>>) {
  const res = await s.api('POST', '/connector', undefined, { 'x-step-up': s.stepUp });
  expect(res.status).toBe(201);
  return new URL(res.json.url as string).pathname.replace(/^\/api/, '');
}

/** `id: null` sends a notification (no id). */
const rpc = (path: string, method: string, params?: unknown, id: number | null = 1) =>
  call('POST', path, {
    body: id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params },
  });

describe('Claude connector (SPEC §12.3)', () => {
  it('is off by default and needs a fresh passkey check to turn on', async () => {
    const s = await setup();
    expect((await s.api('GET', '/connector')).json).toEqual({ on: false, createdAt: null });
    expect((await s.api('POST', '/connector')).status).toBe(401);
    await turnOn(s);
    expect((await s.api('GET', '/connector')).json.on).toBe(true);
  });

  it('answers the MCP handshake and lists read-only tools', async () => {
    const s = await setup();
    const path = await turnOn(s);
    const init = await rpc(path, 'initialize', { protocolVersion: '2025-06-18' });
    expect(init.json.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'rise' },
    });
    expect((await rpc(path, 'notifications/initialized', undefined, null)).status).toBe(202);
    const tools = (await rpc(path, 'tools/list')).json.result.tools as {
      name: string;
      annotations: { readOnlyHint: boolean };
    }[];
    expect(tools.map((t) => t.name)).toContain('budget_month');
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    expect((await rpc(path, 'ping')).json.result).toEqual({});
    expect((await rpc(path, 'resources/list')).json.error.code).toBe(-32601);
  });

  it('reads through the app’s own routes, for that user only', async () => {
    const s = await setup();
    await s.api('POST', '/accounts', { name: 'Everyday', kind: 'depository' });
    const path = await turnOn(s);
    const r = await rpc(path, 'tools/call', { name: 'accounts', arguments: {} });
    expect(r.json.result.isError).toBe(false);
    expect(JSON.parse(r.json.result.content[0].text)[0]).toMatchObject({ name: 'Everyday' });

    const month = await rpc(path, 'tools/call', {
      name: 'budget_month',
      arguments: { month: '2026-10' },
    });
    expect(JSON.parse(month.json.result.content[0].text).period.id).toBe('2026-10');
    const bad = await rpc(path, 'tools/call', { name: 'budget_month', arguments: { month: 'x' } });
    expect(bad.json.result.isError).toBe(true);

    const txns = await rpc(path, 'tools/call', {
      name: 'transactions',
      arguments: { q: 'nothing like this', direction: 'out' },
    });
    expect(JSON.parse(txns.json.result.content[0].text).items).toEqual([]);
    const totals = await rpc(path, 'tools/call', { name: 'transaction_totals', arguments: {} });
    expect(totals.json.result.isError).toBe(false);
  });

  it('refuses a wrong or turned-off link', async () => {
    const s = await setup();
    const path = await turnOn(s);
    expect((await rpc(`${path.slice(0, -2)}xx`, 'tools/list')).status).toBe(401);
    // A new link replaces the old one.
    const fresh = await turnOn(s);
    expect((await rpc(path, 'tools/list')).status).toBe(401);
    expect((await rpc(fresh, 'tools/list')).status).toBe(200);
    expect((await s.api('DELETE', '/connector')).status).toBe(204);
    expect((await rpc(fresh, 'tools/list')).status).toBe(401);
  });

  it('rejects junk and unknown tools', async () => {
    const s = await setup();
    const path = await turnOn(s);
    const junk = await call('POST', path, { body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] });
    expect(junk.status).toBe(400);
    expect((await rpc(path, 'tools/call', { name: 'delete_everything' })).json.error.code).toBe(
      -32602,
    );
    expect((await call('GET', path)).status).toBe(405);
  });
});
