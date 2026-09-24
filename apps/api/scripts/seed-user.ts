/**
 * T15 provisioning — the ONLY way a user is created. There is no signup route (SPEC §9).
 *
 *   JWT_SECRET=… pnpm seed:user --email you@example.com --name "Caleb" [--remote] [--origin https://rise.example]
 *
 * Inserts the user row via wrangler and prints a one-time passkey-registration link valid
 * for 10 minutes. JWT_SECRET must match the Worker's secret.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { sign } from 'hono/jwt';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    remote: { type: 'boolean', default: false },
    origin: { type: 'string', default: 'http://localhost:5173' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const secret = process.env['JWT_SECRET'];
if (!values.email || !values.name || !secret) {
  console.error(
    'usage: JWT_SECRET=… pnpm seed:user --email <email> --name <name> [--remote] [--origin <url>]',
  );
  process.exit(1);
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;
const id = randomUUID();
const now = new Date().toISOString();
const settings = JSON.stringify({ rollIncomeVariance: true, appLock: 'off' });
const insert =
  `INSERT INTO user (id, email, display_name, timezone, settings_json, created_at) VALUES ` +
  `(${sql(id)}, ${sql(values.email)}, ${sql(values.name)}, 'America/Chicago', ${sql(settings)}, ${sql(now)});`;

/**
 * Starter categories (pre-deploy-todo decision, 2026-09-24): a new user gets generic budget
 * lines to edit rather than an empty list. Savings/debt payoff are budgeted (A6 — the outgoing
 * checking leg of a savings/loan transfer counts as spending); Transfers group is not, except
 * where noted. Named "Transfer" so it's the same row `ensureTransferCategory` finds-or-creates
 * (apps/api/src/db/categories.ts) — seeding it here just means that lookup finds it immediately.
 * Mirrors `categoryDefaults` in packages/shared/src/budget/defaults.ts (kept inline: this script
 * runs via plain `node --experimental-strip-types`, which can't resolve `@rise/shared`'s
 * extensionless internal imports).
 */
interface StarterCategory {
  name: string;
  isBill?: boolean;
  budgeted?: boolean;
  isCatchall?: boolean;
}
interface StarterGroup {
  name: string;
  kind: 'income' | 'expense';
  categories: StarterCategory[];
}
const STARTER_GROUPS: StarterGroup[] = [
  { name: 'Income', kind: 'income', categories: [{ name: 'Paycheck' }, { name: 'Other Income' }] },
  {
    name: 'Home',
    kind: 'expense',
    categories: [
      { name: 'Rent/Mortgage', isBill: true },
      { name: 'Utilities', isBill: true },
      { name: 'Home Supplies' },
    ],
  },
  { name: 'Food', kind: 'expense', categories: [{ name: 'Groceries' }, { name: 'Dining Out' }] },
  {
    name: 'Transport',
    kind: 'expense',
    categories: [
      { name: 'Gas' },
      { name: 'Car Payment', isBill: true },
      { name: 'Car Insurance', isBill: true },
      { name: 'Public Transit' },
    ],
  },
  {
    name: 'Health',
    kind: 'expense',
    categories: [
      { name: 'Health Insurance', isBill: true },
      { name: 'Medical' },
      { name: 'Fitness' },
    ],
  },
  {
    name: 'Personal',
    kind: 'expense',
    categories: [
      { name: 'Subscriptions' },
      { name: 'Shopping' },
      { name: 'Entertainment' },
      { name: 'Personal Care' },
    ],
  },
  {
    name: 'Savings & Debt',
    kind: 'expense',
    categories: [
      { name: 'Savings', budgeted: true },
      { name: 'Debt Payoff', budgeted: true },
    ],
  },
  {
    name: 'Other',
    kind: 'expense',
    categories: [{ name: 'Other', isCatchall: true }, { name: 'Gifts' }, { name: 'Miscellaneous' }],
  },
  {
    name: 'Transfers',
    kind: 'expense',
    categories: [
      { name: 'Credit Card Payment', budgeted: false },
      { name: 'Transfer', budgeted: false },
    ],
  },
];

const categoryInserts = STARTER_GROUPS.flatMap((g, groupIdx) => {
  const groupId = randomUUID();
  const groupStmt =
    `INSERT INTO category_group (id, user_id, name, kind, sort_order) VALUES ` +
    `(${sql(groupId)}, ${sql(id)}, ${sql(g.name)}, ${sql(g.kind)}, ${groupIdx});`;
  const categoryStmts = g.categories.map((c, catIdx) => {
    const isBill = c.isBill ?? false;
    const rolloverPolicy = isBill ? 'return_to_pool' : 'roll';
    const spendShape = isBill ? 'fixed' : 'linear';
    const budgeted = c.budgeted ?? true;
    return (
      `INSERT INTO category (id, user_id, group_id, name, is_bill, rollover_policy, spend_shape, sort_order, is_catchall, budgeted) VALUES ` +
      `(${sql(randomUUID())}, ${sql(id)}, ${sql(groupId)}, ${sql(c.name)}, ${isBill ? 1 : 0}, ` +
      `${sql(rolloverPolicy)}, ${sql(spendShape)}, ${catIdx}, ${c.isCatchall ? 1 : 0}, ${budgeted ? 1 : 0});`
    );
  });
  return [groupStmt, ...categoryStmts];
});

const fullScript = [insert, ...categoryInserts].join('\n');

if (values['dry-run']) {
  console.log(`-- dry run, nothing written:\n${fullScript}`);
} else {
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'rise',
      values.remote ? '--remote' : '--local',
      '--command',
      fullScript,
    ],
    {
      stdio: 'inherit',
    },
  );
}

const nowS = Math.floor(Date.now() / 1000);
const token = await sign({ sub: id, typ: 'register', iat: nowS, exp: nowS + 600 }, secret, 'HS256');
console.log(`\nUser ${values.email} ${values['dry-run'] ? 'would be' : 'was'} created (${id}).`);
console.log(
  `Register your first passkey within 10 minutes:\n\n  ${values.origin}/register#token=${token}\n`,
);
