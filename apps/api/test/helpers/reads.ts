import { env } from 'cloudflare:workers';

/**
 * Counts the D1 rows each statement scans (`meta.rows_read`, what the free tier's 5M-a-day
 * cap bills). Installed once per test file; `rowsRead` measures one call.
 */
let total = 0;
let installed = false;
/** Rows read per statement text, for finding which query a budget breach came from. */
export const bySql = new Map<string, number>();

type Meta = { meta?: { rows_read?: number } };
const tally = (r: Meta, sql = '?') => {
  const n = r.meta?.rows_read ?? 0;
  total += n;
  bySql.set(sql, (bySql.get(sql) ?? 0) + n);
};

const sqlText = new WeakMap<object, string>();

function wrap(st: D1PreparedStatement, sql: string): D1PreparedStatement {
  const proxy = new Proxy(st, {
    get(t, p) {
      if (p === 'bind') return (...v: unknown[]) => wrap(t.bind(...v), sql);
      if (p === 'all' || p === 'run') {
        return async () => {
          const r = await (p === 'all' ? t.all() : t.run());
          tally(r, sql);
          return r;
        };
      }
      if (p === 'first') {
        return async (col?: string) => {
          const r = await t.all<Record<string, unknown>>();
          tally(r, sql);
          const row = r.results[0] ?? null;
          return col ? (row?.[col] ?? null) : row;
        };
      }
      const v = Reflect.get(t, p) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  sqlText.set(proxy, sql);
  return proxy;
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
  db.prepare = (sql) => wrap(prepare(sql), sql);
  db.batch = async (s) => {
    const r = await batch(s);
    r.forEach((x, i) => tally(x, sqlText.get(s[i] as object) ?? 'batch'));
    return r;
  };
}

export async function rowsRead(fn: () => Promise<unknown>): Promise<number> {
  install();
  const before = total;
  await fn();
  return total - before;
}
