/**
 * Asks a D1 database's own query planner about every statement the app runs, and fails on
 * any plan that reads a growing table end to end.
 *
 * Why: production's SQLite is not the one in local tests, and it plans differently. In Oct
 * 2026 a split lookup that used an index locally walked every split once per id in
 * production — 5M rows read in a day — and every local test passed. EXPLAIN QUERY PLAN reads
 * no rows, so asking production costs nothing against the free tier.
 *
 *   QUERY_CATALOG=1 pnpm vitest run --reporter=verbose --silent=false > tests.log
 *   node --experimental-strip-types scripts/check-plans.ts tests.log [--remote]
 *   node --experimental-strip-types scripts/check-plans.ts --migrations --remote
 *
 * `--migrations` plans the statements of every migration production hasn't applied yet, so a
 * backfill is checked before it runs (deploy migrates before the code check can see anything).
 *
 * A statement that reads a whole table on purpose (the backup, an export, a backfill) says so
 * in its SQL with a `/* scan-ok: why *\/` or `/* system:backup *\/` comment. That excuses one
 * pass, never a pass per row.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    remote: { type: 'boolean', default: false },
    migrations: { type: 'boolean', default: false },
  },
});
const file = positionals[0];
if (!file && !values.migrations)
  throw new Error('usage: check-plans.ts <test log with QUERY_CATALOG lines> [--remote]');
if (values.migrations && !values.remote)
  throw new Error('--migrations asks production which migrations are pending; add --remote');

/** Tables that grow with history. Reading one of these whole is the bug this script hunts. */
const GROWING = new Set([
  'txn',
  'split',
  'balance_snapshot',
  'audit_log',
  'allocation',
  'period_aggregate',
  'sync_run',
  'idempotency',
  'merchant_memory',
  'push_sent',
]);

const catalog = (): string[] => [
  ...new Set(
    readFileSync(file as string, 'utf8')
      .split('\n')
      // Anywhere in the line: a test reporter may prefix it.
      .flatMap((l) => {
        const m = /QUERY_CATALOG ("(?:[^"\\]|\\.)*")\s*$/.exec(l);
        return m ? [JSON.parse(m[1] as string) as string] : [];
      }),
  ),
];

const plannable = (s: string) => /^\s*(WITH|SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s);

/** Parameters become a literal: EXPLAIN plans without running, and D1 has nothing to bind. */
const literal = (sql: string) => sql.replace(/\?\d*/g, "'p'");

type PlanRow = { id: number; parent: number; detail: string };

const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const databaseId = process.env['D1_DATABASE_ID'] || /database_id\s*=\s*"([^"]+)"/.exec(toml)?.[1];

/** Production through D1's HTTP API: one request runs a whole batch. */
async function queryRemote<T>(sql: string): Promise<T[][]> {
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const token = process.env['CLOUDFLARE_API_TOKEN'];
  if (!account || !token || !databaseId)
    throw new Error('CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and a database id are needed');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
    },
  );
  const body = (await res.json()) as {
    success: boolean;
    errors?: { message: string }[];
    result?: { results: T[] }[];
  };
  if (!body.success) throw new Error(body.errors?.map((e) => e.message).join('; ') ?? 'failed');
  return (body.result ?? []).map((r) => r.results);
}

const explainRemote = (batch: string[]) =>
  queryRemote<PlanRow>(batch.map((s) => `EXPLAIN QUERY PLAN ${literal(s)}`).join(';\n'));

/** Statements of the migrations production hasn't applied, in order. */
async function pendingMigrations(): Promise<string[]> {
  let rows: { name: string }[];
  try {
    rows = (await queryRemote<{ name: string }>('SELECT name FROM d1_migrations'))[0] ?? [];
  } catch (e) {
    // A spent daily allowance fails this too; migrate would fail the same way, so warn only.
    console.log(`::warning::Could not list production's migrations (${String(e)}); not checked.`);
    process.exit(0);
  }
  const applied = new Set(rows.map((r) => r.name));
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../migrations/', import.meta.url);
  const pending = readdirSync(dir)
    .filter((n) => n.endsWith('.sql') && !applied.has(n))
    .sort();
  console.log(`pending migrations: ${pending.join(', ') || 'none'}`);
  return pending.flatMap((f) =>
    readFileSync(new URL(f, dir), 'utf8')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((x) => x.trim())
      .filter(plannable),
  );
}

/** A fresh local D1 with every migration applied: the planner the tests run on. */
async function localDb(): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
  const { getPlatformProxy } = await import('wrangler');
  const persist = `${process.env['TMPDIR'] ?? '/tmp'}/rise-plans-${process.pid}`;
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: { path: persist } });
  const dir = new URL('../migrations/', import.meta.url);
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(new URL(f, dir), 'utf8').replace(/--.*$/gm, '');
    const stmts = sql.split(';').filter((x) => x.trim());
    await proxy.env.DB.batch(stmts.map((x) => proxy.env.DB.prepare(x)));
  }
  return { db: proxy.env.DB, dispose: () => proxy.dispose() };
}

