import { D1_DAILY_LIMITS, UsageStatus } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { listRouteUsage, listUsage } from '../db';
import type { AppEnv } from '../env';

/** Settings' database meter: D1 rows read and written per UTC day, against the free allowance. */
export const usage = new Hono<AppEnv>();

const iso = (day: number) => {
  const s = String(day);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

usage.get('/', async (c) => {
  const now = new Date();
  const [rows, routes] = await Promise.all([
    listUsage(c.env.DB, now, 14),
    listRouteUsage(c.env.DB, now, 5),
  ]);
  return c.json(
    UsageStatus.parse({
      limits: D1_DAILY_LIMITS,
      days: rows.map((r) => ({
        day: iso(r.day),
        rowsRead: r.rows_read,
        rowsWritten: r.rows_written,
        requests: r.requests,
      })),
      routes: routes.map((r) => ({ route: r.route, rowsRead: r.rows_read, requests: r.requests })),
    }),
  );
});
