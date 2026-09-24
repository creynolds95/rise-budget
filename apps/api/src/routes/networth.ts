import { dayNumber, netWorthSeries } from '@rise/shared/networth';
import { IsoDate } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { listAccounts, listSnapshots } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';

export const networth = new Hono<AppEnv>();

const Query = z.object({ from: IsoDate, to: IsoDate });
const MAX_DAYS = 3 * 366;

networth.get('/', async (c) => {
  const q = Query.safeParse(c.req.query());
  if (!q.success)
    throw new AppError(400, 'BAD_REQUEST', 'from and to are required (YYYY-MM-DD)', q.error.issues);
  const { from, to } = q.data;
  const span = dayNumber(to) - dayNumber(from);
  if (span < 0 || span > MAX_DAYS)
    throw new AppError(400, 'BAD_REQUEST', 'Range must be 0 to 3 years');

  const userId = c.get('userId');
  const [accts, snaps] = await Promise.all([
    listAccounts(userId, c.env.DB),
    listSnapshots(userId, c.env.DB, { to }),
  ]);
  const byAccount = new Map<string, { asOf: string; balanceCents: number }[]>();
  for (const s of snaps) {
    const list = byAccount.get(s.account_id) ?? [];
    list.push({ asOf: s.as_of, balanceCents: s.balance_cents });
    byAccount.set(s.account_id, list);
  }
  const series = netWorthSeries(
    accts.map((a) => ({
      accountId: a.id,
      includeInNetWorth: a.includeInNetWorth,
      snapshots: byAccount.get(a.id) ?? [],
    })),
    from,
    to,
  );
  // Before the first balance anyone reported there is no net worth to show — not a $0 one.
  const included = new Set(accts.filter((a) => a.includeInNetWorth).map((a) => a.id));
  const first = snaps
    .filter((s) => included.has(s.account_id))
    .reduce<string | null>((m, s) => (m === null || s.as_of < m ? s.as_of : m), null);
  return c.json({ from, to, points: first ? series.filter((p) => p.date >= first) : [] });
});
