import { Hono } from 'hono';
import { getMcpToken, getUser } from '../db';
import type { AppEnv, Env } from '../env';
import { safeEqual, sha256Hex } from '../lib/crypto';
import { localToday } from '../lib/dates';
import { renderError } from '../lib/errors';
import { accounts } from './accounts';
import { cashToPayday } from './cashToPayday';
import { categories } from './categories';
import { networth } from './networth';
import { periods } from './periods';
import { recurring } from './recurring';
import { transactions } from './transactions';

/**
 * The optional Claude connector (SPEC §12.3): a read-only MCP server over Streamable HTTP,
 * answering JSON. Its link carries the secret, so it works as a no-sign-in custom connector.
 * Every tool reads through the app's own GET routes; nothing here can change the owner's money.
 */
export const mcp = new Hono<AppEnv>();

type ReaderEnv = Env & { MCP_USER_ID: string };

/** The app's read routes, reachable only from here, for one already-verified user. */
const reader = new Hono<AppEnv>();
reader.use('*', async (c, next) => {
  if (c.req.method !== 'GET') return c.json({ error: { code: 'READ_ONLY' } }, 405);
  c.set('userId', (c.env as ReaderEnv).MCP_USER_ID);
  await next();
});
reader.route('/accounts', accounts);
reader.route('/categories', categories);
reader.route('/networth', networth);
reader.route('/periods', periods);
reader.route('/recurring', recurring);
reader.route('/cash-to-payday', cashToPayday);
reader.route('/transactions', transactions);
reader.onError(renderError);

const str = (description: string) => ({ type: 'string', description });

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown> };
  path: (args: Record<string, unknown>, today: string) => string;
}

const TXN_FILTERS = ['q', 'from', 'to', 'account', 'category', 'tag', 'direction', 'min', 'max'];

export const TOOLS: Tool[] = [
  {
    name: 'budget_month',
    description:
      'One month of the budget: each category with its plan, spending, carry from the month before and what is left, plus income and "left to budget".',
    inputSchema: { type: 'object', properties: { month: str('YYYY-MM; this month if left out') } },
    path: (a, today) =>
      `/periods/${typeof a['month'] === 'string' ? a['month'] : today.slice(0, 7)}`,
  },
  {
    name: 'transactions',
    description:
      'Transactions, newest first, 50 at a time. Pass nextCursor back as cursor for more.',
    inputSchema: {
      type: 'object',
      properties: {
        q: str('Search text: merchant, notes, amount'),
        from: str('First date, YYYY-MM-DD'),
        to: str('Last date, YYYY-MM-DD'),
        account: str('Account ids, comma-separated'),
        category: str('Category ids, comma-separated'),
        tag: str('Tag ids, comma-separated'),
        direction: { type: 'string', enum: ['in', 'out'] },
        min: { type: 'integer', description: 'Smallest amount, cents' },
        max: { type: 'integer', description: 'Largest amount, cents' },
        cursor: str('nextCursor from the previous page'),
      },
    },
    path: (a) => {
      const qs = new URLSearchParams();
      for (const k of [...TXN_FILTERS, 'cursor'])
        if (a[k] !== undefined && a[k] !== null && a[k] !== '') qs.set(k, String(a[k]));
      const s = qs.toString();
      return s ? `/transactions?${s}` : '/transactions';
    },
  },
  {
    name: 'transaction_totals',
    description: 'Count, money out, money in and net for the same filters as transactions.',
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(TXN_FILTERS.map((k) => [k, { type: 'string' }])),
    },
    path: (a) => {
      const qs = new URLSearchParams();
      for (const k of TXN_FILTERS)
        if (a[k] !== undefined && a[k] !== null && a[k] !== '') qs.set(k, String(a[k]));
      return `/transactions/totals?${qs.toString()}`;
    },
  },
  {
    name: 'accounts',
    description: 'Every account with its kind and current balance.',
    inputSchema: { type: 'object', properties: {} },
    path: () => '/accounts',
  },
  {
    name: 'categories',
    description: 'Every category with its group, so ids elsewhere can be named.',
    inputSchema: { type: 'object', properties: {} },
    path: () => '/categories',
  },
  {
    name: 'recurring',
    description:
      'Recurring charges and income: cadence, expected amount, next date, price changes.',
    inputSchema: { type: 'object', properties: {} },
    path: () => '/recurring',
  },
  {
    name: 'surplus',
    description:
      'Surplus: cash on hand before the next paycheck, after the bills due before it, day by day.',
    inputSchema: { type: 'object', properties: {} },
    path: () => '/cash-to-payday',
  },
  {
    name: 'net_worth',
    description: 'Net worth now and its history.',
    inputSchema: { type: 'object', properties: {} },
    path: () => '/networth',
  },
];

const INSTRUCTIONS =
  'Rise is the owner’s personal budget. Read-only. Money is integer cents; on transactions a ' +
  'positive amount is money out and a negative one is money in. The budget rolls over: a ' +
  'category’s carry is what was left (or overspent) the month before. Surplus is cash on hand ' +
  'until the next paycheck, not leftover income.';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const result = (id: RpcRequest['id'], r: unknown) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  result: r,
});
const failure = (id: RpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

mcp.post('/:userId/:token', async (c) => {
  const userId = c.req.param('userId');
  const saved = await getMcpToken(userId, c.env.DB);
  if (!saved || !safeEqual(saved.tokenHash, await sha256Hex(c.req.param('token'))))
    return c.json(failure(null, -32001, 'This connector link is off or out of date'), 401);

  let req: RpcRequest;
  try {
    req = await c.req.json<RpcRequest>();
  } catch {
    return c.json(failure(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(req) || typeof req !== 'object' || req === null)
    return c.json(failure(null, -32600, 'One request at a time'), 400);
  // A notification (no id) gets no answer.
  if (req.id === undefined) return c.body(null, 202);

  switch (req.method) {
    case 'initialize': {
      const asked = req.params?.['protocolVersion'];
      return c.json(
        result(req.id, {
          protocolVersion:
            typeof asked === 'string' && VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'rise', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        }),
      );
    }
    case 'ping':
      return c.json(result(req.id, {}));
    case 'tools/list':
      return c.json(
        result(req.id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
            annotations: { readOnlyHint: true },
          })),
        }),
      );
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === req.params?.['name']);
      if (!tool) return c.json(failure(req.id, -32602, 'Unknown tool'));
      const args = (req.params?.['arguments'] ?? {}) as Record<string, unknown>;
      const user = await getUser(userId, c.env.DB);
      const today = localToday(user?.timezone ?? 'America/Chicago');
      const res = await reader.request(tool.path(args, today), { method: 'GET' }, {
        ...c.env,
        MCP_USER_ID: userId,
      } satisfies ReaderEnv);
      const text = await res.text();
      return c.json(result(req.id, { content: [{ type: 'text', text }], isError: !res.ok }));
    }
    default:
      return c.json(failure(req.id, -32601, 'Method not found'));
  }
});

/** No server-to-client stream: everything is answered inline. */
mcp.get('/:userId/:token', (c) => c.body(null, 405));
mcp.delete('/:userId/:token', (c) => c.body(null, 405));
