/**
 * Read-only diagnostic helper: prints account list, recent bill-like transactions and
 * whether they're flagged as transfers, and any 2026-10 allocations for a category
 * matching --name. Reused across incidents rather than a one-shot script per question.
 *   node --experimental-strip-types scripts/check-db.ts [--name Housing] [--remote]
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    remote: { type: 'boolean', default: false },
  },
});
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

if (values.name) {
  const groups = query<{ id: string; name: string }>(
    `SELECT id, name FROM category_group WHERE name = ${sql(values.name)}`,
  );
  console.log('category_group matches:', JSON.stringify(groups));
}

const accounts = query<{ name: string; kind: string; include_in_budget: number }>(
  `SELECT name, kind, include_in_budget FROM account ORDER BY kind, name`,
);
console.log('accounts:', JSON.stringify(accounts, null, 1));

const billLike = query<{
  merchant_normalized: string;
  posted_at: string;
  amount_cents: number;
  is_transfer: number;
  review_state: string;
}>(
  `SELECT merchant_normalized, posted_at, amount_cents, is_transfer, review_state
   FROM txn
   WHERE (merchant_normalized LIKE '%MORTGAGE%' OR merchant_normalized LIKE '%LOAN%'
     OR merchant_normalized LIKE '%STUDENT%' OR merchant_normalized LIKE '%PAYROLL%'
     OR merchant_normalized LIKE '%OASIS%')
   ORDER BY posted_at DESC LIMIT 40`,
);
console.log('bill/payroll-like txns:', JSON.stringify(billLike, null, 1));

const periods = query<{ id: string; status: string }>(`SELECT id, status FROM period ORDER BY id`);
console.log('periods:', JSON.stringify(periods, null, 1));

const allocations = query<{
  period_id: string;
  group_name: string;
  category_name: string;
  planned_cents: number;
}>(
  `SELECT a.period_id, g.name AS group_name, c.name AS category_name, a.planned_cents
   FROM allocation a
   JOIN category c ON c.id = a.category_id
   JOIN category_group g ON g.id = c.group_id
   WHERE a.period_id IN ('2026-09', '2026-10')
   ORDER BY a.period_id, g.name, c.name`,
);
console.log('Sept/Oct allocations:', JSON.stringify(allocations, null, 1));
const catFlags = query<{
  name: string;
  group_id: string;
  budgeted: number;
  archived_at: string | null;
  group_name: string;
  group_kind: string;
}>(
  `SELECT c.name, c.group_id, c.budgeted, c.archived_at, g.name AS group_name, g.kind AS group_kind
   FROM category c JOIN category_group g ON g.id = c.group_id
   WHERE g.name IN ('Housing', 'Auto & Transport', 'Bills & Utilities', 'Education', 'Financial',
     'Food & Dining', 'Gifts & Donations', 'Health & Wellness', 'Lifestyle', 'Subscriptions')`,
);
console.log('imported category flags:', JSON.stringify(catFlags, null, 1));
