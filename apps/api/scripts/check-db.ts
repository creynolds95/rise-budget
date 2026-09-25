/**
 * Read-only incident-check helper: does user_id's category_group table contain a group
 * named `--name`? Used once to confirm whether a failed batch write actually committed
 * anything to production before it errored (D1 batches are supposed to be transactional,
 * but this checks rather than assumes).
 *   node --experimental-strip-types scripts/check-db.ts --name Housing [--remote]
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    remote: { type: 'boolean', default: false },
  },
});
if (!values.name) {
  console.error('usage: node scripts/check-db.ts --name Housing [--remote]');
  process.exit(1);
}
const scope = values.remote ? '--remote' : '--local';
const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

function query<T>(command: string): T[] {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'rise', scope, '--json', '--command', command],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(out) as { results: T[] }[];
  return parsed[0]?.results ?? [];
}

const groups = query<{ id: string; name: string }>(
  `SELECT id, name FROM category_group WHERE name = ${sql(values.name)}`,
);
console.log('category_group matches:', JSON.stringify(groups));

const periods = query<{ id: string }>(`SELECT id FROM period ORDER BY id DESC LIMIT 5`);
console.log('recent periods:', JSON.stringify(periods));

const cats = query<{ id: string; name: string }>(
  `SELECT id, name FROM category WHERE name IN ('Mortgage','Energy','Groceries')`,
);
console.log('category matches:', JSON.stringify(cats));

const allocs = query<{ id: string }>(`SELECT id FROM allocation WHERE period_id = '2026-10'`);
console.log('2026-10 allocations:', JSON.stringify(allocs));
