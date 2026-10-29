import { dayNumber, joinedCents, netWorthSeries } from '@rise/shared/networth';
import { IsoDate } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { listAccountsForNetWorth, listSnapshots } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { fetchSp500 } from '../lib/sp500';

export const investments = new Hono<AppEnv>();

const Query = z.object({ from: IsoDate, to: IsoDate });

/**
 * Investment-account balances over time next to the S&P 500. SimpleFIN reports balances only,
 * so growth here is balance-based: a deposit counts as growth. An account being added does not:
 * each point says how much joined that day (`joinedCents`) so the line can step over it.
 */
investments.get('/', async (c) => {
  const q = Query.safeParse(c.req.query());
  if (!q.success)
    throw new AppError(400, 'BAD_REQUEST', 'from and to are required', q.error.issues);
  const { from, to } = q.data;
  const span = dayNumber(to) - dayNumber(from);
  if (span < 0 || span > 3 * 366)
    throw new AppError(400, 'BAD_REQUEST', 'Range must be 0 to 3 years');

  const userId = c.get('userId');
  const all = await listAccountsForNetWorth(userId, c.env.DB);
  const accts = all.filter((a) => a.kind === 'investment' && !a.archivedAt && a.includeInNetWorth);
  const snaps = await listSnapshots(userId, c.env.DB, { from, to });
  const ids = new Set(accts.map((a) => a.id));
  const mine = snaps.filter((s) => ids.has(s.account_id));
  const first = mine.reduce<string | null>(
    (m, s) => (m === null || s.as_of < m ? s.as_of : m),
    null,
  );
  const series = accts.map((a) => ({
    accountId: a.id,
    includeInNetWorth: true,
    snapshots: mine
      .filter((s) => s.account_id === a.id)
      .map((s) => ({ asOf: s.as_of, balanceCents: s.balance_cents })),
  }));
  // An account's first balance is not growth: the client chain-links over it.
  const joined = joinedCents(series, from, to);
  const points = (first ? netWorthSeries(series, from, to).filter((p) => p.date >= first) : []).map(
    (p) => ({
      date: p.date,
      balanceCents: p.netWorthCents,
      joinedCents: joined.get(p.date) ?? 0,
      inferred: p.inferred,
    }),
  );
  const sp500 = points.length > 0 ? await fetchSp500(from, to) : null;
  return c.json({
    from,
    to,
    points,
    accounts: accts.map((a) => ({ id: a.id, name: a.name, balanceCents: a.balanceCents })),
    sp500,
  });
});
