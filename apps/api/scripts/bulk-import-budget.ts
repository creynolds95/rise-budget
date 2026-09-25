/**
 * One-time helper: recreate a budget read off screenshots of another app (Caleb, 2026-09-25).
 * Idempotent by name — reuses an existing group/category if the name already matches
 * (case-insensitive) instead of duplicating it, and only ever sets planned_cents for the
 * given period, never touches anything else about an existing category.
 *
 *   JWT_SECRET is not needed here (no auth token is issued); this only writes budget rows.
 *   node --experimental-strip-types scripts/bulk-import-budget.ts --period 2026-10 [--remote] [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    period: { type: 'string' },
    remote: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!values.period) {
  console.error(
    'usage: node scripts/bulk-import-budget.ts --period 2026-10 [--remote] [--dry-run]',
  );
  process.exit(1);
}
const periodId = values.period;
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

interface CategorySpec {
  group: string;
  name: string;
  emoji: string;
  plannedCents: number;
}

// Read from the screenshots Caleb sent 2026-09-25. Groups/categories he hid behind
// "Show N unbudgeted" were left out — never guessed at.
const SPEC: CategorySpec[] = [
  { group: 'Housing', name: 'Mortgage', emoji: '🏡', plannedCents: 275_000 },
  { group: 'Housing', name: 'Energy', emoji: '💡', plannedCents: 25_000 },
  { group: 'Housing', name: 'Water', emoji: '🚰', plannedCents: 15_000 },
  { group: 'Housing', name: 'Internet', emoji: '🌐', plannedCents: 5_600 },
  { group: 'Housing', name: 'Home Supplies', emoji: '🛠️', plannedCents: 10_000 },
  { group: 'Housing', name: 'House cleaning', emoji: '🧹', plannedCents: 12_000 },
  { group: 'Food & Dining', name: 'Groceries', emoji: '🛒', plannedCents: 60_000 },
  { group: 'Food & Dining', name: 'Restaurants & Bars', emoji: '🍽️', plannedCents: 15_000 },
  { group: 'Auto & Transport', name: 'Gas', emoji: '⛽', plannedCents: 25_000 },
  { group: 'Auto & Transport', name: 'Auto Insurance', emoji: '🚗', plannedCents: 21_700 },
  { group: 'Auto & Transport', name: 'Parking & Tolls', emoji: '🅿️', plannedCents: 8_000 },
  { group: 'Education', name: 'Student Loans', emoji: '🎓', plannedCents: 135_600 },
  { group: 'Health & Wellness', name: 'Doctor', emoji: '💊', plannedCents: 10_000 },
  { group: 'Health & Wellness', name: 'Gym', emoji: '🏋️', plannedCents: 14_600 },
  { group: 'Health & Wellness', name: 'Golf', emoji: '⛳', plannedCents: 10_000 },
  { group: 'Financial', name: 'Savings', emoji: '💰', plannedCents: 100_000 },
  { group: 'Financial', name: 'Life Insurance', emoji: '☂️', plannedCents: 3_600 },
  { group: 'Bills & Utilities', name: 'Phone', emoji: '📱', plannedCents: 10_200 },
  { group: 'Lifestyle', name: 'Caleb Spending', emoji: '🧑', plannedCents: 13_000 },
  { group: 'Lifestyle', name: 'Hannah Spending', emoji: '🦄', plannedCents: 15_000 },
  { group: 'Lifestyle', name: 'Pets', emoji: '🐶', plannedCents: 6_700 },
  { group: 'Subscriptions', name: 'Amazon', emoji: '🛍️', plannedCents: 1_600 },
  { group: 'Subscriptions', name: 'Streaming', emoji: '📺', plannedCents: 2_900 },
  { group: 'Subscriptions', name: 'Apple', emoji: '🖥️', plannedCents: 1_800 },
  { group: 'Subscriptions', name: 'Spotify', emoji: '🎧', plannedCents: 1_600 },
  { group: 'Gifts & Donations', name: 'Giving', emoji: '🎗️', plannedCents: 20_000 },
];

interface GroupRow {
  id: string;
  name: string;
  kind: string;
  sort_order: number;
}
interface CategoryRow {
  id: string;
  group_id: string;
  name: string;
  emoji: string | null;
  sort_order: number;
}
interface UserRow {
  id: string;
}
interface AllocationRow {
  category_id: string;
}

const users = query<UserRow>('SELECT id FROM user');
if (users.length !== 1) {
  console.error(`Expected exactly one user, found ${users.length}. Refusing to guess.`);
  process.exit(1);
}
const userId = users[0]?.id;
if (!userId) {
  console.error('No user found.');
  process.exit(1);
}

const groups = query<GroupRow>(
  `SELECT id, name, kind, sort_order FROM category_group WHERE user_id = ${sql(userId)}`,
);
const categories = query<CategoryRow>(
  `SELECT id, group_id, name, emoji, sort_order FROM category WHERE user_id = ${sql(userId)}`,
);
const existingAllocations = query<AllocationRow>(
  `SELECT category_id FROM allocation WHERE user_id = ${sql(userId)} AND period_id = ${sql(periodId)}`,
);
const allocatedIds = new Set(existingAllocations.map((a) => a.category_id));

const groupByName = new Map(groups.map((g) => [g.name.toLowerCase(), g]));
const categoryByGroupAndName = new Map(
  categories.map((c) => [`${c.group_id}::${c.name.toLowerCase()}`, c]),
);
let nextGroupSort = groups.reduce((m, g) => Math.max(m, g.sort_order), -1) + 1;

const statements: string[] = [];
const report: string[] = [];
const groupSortByName = new Map<string, number>();

// `allocation` FKs to `period`; the app only creates a period row once someone opens it
// (apps/api/src/db/periods.ts ensurePeriodStmt). A future period nobody has viewed yet
// won't exist, so make sure it does before any allocation insert.
statements.push(
  `INSERT INTO period (id, user_id) VALUES (${sql(periodId)}, ${sql(userId)}) ON CONFLICT(user_id, id) DO NOTHING;`,
);

for (const spec of SPEC) {
  let group = groupByName.get(spec.group.toLowerCase());
  if (!group) {
    const id = randomUUID();
    const sortOrder = nextGroupSort++;
    group = { id, name: spec.group, kind: 'expense', sort_order: sortOrder };
    groupByName.set(spec.group.toLowerCase(), group);
    statements.push(
      `INSERT INTO category_group (id, user_id, name, kind, sort_order) VALUES (${sql(id)}, ${sql(userId)}, ${sql(spec.group)}, 'expense', ${sortOrder});`,
    );
    report.push(`+ group "${spec.group}"`);
  }

  const key = `${group.id}::${spec.name.toLowerCase()}`;
  let category = categoryByGroupAndName.get(key);
  const nextCatSort =
    groupSortByName.get(group.id) ??
    categories
      .filter((c) => c.group_id === group.id)
      .reduce((m, c) => Math.max(m, c.sort_order), -1) + 1;
  if (!category) {
    const id = randomUUID();
    category = {
      id,
      group_id: group.id,
      name: spec.name,
      emoji: spec.emoji,
      sort_order: nextCatSort,
    };
    categoryByGroupAndName.set(key, category);
    groupSortByName.set(group.id, nextCatSort + 1);
    statements.push(
      `INSERT INTO category (id, user_id, group_id, name, emoji, sort_order) VALUES (${sql(id)}, ${sql(userId)}, ${sql(group.id)}, ${sql(spec.name)}, ${sql(spec.emoji)}, ${nextCatSort});`,
    );
    report.push(
      `  + category "${spec.group} / ${spec.name}" ${spec.emoji} $${(spec.plannedCents / 100).toFixed(0)}`,
    );
  } else if (!category.emoji) {
    statements.push(
      `UPDATE category SET emoji = ${sql(spec.emoji)} WHERE id = ${sql(category.id)};`,
    );
    report.push(`  ~ category "${spec.group} / ${spec.name}" gets emoji ${spec.emoji}`);
  } else {
    report.push(`  = category "${spec.group} / ${spec.name}" already exists, left as is`);
  }

  if (allocatedIds.has(category.id)) {
    report.push(`    (already has a ${periodId} plan — left as is, not overwritten)`);
    continue;
  }
  statements.push(
    `INSERT INTO allocation (id, user_id, period_id, category_id, planned_cents, carried_in_cents) VALUES (${sql(randomUUID())}, ${sql(userId)}, ${sql(periodId)}, ${sql(category.id)}, ${spec.plannedCents}, 0);`,
  );
  report.push(`    plan ${periodId}: $${(spec.plannedCents / 100).toFixed(0)}`);
}

console.log(report.join('\n'));

if (values['dry-run']) {
  console.log(`\n-- dry run, ${statements.length} statements would run, nothing written:\n`);
  console.log(statements.join('\n'));
} else if (statements.length === 0) {
  console.log('\nNothing to do.');
} else {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'rise', scope, '--command', statements.join('\n')],
    {
      stdio: 'inherit',
    },
  );
  console.log(`\nApplied ${statements.length} statements.`);
}
