import { staleness } from '@rise/shared/budget';
import {
  CreateAccountBody,
  CreateSnapshotBody,
  isLiabilityKind,
  PatchAccountBody,
  type Account,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  archiveAccount,
  countAccountTransactions,
  createAccount,
  deleteAccount,
  flipAccountSign,
  getAccount,
  listAccounts,
  listSnapshots,
  putSnapshot,
  updateAccount,
} from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';

export const accounts = new Hono<AppEnv>();

/** Staleness travels with every balance (SPEC §2.7, §5.1). */
function withStaleness(a: Account, nowMs: number) {
  return {
    ...a,
    staleness: staleness(
      {
        source: a.source,
        lastSyncedAtMs: a.lastSyncedAt ? Date.parse(a.lastSyncedAt) : null,
        syncCadenceHours: a.syncCadenceHours,
      },
      nowMs,
    ),
  };
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Account not found');

accounts.get('/', async (c) => {
  const now = Date.now();
  return c.json((await listAccounts(c.get('userId'), c.env.DB)).map((a) => withStaleness(a, now)));
});

accounts.get('/:id', async (c) => {
  const a = await getAccount(c.get('userId'), c.env.DB, c.req.param('id'));
  if (!a) throw notFound();
  return c.json(withStaleness(a, Date.now()));
});

/** Manual accounts only — synced accounts arrive through SimpleFIN. */
accounts.post('/', async (c) => {
  const b = await body(c, CreateAccountBody);
  const a = await createAccount(c.get('userId'), c.env.DB, { ...b, source: 'manual' });
  return c.json(withStaleness(a, Date.now()), 201);
});

accounts.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const before = await getAccount(userId, c.env.DB, id);
  if (!before) throw notFound();
  const b = await body(c, PatchAccountBody);
  if (b.kind && isLiabilityKind(b.kind) !== isLiabilityKind(before.kind)) {
    await flipAccountSign(userId, c.env.DB, id);
  }
  const a = await updateAccount(userId, c.env.DB, id, b);
  return c.json(withStaleness(a as Account, Date.now()));
});

accounts.get('/:id/snapshots', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await getAccount(userId, c.env.DB, id))) throw notFound();
  const rows = await listSnapshots(userId, c.env.DB, { accountId: id });
  return c.json(rows.map((r) => ({ asOf: r.as_of, balanceCents: r.balance_cents })));
});

accounts.post('/:id/snapshots', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const a = await getAccount(userId, c.env.DB, id);
  if (!a) throw notFound();
  if (a.source !== 'manual')
    throw new AppError(409, 'CONFLICT', 'Synced accounts get balances from sync');
  const b = await body(c, CreateSnapshotBody);
  await putSnapshot(userId, c.env.DB, id, { ...b, source: 'manual' });
  return c.json({ asOf: b.asOf, balanceCents: b.balanceCents }, 201);
});

/** Closes a manual account: it leaves the active list, but keeps its history in net worth. */
accounts.post('/:id/archive', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const a = await getAccount(userId, c.env.DB, id);
  if (!a) throw notFound();
  if (a.source !== 'manual')
    throw new AppError(409, 'CONFLICT', 'Disconnect a synced account instead of closing it');
  await archiveAccount(userId, c.env.DB, id);
  return c.json(withStaleness((await getAccount(userId, c.env.DB, id)) as Account, Date.now()));
});

/** Erases a manual account and every balance it ever reported. Never for a synced account,
 *  and never for one with transactions — close it instead so their history stays intact. */
accounts.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const a = await getAccount(userId, c.env.DB, id);
  if (!a) throw notFound();
  if (a.source !== 'manual')
    throw new AppError(409, 'CONFLICT', 'Disconnect a synced account instead of deleting it');
  if ((await countAccountTransactions(userId, c.env.DB, id)) > 0)
    throw new AppError(409, 'CONFLICT', 'This account has transactions — close it instead');
  await deleteAccount(userId, c.env.DB, id);
  return c.json({ deleted: true });
});
