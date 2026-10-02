import type { Context, MiddlewareHandler } from 'hono';
import { addUsage } from '../db';
import type { AppEnv, Env } from '../env';

/** What one request or cron run has read and written so far, as D1 reports it per statement. */
export interface Tally {
  read: number;
  written: number;
}

type Meta = { meta?: { rows_read?: number; rows_written?: number } };

/**
 * The same database, counting. D1's free tier bills rows *scanned* and rows written per UTC
 * day, and the only place those numbers appear is each result's `meta`, so every statement
 * adds its own to `tally`. `first()` runs as `all()` so its meta is visible too; each caller
 * of `first` selects by key, so the extra rows never travel.
 */
export function meterDb(db: D1Database, tally: Tally): D1Database {
  const add = (r: Meta) => {
    tally.read += r.meta?.rows_read ?? 0;
    tally.written += r.meta?.rows_written ?? 0;
  };
  const wrap = (st: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(st, {
      get(t, p) {
        if (p === 'bind') return (...v: unknown[]) => wrap(t.bind(...v));
        if (p === 'all' || p === 'run') {
          return async () => {
            const r = await (p === 'all' ? t.all() : t.run());
            add(r);
            return r;
          };
        }
        if (p === 'first') {
          return async (col?: string) => {
            const r = await t.all<Record<string, unknown>>();
            add(r);
            const row = r.results[0] ?? null;
            return col ? (row?.[col] ?? null) : row;
          };
        }
        const v = Reflect.get(t, p) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  return new Proxy(db, {
    get(t, p) {
      if (p === 'prepare') return (sql: string) => wrap(t.prepare(sql));
      if (p === 'batch') {
        // Statements arrive already wrapped; unwrapping isn't possible, and D1 accepts the proxies.
        return async (stmts: D1PreparedStatement[]) => {
          const r = await t.batch(stmts);
          r.forEach(add);
          return r;
        };
      }
      const v = Reflect.get(t, p) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

/** Writes a tally into today's row. Never throws: a meter must not break the thing it measures. */
export async function flushUsage(db: D1Database, tally: Tally, requests: number, now = new Date()) {
  if (tally.read === 0 && tally.written === 0) return;
  try {
    await addUsage(db, now, tally.read, tally.written, requests);
  } catch {
    // The cap itself can make this fail; there is nothing useful left to do about it.
  }
}

/** Every API request counts its own D1 usage, flushed after the response is sent. */
export const meter: MiddlewareHandler<AppEnv> = async (c: Context<AppEnv>, next) => {
  const raw = c.env.DB;
  const tally: Tally = { read: 0, written: 0 };
  c.env = { ...c.env, DB: meterDb(raw, tally) } satisfies Env;
  await next();
  const flush = flushUsage(raw, tally, 1);
  try {
    c.executionCtx.waitUntil(flush);
  } catch {
    await flush; // no execution context (tests)
  }
};
