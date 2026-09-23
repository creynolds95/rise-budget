import {
  Category,
  CategoryGroup,
  type CategoryGroupKind,
  type RolloverPolicy,
  type SpendShape,
} from '@rise/shared/schemas';
import { bool, newId, type UserId } from './util';

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
  });

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
  },
): Promise<Category> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO category (id, user_id, group_id, name, emoji, rollover_policy, spend_shape, is_bill)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(id, userId, c.groupId, c.name, c.emoji, c.rolloverPolicy, c.spendShape, bool(c.isBill))
    .run();
  return (await getCategory(userId, db, id)) as Category;
}

export interface CategoryPatch {
  name?: string | undefined;
  groupId?: string | undefined;
  rolloverPolicy?: RolloverPolicy | undefined;
  spendShape?: SpendShape | undefined;
  isBill?: boolean | undefined;
}

const COLS: Record<keyof CategoryPatch, string> = {
  name: 'name',
  groupId: 'group_id',
  rolloverPolicy: 'rollover_policy',
  spendShape: 'spend_shape',
  isBill: 'is_bill',
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
