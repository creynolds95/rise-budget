import type { Context, MiddlewareHandler } from 'hono';
import { SLOW_REQUEST_MS, SLOW_STATEMENT_MS } from '@rise/shared/activity';
import { addUsage, upsertPerfStmt, upsertSlowQueryStmt } from '../db';
import type { AppEnv, Env } from '../env';

/** What one request or cron run has read and written so far, as D1 reports it per statement. */
export interface Tally {
  read: number;
  written: number;
  /** The slowest statements seen (SQL text and timing only), at most {@link MAX_SLOW} per tally. */
  slow?: { sql: string; ms: number; rows: number }[];
}

const MAX_SLOW = 3;

type Meta = { meta?: { rows_read?: number; rows_written?: number; duration?: number } };

/**
 * One statement reading this many rows is a scan where a lookup was meant: every screen is
 * built to read a few thousand at most. Logged with its SQL so Workers Logs names it.
 */
export const HEAVY_STATEMENT_ROWS = 20_000;

/**
 * The same database, counting. D1's free tier bills rows *scanned* and rows written per UTC
 * day, and the only place those numbers appear is each result's `meta`, so every statement
 * adds its own to `tally`. `first()` runs as `all()` so its meta is visible too; each caller
 * of `first` selects by key, so the extra rows never travel.
 */
export function meterDb(
  db: D1Database,
  tally: Tally,
  heavyRows = HEAVY_STATEMENT_ROWS,
): D1Database {
  const sqlOf = new WeakMap<object, string>();
  const add = (r: Meta, sql?: string) => {
    const read = r.meta?.rows_read ?? 0;
    tally.read += read;
    tally.written += r.meta?.rows_written ?? 0;
    const ms = r.meta?.duration ?? 0;
    if ((ms >= SLOW_STATEMENT_MS || read >= heavyRows) && (tally.slow?.length ?? 0) < MAX_SLOW)
      (tally.slow ??= []).push({ sql: sql ?? '?', ms, rows: read });
    if (read >= heavyRows) {
      console.error(
        JSON.stringify({ heavyQuery: true, rowsRead: read, sql: (sql ?? '?').slice(0, 300) }),
      );
    }
  };
  const wrap = (st: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(st, {
      get(t, p) {
        if (p === 'bind') return (...v: unknown[]) => wrap(t.bind(...v), sql);
        if (p === 'all' || p === 'run') {
          return async () => {
            const r = await (p === 'all' ? t.all() : t.run());
            add(r, sql);
            return r;
          };
        }
        if (p === 'first') {
          return async (col?: string) => {
            const r = await t.all<Record<string, unknown>>();
            add(r, sql);
            const row = r.results[0] ?? null;
            return col ? (row?.[col] ?? null) : row;
          };
        }
        const v = Reflect.get(t, p) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    sqlOf.set(proxy, sql);
    return proxy;
  };
  return new Proxy(db, {
    get(t, p) {
      if (p === 'prepare') return (sql: string) => wrap(t.prepare(sql), sql);
      if (p === 'batch') {
        // Statements arrive already wrapped; unwrapping isn't possible, and D1 accepts the proxies.
        return async (stmts: D1PreparedStatement[]) => {
          const r = await t.batch(stmts);
          r.forEach((x, i) => add(x, sqlOf.get(stmts[i] as object)));
          return r;
        };
      }
      const v = Reflect.get(t, p) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

/** Writes a tally into today's row. Never throws: a meter must not break the thing it measures. */
export async function flushUsage(
  db: D1Database,
  tally: Tally,
  requests: number,
  route?: string,
  now = new Date(),
  /** When given, this call is also one sample in the hourly performance aggregate. */
  perf?: { kind: 'api' | 'cron'; ms: number; status?: number; failed?: boolean },
) {
  if (tally.read === 0 && tally.written === 0 && !perf) return;
  try {
    const extra = [
      ...(perf && route
        ? [
            upsertPerfStmt(db, now, {
              kind: perf.kind,
              route,
              requests: 1,
              errors: perf.failed || (perf.status ?? 0) >= 500 ? 1 : 0,
              slow: perf.ms >= SLOW_REQUEST_MS ? 1 : 0,
              msTotal: perf.ms,
              msMax: perf.ms,
              rowsRead: tally.read,
              rowsWritten: tally.written,
            }),
          ]
        : []),
      ...(tally.slow ?? []).map((q) => upsertSlowQueryStmt(db, now, q)),
    ];
    await addUsage(db, now, tally.read, tally.written, requests, route, extra);
  } catch {
    // The cap itself can make this fail; there is nothing useful left to do about it.
  }
}

/** Every API request counts its own D1 usage, flushed after the response is sent. */
export const meter: MiddlewareHandler<AppEnv> = async (c: Context<AppEnv>, next) => {
  const raw = c.env.DB;
  const tally: Tally = { read: 0, written: 0 };
  const started = Date.now();
  c.env = { ...c.env, DB: meterDb(raw, tally) } satisfies Env;
  await next();
  // The route pattern (/periods/:id), not the URL, so every month lands on one row.
  const flush = flushUsage(raw, tally, 1, `${c.req.method} ${c.req.routePath}`, new Date(), {
    kind: 'api',
    ms: Date.now() - started,
    status: c.res.status,
  });
  try {
    c.executionCtx.waitUntil(flush);
  } catch {
    await flush; // no execution context (tests)
  }
};
