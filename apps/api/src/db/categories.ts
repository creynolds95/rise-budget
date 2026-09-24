import type { PlanDefault } from '@rise/shared/budget';
import {
  Category,
  CategoryGroup,
  type CategoryGroupKind,
  type RolloverPolicy,
  type SpendShape,
} from '@rise/shared/schemas';
import { bool, newId, nowIso, type UserId } from './util';

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
  rollover_policy: string;
  spend_shape: string;
  is_bill: number;
  typical_post_day: number | null;
  archived_at: string | null;
  sort_order: number;
  plan_default_cents: number | null;
  plan_default_from: string | null;
  is_catchall: number;
  budgeted: number;
}

const toGroup = (r: GroupRow): CategoryGroup =>
  CategoryGroup.parse({ id: r.id, name: r.name, kind: r.kind, sortOrder: r.sort_order });

const toCategory = (r: CategoryRow): Category =>
  Category.parse({
    id: r.id,
    groupId: r.group_id,
    name: r.name,
    emoji: r.emoji,
    rolloverPolicy: r.rollover_policy,
    spendShape: r.spend_shape,
    isBill: r.is_bill === 1,
    typicalPostDay: r.typical_post_day,
    archivedAt: r.archived_at,
    sortOrder: r.sort_order,
    planDefaultCents: r.plan_default_cents,
    planDefaultFrom: r.plan_default_from,
    isCatchall: r.is_catchall === 1,
    budgeted: r.budgeted === 1,
  });

/** The category's plan default in the engine's shape, if it has one (SPEC §2.9). */
export const planDefaultOf = (c: Category): PlanDefault | null =>
  c.planDefaultCents !== null && c.planDefaultFrom !== null
    ? { cents: c.planDefaultCents, from: c.planDefaultFrom }
    : null;

export async function listGroups(userId: UserId, db: D1Database): Promise<CategoryGroup[]> {
  const { results } = await db
    .prepare(
      'SELECT id, name, kind, sort_order FROM category_group WHERE user_id = ?1 ORDER BY sort_order, name',
    )
    .bind(userId)
    .all<GroupRow>();
  return results.map(toGroup);
}

