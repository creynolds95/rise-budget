import { env } from 'cloudflare:workers';

/**
 * With QUERY_CATALOG=1, every distinct SQL statement the tests run is printed the first time each file runs it
 * as a `QUERY_CATALOG {json}` line. `scripts/check-plans.ts` asks production's own query
 * planner about each one (EXPLAIN reads no rows): production's SQLite has chosen a full scan
 * where the local one picked an index (Oct 2026, 5M rows read in a day), so local plans and
 * local row counts alone can't vouch for a query.
 */
if (env.QUERY_CATALOG === '1') {
  const seen = new Set<string>();
  const db = env.DB as unknown as { prepare: (sql: string) => D1PreparedStatement };
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    // Only the app's own statements: the tests' setup and assertions aren't shipped.
    if (!seen.has(sql) && /\/src\//.test(new Error().stack ?? '')) {
      seen.add(sql);
      console.log(`QUERY_CATALOG ${JSON.stringify(sql)}`);
    }
    return prepare(sql);
  };
}
