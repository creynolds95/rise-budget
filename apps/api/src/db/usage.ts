/**
 * Daily D1 usage, counted by the Worker (see lib/usage.ts). Not user data: one row per UTC day
 * for the whole database, so these statements are marked `system:usage` for the scoping scanner.
 */

export const dayKey = (d: Date) => Number(d.toISOString().slice(0, 10).replaceAll('-', ''));

export async function addUsage(
  db: D1Database,
  now: Date,
  rowsRead: number,
  rowsWritten: number,
  requests: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO usage_day (day, rows_read, rows_written, requests) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(day) DO UPDATE SET rows_read = rows_read + ?2, rows_written = rows_written + ?3,
         requests = requests + ?4 /* system:usage */`,
    )
    .bind(dayKey(now), rowsRead, rowsWritten, requests)
    .run();
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
export function pruneUsageStmt(db: D1Database, now: Date): D1PreparedStatement {
  return db
    .prepare('DELETE FROM usage_day WHERE day < ?1 /* system:usage */')
    .bind(dayKey(new Date(now.getTime() - 400 * 86_400_000)));
}