export async function getGroup(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<CategoryGroup | null> {
  const row = await db
    .prepare('SELECT id, name, kind, sort_order FROM category_group WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id)
    .first<GroupRow>();
  return row ? toGroup(row) : null;
}

export async function createGroup(
  userId: UserId,
  db: D1Database,
  g: { name: string; kind: CategoryGroupKind; sortOrder: number },
): Promise<CategoryGroup> {
  const id = newId();
  await db
    .prepare(
      'INSERT INTO category_group (id, user_id, name, kind, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
    .bind(id, userId, g.name, g.kind, g.sortOrder)
    .run();
  return (await getGroup(userId, db, id)) as CategoryGroup;
}

export interface CategoryGroupPatch {
  name?: string | undefined;
  sortOrder?: number | undefined;
}

/** L6: rename or reorder a group. Its kind never changes after creation — that would silently
 * reclassify every category inside it as income or expense. */
export async function updateGroup(
  userId: UserId,
  db: D1Database,
  id: string,
  patch: CategoryGroupPatch,
): Promise<CategoryGroup | null> {
  const cols: Record<string, string> = { name: 'name', sortOrder: 'sort_order' };
  const entries = (Object.keys(cols) as (keyof CategoryGroupPatch)[])
    .filter((k) => patch[k] !== undefined)
    .map((k) => [cols[k], patch[k]] as const);
  if (entries.length > 0) {
    const sets = entries.map(([col], i) => `${col} = ?${i + 3}`).join(', ');
    await db
      .prepare(`UPDATE category_group SET ${sets} WHERE user_id = ?1 AND id = ?2`)
      .bind(userId, id, ...entries.map(([, v]) => v))
      .run();
  }
  return getGroup(userId, db, id);
}

/**
 * L6: a group can only be deleted once nothing has ever lived in it — same "archive, never
 * orphan" rule as a category (SPEC §2.10), one level up. Archiving a category doesn't free its
 * group either: the row (and its `group_id`) stays for history, so a group that has ever held
 * a category is permanent, same as the category itself.
 */
export async function groupHasCategories(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM category WHERE user_id = ?1 AND group_id = ?2 LIMIT 1')
    .bind(userId, id)
    .first();
  return row !== null;
}

export async function deleteGroup(userId: UserId, db: D1Database, id: string): Promise<void> {
  await db
    .prepare('DELETE FROM category_group WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id)
    .run();
}

export async function listCategories(userId: UserId, db: D1Database): Promise<Category[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM category WHERE user_id = ?1 AND archived_at IS NULL ORDER BY sort_order, name',
    )
    .bind(userId)
    .all<CategoryRow>();
  return results.map(toCategory);
}

export async function getCategory(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<Category | null> {
  const row = await db
    .prepare('SELECT * FROM category WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id)
    .first<CategoryRow>();
  return row ? toCategory(row) : null;
}

export async function getCatchallCategory(
  userId: UserId,
  db: D1Database,
): Promise<Category | null> {
  const row = await db
    .prepare('SELECT * FROM category WHERE user_id = ?1 AND is_catchall = 1')
    .bind(userId)
    .first<CategoryRow>();
  return row ? toCategory(row) : null;
}

/**
 * H1: every user always has exactly one "Other" category to fall back to, so a transaction
 * is never left without one — even a merchant with zero signal still lands somewhere real.
 * Lazily created on first use rather than at signup, since not every user reaches this path.
 */
export async function ensureCatchallCategory(userId: UserId, db: D1Database): Promise<Category> {
  const existing = await getCatchallCategory(userId, db);
  if (existing) return existing;
  let group = await db
    .prepare(`SELECT id FROM category_group WHERE user_id = ?1 AND name = 'Other'`)
    .bind(userId)
    .first<{ id: string }>();
  if (!group) {
    const groupId = newId();
    await db
      .prepare(
        'INSERT INTO category_group (id, user_id, name, kind, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)',
      )
      .bind(groupId, userId, 'Other', 'expense', 999)
      .run();
    group = { id: groupId };
  }
  try {
    const id = newId();
    await db
      .prepare(
        'INSERT INTO category (id, user_id, group_id, name, is_catchall) VALUES (?1, ?2, ?3, ?4, 1)',
      )
      .bind(id, userId, group.id, 'Other')
      .run();
    return (await getCategory(userId, db, id)) as Category;
  } catch {
    // Lost a race with another call creating it at the same time; the partial unique index
    // rejected this insert, so it already exists — use that one.
    return (await getCatchallCategory(userId, db)) as Category;
  }
}

/**
 * The per-user unbudgeted "Transfer" category (pre-deploy-todo A5): moving money between the
 * user's own accounts, or paying off a credit card, by default counts as nothing. The user
 * can always recategorize either leg to a budgeted category later — nothing here is special
 * beyond its `budgeted` flag, and `is_transfer`/`transfer_pair_id` stay a pure pairing marker.
 */
export async function ensureTransferCategory(userId: UserId, db: D1Database): Promise<Category> {
  const existing = await db
    .prepare(
      `SELECT c.* FROM category c JOIN category_group g ON g.id = c.group_id AND g.user_id = c.user_id
       WHERE c.user_id = ?1 AND g.name = 'Transfers' AND c.name = 'Transfer'`,
    )
    .bind(userId)
    .first<CategoryRow>();
  if (existing) return toCategory(existing);
  let group = await db
    .prepare(`SELECT id FROM category_group WHERE user_id = ?1 AND name = 'Transfers'`)
    .bind(userId)
    .first<{ id: string }>();
  if (!group) {
    const groupId = newId();
    await db
      .prepare(
        'INSERT INTO category_group (id, user_id, name, kind, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)',
      )
      .bind(groupId, userId, 'Transfers', 'expense', 998)
      .run();
    group = { id: groupId };
  }
  const id = newId();
  await db
    .prepare(
      'INSERT INTO category (id, user_id, group_id, name, budgeted) VALUES (?1, ?2, ?3, ?4, 0)',
    )
    .bind(id, userId, group.id, 'Transfer')
    .run();
  return (await getCategory(userId, db, id)) as Category;
}

export async function createCategory(
  userId: UserId,
  db: D1Database,
  c: {
    groupId: string;
    name: string;
    emoji: string | null;
    isBill: boolean;
    rolloverPolicy: RolloverPolicy;
    spendShape: SpendShape;
    budgeted: boolean;
  },
): Promise<Category> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO category (id, user_id, group_id, name, emoji, rollover_policy, spend_shape, is_bill, budgeted)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      id,
      userId,
      c.groupId,
      c.name,
      c.emoji,
      c.rolloverPolicy,
      c.spendShape,
      bool(c.isBill),
      bool(c.budgeted),
    )
    .run();
  return (await getCategory(userId, db, id)) as Category;
}

export interface CategoryPatch {
  name?: string | undefined;
  emoji?: string | null | undefined;
  groupId?: string | undefined;
  rolloverPolicy?: RolloverPolicy | undefined;
  spendShape?: SpendShape | undefined;
  isBill?: boolean | undefined;
  budgeted?: boolean | undefined;
  sortOrder?: number | undefined;
}

const COLS: Record<keyof CategoryPatch, string> = {
  name: 'name',
  emoji: 'emoji',
  groupId: 'group_id',
  rolloverPolicy: 'rollover_policy',
  spendShape: 'spend_shape',
  isBill: 'is_bill',
  budgeted: 'budgeted',
  sortOrder: 'sort_order',
};

/** Changing a policy never rewrites history — it only affects the next close (SPEC §2.2). */
export async function updateCategory(
  userId: UserId,
  db: D1Database,
  id: string,
  patch: CategoryPatch,
): Promise<Category | null> {
  const entries = (Object.keys(COLS) as (keyof CategoryPatch)[])
    .filter((k) => patch[k] !== undefined)
    .map(
      (k) =>
        [COLS[k], typeof patch[k] === 'boolean' ? bool(patch[k] as boolean) : patch[k]] as const,
    );
  if (entries.length > 0) {
    const sets = entries.map(([col], i) => `${col} = ?${i + 3}`).join(', ');
    await db
      .prepare(`UPDATE category SET ${sets} WHERE user_id = ?1 AND id = ?2`)
      .bind(userId, id, ...entries.map(([, v]) => v))
      .run();
  }
  return getCategory(userId, db, id);
}

export function setPlanDefaultStmt(
  userId: UserId,
  db: D1Database,
  id: string,
  d: PlanDefault,
): D1PreparedStatement {
  return db
    .prepare(
      'UPDATE category SET plan_default_cents = ?3, plan_default_from = ?4 WHERE user_id = ?1 AND id = ?2',
    )
    .bind(userId, id, d.cents, d.from);
}

/**
 * SPEC §2.10: what keeps a category from being deleted, if anything — money in any open month.
 * Null when it's free to go.
 */
export async function categoryMoneyInOpenMonths(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<{ periodId: string } | null> {
  const row = await db
    .prepare(
      `SELECT a.period_id AS period_id FROM allocation a
       LEFT JOIN period p ON p.user_id = a.user_id AND p.id = a.period_id
       WHERE a.user_id = ?1 AND a.category_id = ?2 AND COALESCE(p.status, 'open') = 'open'
         AND (a.planned_cents != 0 OR a.carried_in_cents != 0)
       UNION ALL
       SELECT s.period_id FROM split s
       JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
       LEFT JOIN period p ON p.user_id = s.user_id AND p.id = s.period_id
       WHERE s.user_id = ?1 AND s.category_id = ?2 AND COALESCE(p.status, 'open') = 'open'
         AND t.review_state != 'dropped'
       LIMIT 1`,
    )
    .bind(userId, id)
    .first<{ period_id: string }>();
  return row ? { periodId: row.period_id } : null;
}

export function archiveCategoryStmts(
  userId: UserId,
  db: D1Database,
  id: string,
): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM rule WHERE user_id = ?1 AND category_id = ?2').bind(userId, id),
    // Learned suggestions must not point at a category the picker no longer shows.
    db
      .prepare('DELETE FROM merchant_memory WHERE user_id = ?1 AND category_id = ?2')
      .bind(userId, id),
    db
      .prepare(
        `UPDATE txn SET suggested_category_id = NULL, suggestion_confidence = 0
         WHERE user_id = ?1 AND suggested_category_id = ?2`,
      )
      .bind(userId, id),
    db
      .prepare('UPDATE category SET archived_at = ?3 WHERE user_id = ?1 AND id = ?2')
      .bind(userId, id, nowIso()),
  ];
}