/** alias → table, from FROM/JOIN clauses. */
function aliases(sql: string): Map<string, string> {
  const m = new Map<string, string>();
  const re =
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)(?:\s+(?:AS\s+)?(?!ON\b|WHERE\b|JOIN\b|SET\b|USING\b|INDEXED\b|LEFT\b|CROSS\b|INNER\b|GROUP\b|ORDER\b|LIMIT\b|VALUES\b)([a-z]\w*))?/gi;
  for (const x of sql.matchAll(re)) {
    const table = (x[1] as string).toLowerCase();
    m.set(table, table);
    if (x[2]) m.set(x[2].toLowerCase(), table);
  }
  return m;
}

/** What's wrong with a plan, if anything: each finding names the table and why. */
export function findings(sql: string, plan: PlanRow[]): string[] {
  const excused = /\/\*\s*(scan-ok|system:backup)/.test(sql);
  const names = aliases(sql);
  const byId = new Map(plan.map((p) => [p.id, p]));
  const correlated = (p: PlanRow): boolean => {
    for (let q = byId.get(p.parent); q; q = byId.get(q.parent))
      if (/^CORRELATED /.test(q.detail)) return true;
    return false;
  };
  const dml = /^\s*(DELETE|UPDATE)\b/i.test(sql);
  const out: string[] = [];
  // Loops that visit many rows, of any table: a lookup inside one of them runs once per row.
  const many: PlanRow[] = [];
  for (const row of plan) {
    const { detail } = row;
    const scan = /^SCAN (\w+)(?! VIRTUAL TABLE)/.exec(detail);
    const userOnly = /^SEARCH (\w+) USING (?:COVERING )?INDEX \w+ \(user_id=\?\)$/.exec(detail);
    const hit = scan ?? userOnly;
    if (!hit) continue;
    // An excused statement may read a table once, never once per row: a big loop after another
    // loop of the same join, or inside a subquery run per row, multiplies (Oct 2026: 192k a call).
    // (A DELETE or UPDATE lists its foreign-key checks beside its own loop; those aren't nested.)
    const perRow =
      (!(dml && row.parent === 0) && many.some((b) => b.parent === row.parent)) || correlated(row);
    many.push(row);
    const table = names.get((hit[1] as string).toLowerCase()) ?? (hit[1] as string).toLowerCase();
    if (!GROWING.has(table)) continue;
    if (excused && !perRow) continue;
    // Walking an ordered index under a LIMIT stops early; only a sort makes it read everything.
    // ("RIGHT PART OF ORDER BY" only sorts ties, so it still stops early.)
    const limited =
      /\bLIMIT\b/i.test(sql) &&
      !plan.some((p) => /TEMP B-TREE FOR (ORDER BY|GROUP BY|DISTINCT)/.test(p.detail));
    if (limited && plan[0]?.detail === detail) continue;
    out.push(
      `${detail}  [${table}: ${perRow ? 'read once per row' : scan ? 'full scan' : 'every row the user has'}]`,
    );
  }
  return out;
}

const bad: { sql: string; why: string[] }[] = [];
const unchecked: { sql: string; error: string }[] = [];
if (
  values.remote &&
  !(process.env['CLOUDFLARE_ACCOUNT_ID'] && process.env['CLOUDFLARE_API_TOKEN'] && databaseId)
) {
  // Fork and Dependabot runs get no secrets; the local planner check still ran.
  console.log('::warning::No Cloudflare credentials here; production query plans not checked.');
  process.exit(0);
}
const statements = values.migrations
  ? await pendingMigrations()
  : catalog().filter(plannable).sort();
const local = values.remote ? null : await localDb();
const explain = async (batch: string[]): Promise<PlanRow[][]> =>
  local
    ? Promise.all(
        batch.map(
          async (s) =>
            (await local.db.prepare(`EXPLAIN QUERY PLAN ${literal(s)}`).all<PlanRow>()).results,
        ),
      )
    : explainRemote(batch);
const CHUNK = 25;
for (let i = 0; i < statements.length; i += CHUNK) {
  const batch = statements.slice(i, i + CHUNK);
  let plans: (PlanRow[] | Error)[];
  try {
    plans = await explain(batch);
  } catch {
    // One statement the database can't plan (a table a pending migration adds) fails the
    // whole batch; retry one by one so the rest are still checked.
    plans = await Promise.all(
      batch.map(async (s) => {
        try {
          return (await explain([s]))[0] ?? [];
        } catch (e) {
          return e instanceof Error ? e : new Error(String(e));
        }
      }),
    );
  }
  batch.forEach((sql, j) => {
    const plan = plans[j];
    if (plan instanceof Error) unchecked.push({ sql, error: plan.message });
    else if (plan) {
      const why = findings(sql, plan);
      if (why.length) bad.push({ sql, why });
    }
  });
}
await local?.dispose();

const where = values.remote ? 'production' : 'local';
const short = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 240);
for (const u of unchecked)
  console.log(`? could not plan on ${where}: ${u.error}\n    ${short(u.sql)}`);
for (const b of bad) console.log(`✗ ${short(b.sql)}\n    ${b.why.join('\n    ')}`);
console.log(
  `${statements.length} statements planned on ${where}: ${bad.length} read a growing table whole, ${unchecked.length} could not be planned.`,
);
// A spent daily allowance fails every request, EXPLAIN included. That says nothing about the
// code, so it must not block a fix from shipping; the local planner check still ran.
if (values.remote && !bad.length && unchecked.length === statements.length) {
  console.log('::warning::Production could not plan anything (daily D1 limit spent?); skipped.');
  process.exit(0);
}
if (bad.length) process.exit(1);
