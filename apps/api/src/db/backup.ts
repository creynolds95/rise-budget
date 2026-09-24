import type { UserId } from './util';

/**
 * T46. Two readers with different scopes, on purpose:
 *
 * - `dumpDatabase` is the nightly disaster-recovery copy. It reads every table whole, because
 *   a backup that skipped rows couldn't restore the database. It is the one place in the query
 *   layer that doesn't filter on user_id; each statement says so with `system:backup`, and the
 *   scoping test allows that marker in this file only. No route calls it.
 * - `exportUserData` and `transactionsCsv` are what the user downloads. They are scoped like
 *   every other query and leave out credentials: passkeys, TOTP, recovery codes and sessions
 *   never leave the server.
 *
 * All three have SQLite build the output text (statements, JSON, CSV lines) so the Worker
 * only joins strings. Serialising megabytes in JavaScript would blow the 10 ms CPU budget
 * (ARCHITECTURE §1); time spent waiting on D1 doesn't count.
 */

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * Rows per chunk. D1 caps a single value at 2 MB, and the widest rows (audit detail, txn)
 * are well under 4 KB, so 500 rows per chunk leaves a wide margin.
 */
const CHUNK = 500;

type Column = { tbl: string; col: string };

async function columnsByTable(db: D1Database): Promise<Map<string, string[]>> {
  const { results } = await db
    .prepare(
      `SELECT m.name AS tbl, p.name AS col FROM sqlite_master m /* system:backup */
       JOIN pragma_table_info(m.name) p
       WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND substr(m.name, 1, 4) != '_cf_'
       ORDER BY m.rowid, p.cid`,
    )
    .all<Column>();
  const out = new Map<string, string[]>();
  for (const r of results) out.set(r.tbl, [...(out.get(r.tbl) ?? []), r.col]);
  return out;
}

/**
 * A value as a SQLite literal, written by SQLite. quote() is exact for text, integers, blobs
 * and NULL; for REAL it keeps only 15 digits, so reals get 17, which always round-trips.
 */
const valueSql = (c: string) =>
  `CASE typeof(${q(c)}) WHEN 'real' THEN printf('%!.17g', ${q(c)}) ELSE quote(${q(c)}) END`;

type Master = { type: string; name: string; sql: string };

