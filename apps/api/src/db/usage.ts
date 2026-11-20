import type { UserId } from './util';
/**
 * Daily D1 usage, counted by the Worker (see lib/usage.ts). Not user data: one row per UTC day
 * for the whole database, so these statements are marked `system:usage` for the scoping scanner.
 */

export const dayKey = (d: Date) => Number(d.toISOString().slice(0, 10).replaceAll('-', ''));

/**
 * A request that read fewer rows than this isn't worth its own per-route row: the routes table
 * is for finding the heavy readers, and upserting it on every small request was a third of the
 * meter's own writes.
 */
export const ROUTE_USAGE_MIN_ROWS = 500;

export async function addUsage(
  db: D1Database,
  now: Date,
  rowsRead: number,
  rowsWritten: number,
  requests: number,
  route?: string,
  /** Statements that ride in the same batch (the performance aggregates). */
  extra: D1PreparedStatement[] = [],
): Promise<void> {
  const day = dayKey(now);
  const stmts = [
    db
      .prepare(
        `INSERT INTO usage_day (day, rows_read, rows_written, requests) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(day) DO UPDATE SET rows_read = rows_read + ?2, rows_written = rows_written + ?3,
           requests = requests + ?4 /* system:usage */`,
      )
      .bind(day, rowsRead, rowsWritten, requests),
  ];
  if (route && rowsRead >= ROUTE_USAGE_MIN_ROWS) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO usage_route (day, route, rows_read, requests) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(day, route) DO UPDATE SET rows_read = rows_read + ?3,
             requests = requests + ?4 /* system:usage */`,
        )
        .bind(day, route, rowsRead, requests),
    );
  }
  await db.batch([...stmts, ...extra]);
}

/** The routes that read the most on one UTC day. */
export async function listRouteUsage(
  db: D1Database,
  now: Date,
  limit: number,
): Promise<{ route: string; rows_read: number; requests: number }[]> {
  const { results } = await db
    .prepare(
      'SELECT route, rows_read, requests FROM usage_route WHERE day = ?1 ORDER BY rows_read DESC LIMIT ?2 /* system:usage */',
    )
    .bind(dayKey(now), limit)
    .all<{ route: string; rows_read: number; requests: number }>();
  return results;
}

export async function listUsage(
  db: D1Database,
  now: Date,
  days: number,
): Promise<{ day: number; rows_read: number; rows_written: number; requests: number }[]> {
  const from = dayKey(new Date(now.getTime() - (days - 1) * 86_400_000));
  const { results } = await db
    .prepare(
      'SELECT day, rows_read, rows_written, requests FROM usage_day WHERE day >= ?1 ORDER BY day DESC /* system:usage */',
    )
    .bind(from)
    .all<{ day: number; rows_read: number; rows_written: number; requests: number }>();
  return results;
}

/** Keeps the table small; a year of daily rows is nothing, so this only runs nightly. */
export function pruneUsageStmts(db: D1Database, now: Date): D1PreparedStatement[] {
  const before = dayKey(new Date(now.getTime() - 400 * 86_400_000));
  return [
    db.prepare('DELETE FROM usage_day WHERE day < ?1 /* system:usage */').bind(before),
    db.prepare('DELETE FROM usage_route WHERE day < ?1 /* system:usage */').bind(before),
  ];
}

// ── performance (migration 0037) ────────────────────────────────────────────

export const hourKey = (d: Date) => d.toISOString().slice(0, 13);

export interface PerfSample {
  kind: 'api' | 'cron' | 'client';
  route: string;
  requests: number;
  errors: number;
  slow: number;
  msTotal: number;
  msMax: number;
  rowsRead: number;
  rowsWritten: number;
}

/** One upsert into the hourly aggregate. System-level, like usage_day. */
export function upsertPerfStmt(db: D1Database, now: Date, p: PerfSample): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO perf_hour (hour, kind, route, requests, errors, slow, ms_total, ms_max, rows_read, rows_written)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(hour, kind, route) DO UPDATE SET requests = requests + ?4, errors = errors + ?5,
         slow = slow + ?6, ms_total = ms_total + ?7, ms_max = MAX(ms_max, ?8),
         rows_read = rows_read + ?9, rows_written = rows_written + ?10 /* system:usage */`,
    )
    .bind(
      hourKey(now),
      p.kind,
      p.route.slice(0, 80),
      p.requests,
      p.errors,
      p.slow,
      Math.round(p.msTotal),
      Math.round(p.msMax),
      p.rowsRead,
      p.rowsWritten,
    );
}

export function upsertSlowQueryStmt(
  db: D1Database,
  now: Date,
  q: { sql: string; ms: number; rows: number },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO slow_query (day, sql, n, ms_max, rows_max) VALUES (?1, ?2, 1, ?3, ?4)
       ON CONFLICT(day, sql) DO UPDATE SET n = n + 1, ms_max = MAX(ms_max, ?3),
         rows_max = MAX(rows_max, ?4) /* system:usage */`,
    )
    .bind(dayKey(now), q.sql.replace(/\s+/g, ' ').slice(0, 300), Math.round(q.ms), q.rows);
}

export interface PerfRow {
  hour: string;
  kind: string;
  route: string;
  requests: number;
  errors: number;
  slow: number;
  ms_total: number;
  ms_max: number;
  rows_read: number;
  rows_written: number;
}

export async function listPerf(db: D1Database, sinceHour: string): Promise<PerfRow[]> {
  const { results } = await db
    .prepare(
      `SELECT hour, kind, route, requests, errors, slow, ms_total, ms_max, rows_read, rows_written
       FROM perf_hour WHERE hour >= ?1 /* system:usage */`,
    )
    .bind(sinceHour)
    .all<PerfRow>();
  return results;
}

export async function listSlowQueries(
  db: D1Database,
  sinceDay: number,
  limit: number,
): Promise<{ day: number; sql: string; n: number; ms_max: number; rows_max: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT day, sql, n, ms_max, rows_max FROM slow_query WHERE day >= ?1
       ORDER BY ms_max DESC LIMIT ?2 /* system:usage */`,
    )
    .bind(sinceDay, limit)
    .all<{ day: number; sql: string; n: number; ms_max: number; rows_max: number }>();
  return results;
}

export interface LogDayRow {
  day: number;
  stream: string;
  key: string;
  n: number;
  sum_a: number;
  sum_b: number;
  peak: number;
}

/** Rolled-up days older than the detail tables keep, for one user plus the system streams. */
export async function listLogDays(
  userId: UserId,
  db: D1Database,
  sinceDay: number,
): Promise<LogDayRow[]> {
  const { results } = await db
    .prepare(
      `SELECT day, stream, key, n, sum_a, sum_b, peak FROM log_day
       WHERE user_id = ?1 AND day >= ?2 ORDER BY day DESC`,
    )
    .bind(userId, sinceDay)
    .all<LogDayRow>();
  const system = await db
    .prepare(
      `SELECT day, stream, key, n, sum_a, sum_b, peak FROM log_day
       WHERE user_id = '' AND day >= ?1 ORDER BY day DESC /* system:usage */`,
    )
    .bind(sinceDay)
    .all<LogDayRow>();
  return [...results, ...system.results];
}
