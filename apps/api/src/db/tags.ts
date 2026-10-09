import { Tag, type TagSummary, type TaxKind } from '@rise/shared/schemas';
import type { TaxRowInput } from '@rise/shared/reports';
import { newId, nowIso, type UserId } from './util';

interface TagRow {
  id: string;
  name: string;
  tax_kind: string | null;
  created_at: string;
}

const toTag = (r: TagRow): Tag =>
  Tag.parse({ id: r.id, name: r.name, taxKind: r.tax_kind, createdAt: r.created_at });

/** Every tag with how many transactions carry it and their net, all time. */
export async function listTagSummaries(userId: UserId, db: D1Database): Promise<TagSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.name, g.tax_kind, COUNT(t.id) AS n, COALESCE(SUM(t.amount_cents), 0) AS net
       FROM tag g
       LEFT JOIN txn_tag tt ON tt.user_id = g.user_id AND tt.tag_id = g.id
       LEFT JOIN txn t ON t.id = tt.txn_id AND t.user_id = g.user_id AND t.review_state != 'dropped'
       WHERE g.user_id = ?1
       GROUP BY g.id ORDER BY g.name COLLATE NOCASE`,
    )
    .bind(userId)
    .all<{ id: string; name: string; tax_kind: string | null; n: number; net: number }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    taxKind: r.tax_kind as TaxKind | null,
    count: r.n,
    netCents: r.net,
  }));
}

export async function getTag(userId: UserId, db: D1Database, id: string): Promise<Tag | null> {
  const row = await db
    .prepare('SELECT id, name, tax_kind, created_at FROM tag WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id)
    .first<TagRow>();
  return row ? toTag(row) : null;
}

export async function tagNameTaken(
  userId: UserId,
  db: D1Database,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM tag WHERE user_id = ?1 AND name = ?2 COLLATE NOCASE')
    .bind(userId, name)
    .first<{ id: string }>();
  return !!row && row.id !== exceptId;
}

export async function createTag(
  userId: UserId,
  db: D1Database,
  t: { name: string; taxKind: TaxKind | null },
): Promise<Tag> {
  const id = newId();
  await db
    .prepare(
      'INSERT INTO tag (id, user_id, name, tax_kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
    .bind(id, userId, t.name, t.taxKind, nowIso())
    .run();
  return (await getTag(userId, db, id)) as Tag;
}

export async function updateTag(
  userId: UserId,
  db: D1Database,
  id: string,
  p: { name?: string | undefined; taxKind?: TaxKind | null | undefined },
): Promise<void> {
  await db
    .prepare(
      `UPDATE tag SET name = COALESCE(?3, name), tax_kind = CASE WHEN ?4 THEN ?5 ELSE tax_kind END
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(userId, id, p.name ?? null, p.taxKind !== undefined ? 1 : 0, p.taxKind ?? null)
    .run();
}

/** Removes the label from every transaction too. No money moves. */
export async function deleteTag(userId: UserId, db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM txn_tag WHERE user_id = ?1 AND tag_id = ?2').bind(userId, id),
    db.prepare('DELETE FROM tag WHERE user_id = ?1 AND id = ?2').bind(userId, id),
  ]);
}

/** How many of these ids are the user's own tags. */
export async function countOwnTags(userId: UserId, db: D1Database, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM tag WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))',
    )
    .bind(userId, JSON.stringify(ids))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Replace a transaction's tags with exactly this set. */
export async function setTxnTags(
  userId: UserId,
  db: D1Database,
  txnId: string,
  tagIds: string[],
): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM txn_tag WHERE user_id = ?1 AND txn_id = ?2').bind(userId, txnId),
    ...tagIds.map((tagId) =>
      db
        .prepare('INSERT INTO txn_tag (txn_id, tag_id, user_id) VALUES (?1, ?2, ?3)')
        .bind(txnId, tagId, userId),
    ),
  ]);
}

/** Add tags to many transactions at once; only the user's own transactions are touched. */
export async function addTxnTags(
  userId: UserId,
  db: D1Database,
  txnIds: string[],
  tagIds: string[],
): Promise<void> {
  const ids = JSON.stringify(txnIds);
  await db.batch(
    tagIds.map((tagId) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO txn_tag (txn_id, tag_id, user_id)
           SELECT id, ?2, ?1 FROM txn WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?3))`,
        )
        .bind(userId, tagId, ids),
    ),
  );
}

/**
 * The year's tax rows: splits filed to a category with a tax heading, and whole transactions
 * carrying a tag with one. Driven from the few tax categories and tags: each tax category's
 * splits month by month off the (user, period, category) index, from the year's first month to
 * 11 past its last (a spread part is never earlier than its charge, nor more than 11 later),
 * then each transaction by id. CROSS JOIN pins that order.
 */
export async function taxRows(
  userId: UserId,
  db: D1Database,
  from: string,
  to: string,
): Promise<{ byCategory: TaxRowInput[]; byTag: TaxRowInput[] }> {
  type Row = {
    txn_id: string;
    posted_at: string;
    merchant: string;
    account_id: string;
    amount_cents: number;
    kind: TaxKind;
    source: string;
  };
  const [cats, tags] = await db.batch<Row>([
    db
      .prepare(
        `WITH RECURSIVE m(id) AS (
           SELECT substr(?2, 1, 7)
           UNION ALL SELECT strftime('%Y-%m', id || '-01', '+1 month') FROM m
           WHERE id < strftime('%Y-%m', ?3, '+11 months'))
         SELECT t.id AS txn_id, t.posted_at, COALESCE(t.merchant_display, t.merchant_normalized) AS merchant,
                t.account_id, s.amount_cents, c.tax_kind AS kind, c.name AS source
         FROM category c
         CROSS JOIN m
         CROSS JOIN split s INDEXED BY ix_split_period_cat
           ON s.user_id = c.user_id AND s.period_id = m.id AND s.category_id = c.id
         CROSS JOIN txn t ON t.id = s.txn_id
         WHERE c.user_id = ?1 AND c.tax_kind IS NOT NULL AND t.user_id = ?1
           AND t.posted_at BETWEEN ?2 AND ?3 AND t.review_state != 'dropped'`,
      )
      .bind(userId, from, to),
    db
      .prepare(
        `SELECT t.id AS txn_id, t.posted_at, COALESCE(t.merchant_display, t.merchant_normalized) AS merchant,
                t.account_id, t.amount_cents, g.tax_kind AS kind, g.name AS source
         FROM tag g
         CROSS JOIN txn_tag tt ON tt.user_id = g.user_id AND tt.tag_id = g.id
         JOIN txn t ON t.id = tt.txn_id AND t.user_id = g.user_id
         WHERE g.user_id = ?1 AND g.tax_kind IS NOT NULL AND t.posted_at BETWEEN ?2 AND ?3
           AND t.review_state != 'dropped'`,
      )
      .bind(userId, from, to),
  ]);
  const map = (r: Row): TaxRowInput => ({
    txnId: r.txn_id,
    postedAt: r.posted_at,
    merchant: r.merchant,
    accountId: r.account_id,
    amountCents: r.amount_cents,
    kind: r.kind,
    source: r.source,
  });
  return { byCategory: (cats?.results ?? []).map(map), byTag: (tags?.results ?? []).map(map) };
}