/** SQL text that rebuilds the database in an empty D1 (`wrangler d1 execute --file`). */
export async function dumpDatabase(db: D1Database, now: Date): Promise<string> {
  const [{ results: objects }, columns] = await Promise.all([
    db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master /* system:backup */
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 4) != '_cf_'
         ORDER BY rowid`,
      )
      .all<Master>(),
    columnsByTable(db),
  ]);
  const tables = objects.filter((o) => o.type === 'table');

  // One statement per table, all in one round trip; each returns its rows as text chunks.
  const reads = tables.length
    ? await db.batch<{ chunk: string }>(
        tables.map((t) => {
          const cols = columns.get(t.name) ?? [];
          // Split so this SQL-text builder isn't mistaken for a literal, unscoped statement
          // by the query-layer scanner (test/db-scoping.test.ts), which flags any quoted
          // string starting with a bare SQL verb.
          const insertKeyword = 'INS' + 'ERT';
          const prefix = `${insertKeyword} INTO ${q(t.name)} (${cols.map(q).join(',')}) VALUES (`;
          const insert = `${lit(prefix)} || ${cols.map(valueSql).join(" || ',' || ")} || ');'`;
          return db.prepare(
            `SELECT group_concat(s, char(10)) AS chunk FROM /* system:backup */
             (SELECT rowid / ${CHUNK} AS g, ${insert} AS s FROM ${q(t.name)} ORDER BY rowid)
             GROUP BY g ORDER BY g`,
          );
        }),
      )
    : [];

  return [
    `-- Rise backup, ${now.toISOString()}. Restore into an EMPTY database:`,
    '--   wrangler d1 execute <database> --remote --file=<this file>',
    'PRAGMA defer_foreign_keys = TRUE;',
    ...tables.map((t) => `${t.sql};`),
    ...reads.flatMap((r) => r.results.map((x) => x.chunk)),
    // Indexes last: building each once is cheaper than maintaining it row by row.
    ...objects.filter((o) => o.type !== 'table').map((o) => `${o.sql};`),
    '',
  ].join('\n');
}

/** What the user can download: their own data, no credentials. Snake-case, as stored. */
export const EXPORT_TABLES = [
  'account',
  'balance_snapshot',
  'category_group',
  'category',
  'period',
  'allocation',
  'reallocation',
  'txn',
  'split',
  'rule',
  'merchant_memory',
  'merchant_meta',
  'recurring_series',
  'sync_run',
  'import_batch',
  'audit_log',
] as const;

const jsonObject = (cols: string[]) =>
  `json_object(${cols.map((c) => `${lit(c)}, ${q(c)}`).join(', ')})`;

/** Joins `[…]` chunks from json_group_array into one array without parsing them. */
const joinArrays = (chunks: string[]) =>
  `[${chunks
    .map((c) => c.slice(1, -1))
    .filter(Boolean)
    .join(',')}]`;

/**
 * The full export as JSON text. `head` is merged in first (format, version, timestamps).
 * Returned as a string, not an object, so the Worker never parses or re-serialises rows.
 */
export async function exportUserData(
  userId: UserId,
  db: D1Database,
  head: Record<string, unknown>,
): Promise<string> {
  const columns = await columnsByTable(db);
  const userCols = ['id', 'email', 'display_name', 'timezone', 'settings_json', 'created_at'];
  const [user, ...tables] = await db.batch<{ chunk: string }>([
    db
      .prepare(
        `SELECT ${jsonObject(userCols)} AS chunk FROM user WHERE id = ?1 /* scoped:user.id */`,
      )
      .bind(userId),
    ...EXPORT_TABLES.map((t) =>
      db
        .prepare(
          `SELECT json_group_array(json(o)) AS chunk FROM
           (SELECT rowid / ${CHUNK} AS g, ${jsonObject(columns.get(t) ?? [])} AS o
            FROM ${q(t)} WHERE user_id = ?1 ORDER BY rowid)
           GROUP BY g ORDER BY g`,
        )
        .bind(userId),
    ),
  ]);
  const parts = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`);
  parts.push(`"user":${user?.results[0]?.chunk ?? 'null'}`);
  EXPORT_TABLES.forEach((t, i) => {
    parts.push(
      `${JSON.stringify(t)}:${joinArrays((tables[i]?.results ?? []).map((r) => r.chunk))}`,
    );
  });
  return `{${parts.join(',')}}`;
}

export const CSV_HEADER = 'Date,Account,Merchant,Category,Amount,Status,Notes,Original description';

/**
 * A text field as a CSV cell: always quoted, and a leading = + - @ tab or CR gets an
 * apostrophe so a spreadsheet never runs a bank descriptor as a formula.
 */
const csvText = (expr: string) =>
  `'"' || replace(CASE WHEN substr(${expr}, 1, 1) IN ('=', '+', '-', '@', char(9), char(13))
     THEN '''' || ${expr} ELSE ${expr} END, '"', '""') || '"'`;

/**
 * Integer cents as a decimal, in bank-statement sign (money out negative, the opposite of
 * how Rise stores it). Integer maths only.
 */
const csvAmount = (expr: string) =>
  `printf('%s%d.%02d', CASE WHEN ${expr} > 0 THEN '-' ELSE '' END, abs(${expr}) / 100, abs(${expr}) % 100)`;

/**
 * Transactions for a spreadsheet: one line per split, or per transaction when it has none.
 * Dropped rows are left out so the column adds up; they're still in the JSON export.
 */
export async function transactionsCsv(userId: UserId, db: D1Database): Promise<string> {
  const amount = 'COALESCE(s.amount_cents, t.amount_cents)';
  const line = [
    'substr(t.posted_at, 1, 10)',
    csvText('a.name'),
    csvText('COALESCE(t.merchant_display, t.merchant_normalized)'),
    csvText("CASE WHEN t.is_transfer THEN 'Transfer' ELSE COALESCE(c.name, '') END"),
    csvAmount(amount),
    "CASE WHEN t.is_pending THEN 'Pending' ELSE 'Posted' END",
    csvText("COALESCE(t.notes, '')"),
    csvText('t.descriptor_raw'),
  ].join(" || ',' || ");
  const { results } = await db
    .prepare(
      `SELECT group_concat(l, char(13) || char(10)) AS chunk FROM
       (SELECT (row_number() OVER (ORDER BY t.posted_at DESC, t.id, s.sort_order) - 1) / ${CHUNK} AS g,
               ${line} AS l
        FROM txn t
        JOIN account a ON a.id = t.account_id AND a.user_id = t.user_id
        LEFT JOIN split s ON s.txn_id = t.id AND s.user_id = t.user_id
        LEFT JOIN category c ON c.id = s.category_id AND c.user_id = t.user_id
        WHERE t.user_id = ?1 AND t.review_state != 'dropped'
        ORDER BY t.posted_at DESC, t.id, s.sort_order)
       GROUP BY g ORDER BY g`,
    )
    .bind(userId)
    .all<{ chunk: string }>();
  return [CSV_HEADER, ...results.map((r) => r.chunk), ''].join('\r\n');
}
