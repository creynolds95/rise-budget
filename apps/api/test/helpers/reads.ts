import { env } from 'cloudflare:workers';

/**
 * Counts the D1 rows each statement scans (`meta.rows_read`, what the free tier's 5M-a-day
 * cap bills). Installed once per test file; `rowsRead` measures one call.
 */
let total = 0;
let installed = false;

type Meta = { meta?: { rows_read?: number } };
const tally = (r: Meta) => {
  total += r.meta?.rows_read ?? 0;
};

function wrap(st: D1PreparedStatement): D1PreparedStatement {
  return new Proxy(st, {
    get(t, p) {
      if (p === 'bind') return (...v: unknown[]) => wrap(t.bind(...v));
      if (p === 'all' || p === 'run') {
        return async () => {
          const r = await (p === 'all' ? t.all() : t.run());
          tally(r);
          return r;
        };
      }
      if (p === 'first') {
        return async (col?: string) => {
          const r = await t.all<Record<string, unknown>>();
          tally(r);
          const row = r.results[0] ?? null;
          return col ? (row?.[col] ?? null) : row;
        };
      }
      const v = Reflect.get(t, p) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

function install() {
  if (installed) return;
  installed = true;
  const db = env.DB as unknown as {
    prepare: (sql: string) => D1PreparedStatement;
    batch: (s: D1PreparedStatement[]) => Promise<Meta[]>;
  };
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  db.prepare = (sql) => wrap(prepare(sql));
  db.batch = async (s) => {
    const r = await batch(s);
    r.forEach(tally);
    return r;
  };
}

export async function rowsRead(fn: () => Promise<unknown>): Promise<number> {
  install();
  const before = total;
  await fn();
  return total - before;
}
