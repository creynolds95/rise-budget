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
 *
 * A statement that reads a whole table on purpose (the backup, an export) says so in its SQL
 * with a `/* scan-ok: why *\/` or `/* system:backup *\/` comment.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    remote: { type: 'boolean', default: false },
  },
});
const file = positionals[0];
if (!file) throw new Error('usage: check-plans.ts <test log with QUERY_CATALOG lines> [--remote]');

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
]);

const statements = [
  ...new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('QUERY_CATALOG '))
      .map((l) => JSON.parse(l.slice('QUERY_CATALOG '.length)) as string),
  ),
]
  .filter((s) => /^\s*(WITH|SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s))
  .sort();

/** Parameters become a literal: EXPLAIN plans without running, and D1 has nothing to bind. */
const literal = (sql: string) => sql.replace(/\?\d*/g, "'p'");

type PlanRow = { id: number; parent: number; detail: string };

const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const databaseId = process.env['D1_DATABASE_ID'] || /database_id\s*=\s*"([^"]+)"/.exec(toml)?.[1];

/** Production through D1's HTTP API: one request plans a whole batch. */
async function explainRemote(batch: string[]): Promise<PlanRow[][]> {
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const token = process.env['CLOUDFLARE_API_TOKEN'];
  if (!account || !token || !databaseId)
    throw new Error('CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and a database id are needed');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        sql: batch.map((s) => `EXPLAIN QUERY PLAN ${literal(s)}`).join(';\n'),
      }),
    },
  );
  const body = (await res.json()) as {
    success: boolean;
    errors?: { message: string }[];
    result?: { results: PlanRow[] }[];
  };
  if (!body.success) throw new Error(body.errors?.map((e) => e.message).join('; ') ?? 'failed');
  return (body.result ?? []).map((r) => r.results);
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
  if (/\/\*\s*(scan-ok|system:backup)/.test(sql)) return [];
  const names = aliases(sql);
  const out: string[] = [];
  for (const { detail } of plan) {
    const scan = /^SCAN (\w+)(?! VIRTUAL TABLE)/.exec(detail);
    const userOnly = /^SEARCH (\w+) USING (?:COVERING )?INDEX \w+ \(user_id=\?\)$/.exec(detail);
    const hit = scan ?? userOnly;
    if (!hit) continue;
    const table = names.get((hit[1] as string).toLowerCase()) ?? (hit[1] as string).toLowerCase();
    if (!GROWING.has(table)) continue;
    // Walking an ordered index under a LIMIT stops early; only a sort makes it read everything.
    // ("RIGHT PART OF ORDER BY" only sorts ties, so it still stops early.)
    const limited =
      /\bLIMIT\b/i.test(sql) &&
      !plan.some((p) => /TEMP B-TREE FOR (ORDER BY|GROUP BY|DISTINCT)/.test(p.detail));
    if (limited && plan[0]?.detail === detail) continue;
    out.push(`${detail}  [${table}: ${scan ? 'full scan' : 'every row the user has'}]`);
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
