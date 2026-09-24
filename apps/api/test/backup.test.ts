import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_CRON, runBackup } from '../src/backup/run';
import { backupKey, expiredBackups, gunzip, gzip, splitSql } from '../src/backup/sql';
import { dumpDatabase } from '../src/db';
import { scheduled as handler } from '../src/index';
import { BASE, call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, {
      access: u.access,
      body,
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
  const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' })).json;
  const food = (await api('POST', '/categories', { groupId: group.id, name: 'Groceries' })).json;
  const cash = (await api('POST', '/accounts', { name: 'Cash', kind: 'depository' })).json;
  // Awkward text on purpose: quotes, a newline, a formula lead, non-ASCII.
  await api('POST', '/transactions', {
    accountId: cash.id,
    postedAt: '2026-09-12',
    amountCents: 4_231,
    descriptor: '=HYPERLINK("x") O\'BRIEN\'S\nMARKET ☕',
    categoryId: food.id,
  });
  await api('POST', '/transactions', {
    accountId: cash.id,
    postedAt: '2026-09-15',
    amountCents: -250_000,
    descriptor: 'PAYROLL',
  });
  return { ...u, api, food, cash };
}

async function tableRows(db: D1Database) {
  const { results } = await db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND substr(name, 1, 4) != '_cf_' ORDER BY name",
    )
    .all<{ name: string; sql: string | null }>();
  const out: Record<string, unknown> = { schema: results };
  for (const { name } of results) {
    const isTable = await db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1")
      .bind(name)
      .first();
    if (!isTable) continue;
    // typeof() per column catches a value that came back with a different storage class.
    const cols = (await db.prepare(`PRAGMA table_info("${name}")`).all<{ name: string }>()).results;
    const typed = cols.map((c) => `"${c.name}", typeof("${c.name}")`).join(', ');
    out[name] = (await db.prepare(`SELECT ${typed} FROM "${name}" ORDER BY rowid`).raw()).map(
      (r) => r,
    );
  }
  return out;
}

// Storage persists across tests in this file, so each test starts from an empty bucket and
// an empty restore target.
beforeEach(async () => {
  const keys = (await env.BACKUPS.list()).objects.map((o) => o.key);
  if (keys.length) await env.BACKUPS.delete(keys);
  const { results } = await env.RESTORE.prepare(
    "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 4) != '_cf_' ORDER BY rowid DESC",
  ).all<{ type: string; name: string }>();
  // Children before parents, so no drop trips a foreign key.
  if (results.length)
    await env.RESTORE.batch([
      env.RESTORE.prepare('PRAGMA defer_foreign_keys = TRUE'),
      ...results.map((r) => env.RESTORE.prepare(`DROP ${r.type.toUpperCase()} "${r.name}"`)),
    ]);
});

describe('T46 backup and restore', () => {
  it('a restore from the R2 backup into a fresh D1 reproduces the data exactly', async () => {
    await setup();
    const now = new Date('2026-09-24T09:30:00Z');
    const r = await runBackup(env.DB, env.BACKUPS, now);
    expect(r.key).toBe('backups/2026-09-24.sql.gz');

    const obj = await env.BACKUPS.get(r.key);
    expect(obj?.httpMetadata?.contentEncoding).toBe('gzip');
    const sql = await gunzip(await (obj as R2ObjectBody).arrayBuffer());

    // What `wrangler d1 execute --file` does: every statement, one transaction.
    const restore = env.RESTORE;
    expect(
      (
        await restore
          .prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%'",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
    await restore.batch(splitSql(sql).map((s) => restore.prepare(s)));

    const [before, after] = [await tableRows(env.DB), await tableRows(restore)];
    expect(Object.keys(after).length).toBeGreaterThan(20);
    expect(after).toEqual(before);
    // Spot-check the awkward row survived byte for byte.
    const t = await restore
      .prepare('SELECT descriptor_raw, amount_cents FROM txn WHERE amount_cents = 4231')
      .first<{ descriptor_raw: string; amount_cents: number }>();
    expect(t?.descriptor_raw).toBe('=HYPERLINK("x") O\'BRIEN\'S\nMARKET ☕');
  });

  it('the restored database keeps its migration history, so later migrations apply on top', async () => {
    const sql = await dumpDatabase(env.DB, new Date());
    await env.RESTORE.batch(splitSql(sql).map((s) => env.RESTORE.prepare(s)));
    const names = (
      await env.RESTORE.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{
        name: string;
      }>()
    ).results.map((r) => r.name);
    expect(names).toEqual(env.TEST_MIGRATIONS.map((m) => m.name));
  });

  it('prunes backups past 90 days and leaves everything else in the bucket alone', async () => {
    const put = (k: string) => env.BACKUPS.put(k, 'x');
    await Promise.all([
      put('backups/2026-06-01.sql.gz'), // 115 days old
      put('backups/2026-06-26.sql.gz'), // exactly 90: kept
      put('backups/notes.txt'),
      put('other/2020-01-01.sql.gz'),
    ]);
    const r = await runBackup(env.DB, env.BACKUPS, new Date('2026-09-24T09:30:00Z'));
    expect(r.pruned).toEqual(['backups/2026-06-01.sql.gz']);
    const keys = (await env.BACKUPS.list()).objects.map((o) => o.key).sort();
    expect(keys).toEqual([
      'backups/2026-06-26.sql.gz',
      'backups/2026-09-24.sql.gz',
      'backups/notes.txt',
      'other/2020-01-01.sql.gz',
    ]);
  });

  it('runs from the nightly cron and not from the sync crons', async () => {
    await handler(
      {
        cron: '0 8,14,22 * * *',
        scheduledTime: Date.parse('2026-09-24T08:00:00Z'),
      } as ScheduledController,
      env as never,
    );
    expect((await env.BACKUPS.list({ prefix: 'backups/' })).objects).toHaveLength(0);
    await handler(
      {
        cron: BACKUP_CRON,
        scheduledTime: Date.parse('2026-09-24T09:30:00Z'),
      } as ScheduledController,
      env as never,
    );
    expect((await env.BACKUPS.list({ prefix: 'backups/' })).objects.map((o) => o.key)).toEqual([
      'backups/2026-09-24.sql.gz',
    ]);
  });
});

describe('T46 export', () => {
  it('JSON has the user’s data, no credentials, nobody else’s rows, and is audited', async () => {
    const s = await setup();
    const other = await setup();
    const r = await s.api('GET', '/export');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(
      /^attachment; filename="rise-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(r.headers.get('cache-control')).toBe('no-store');
    const data = r.json;
    expect(data.format).toBe('rise-export');
    expect(data.user.id).toBe(s.userId);
    expect(data.txn).toHaveLength(2);
    expect(data.account.map((a: { name: string }) => a.name)).toEqual(['Cash']);
    for (const k of ['credential', 'totp_secret', 'recovery_code', 'session', 'idempotency'])
      expect(data).not.toHaveProperty(k);
    const text = JSON.stringify(data);
    expect(text).not.toContain(other.userId);
    expect(text).not.toContain(other.email);

    const audit = await env.DB.prepare(
      "SELECT detail_json FROM audit_log WHERE user_id = ?1 AND action = 'data.exported'",
    )
      .bind(s.userId)
      .all<{ detail_json: string }>();
    expect(audit.results.map((a) => JSON.parse(a.detail_json))).toEqual([{ format: 'json' }]);
  });

  it('CSV is spreadsheet-safe: bank-style signs, quoted text, formulas defused', async () => {
    const s = await setup();
    const res = await exports.default.fetch(`${BASE}/export?format=csv`, {
      headers: { authorization: `Bearer ${s.access}` },
    });
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    const text = await res.text();
    const lines = text.split('\r\n');
    expect(lines[0]).toBe(
      'Date,Account,Merchant,Category,Amount,Status,Notes,Original description',
    );
    expect(lines[1]).toMatch(/^2026-09-15,"Cash","[^"]*","",2500\.00,Posted,"","PAYROLL"$/);
    expect(lines[2]).toMatch(
      /^2026-09-12,"Cash",".*","Groceries",-42\.31,Posted,"","'=HYPERLINK\(""x""\) O'BRIEN'S\nMARKET ☕"$/,
    );
  });

  it('CSV gives one row per split, using the split amount, and quotes an account with a comma', async () => {
    const s = await setup();
    const other = (await s.api('POST', '/category-groups', { name: 'Home', kind: 'expense' })).json;
    const rent = (await s.api('POST', '/categories', { groupId: other.id, name: 'Rent' })).json;
    const joint = (await s.api('POST', '/accounts', { name: 'Chase, Joint', kind: 'depository' }))
      .json;
    const t = (
      await s.api('POST', '/transactions', {
        accountId: joint.id,
        postedAt: '2026-09-20',
        amountCents: 9_000,
        descriptor: 'LANDLORD LLC',
        notes: 'half is roommate\'s "share"',
      })
    ).json;
    await s.api('POST', `/transactions/${t.id}/splits`, {
      splits: [
        { categoryId: rent.id, amountCents: 4_500 },
        { categoryId: s.food.id, amountCents: 4_500 },
      ],
    });
    const res = await exports.default.fetch(`${BASE}/export?format=csv`, {
      headers: { authorization: `Bearer ${s.access}` },
    });
    const lines = (await res.text()).split('\r\n');
    const rows = lines.filter((l) => l.includes('LANDLORD LLC'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatch(
        /^2026-09-20,"Chase, Joint","[^"]*","(Rent|Groceries)",-45\.00,Posted,"half is roommate's ""share""","LANDLORD LLC"$/,
      );
    }
    expect(rows.some((r) => r.includes('"Rent"'))).toBe(true);
    expect(rows.some((r) => r.includes('"Groceries"'))).toBe(true);
  });

  it('rejects an unknown format and needs sign-in', async () => {
    const s = await setup();
    expect((await s.api('GET', '/export?format=xml')).status).toBe(400);
    expect((await call('GET', '/export')).status).toBe(401);
  });

  it('reports the latest backup without exposing it', async () => {
    const s = await setup();
    expect((await s.api('GET', '/export/backups')).json).toEqual({ latest: null, count: 0 });
    await runBackup(env.DB, env.BACKUPS, new Date('2026-09-23T09:30:00Z'));
    await runBackup(env.DB, env.BACKUPS, new Date('2026-09-24T09:30:00Z'));
    const r = (await s.api('GET', '/export/backups')).json;
    expect(r.count).toBe(2);
    expect(r.latest.date).toBe('2026-09-24');
    expect(r.latest.bytes).toBeGreaterThan(100);
  });
});

describe('T46 pure helpers', () => {
  it('splits statements only outside quotes and comments', () => {
    expect(
      splitSql(`-- a comment; not a statement
PRAGMA x = 1;
INSERT INTO "t;x" VALUES ('a;b', 'it''s; fine', 'line
two');
CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; SELECT 2; END;
`),
    ).toEqual([
      'PRAGMA x = 1',
      `INSERT INTO "t;x" VALUES ('a;b', 'it''s; fine', 'line\ntwo')`,
      'CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; SELECT 2; END',
    ]);
    expect(splitSql('SELECT 1')).toEqual(['SELECT 1']);
    expect(splitSql('-- only a comment')).toEqual([]);
  });

  it('names and ages backups by UTC day', () => {
    expect(backupKey(new Date('2026-01-02T23:59:00Z'))).toBe('backups/2026-01-02.sql.gz');
    expect(
      expiredBackups(
        ['backups/2026-01-01.sql.gz', 'backups/2026-04-01.sql.gz', 'backups/x.sql.gz'],
        new Date('2026-04-02T00:00:00Z'),
      ),
    ).toEqual(['backups/2026-01-01.sql.gz']);
  });

  it('round-trips gzip', async () => {
    const text = 'Rise ☕\n'.repeat(1000);
    const z = await gzip(text);
    expect(z.byteLength).toBeLessThan(text.length / 10);
    expect(await gunzip(z)).toBe(text);
  });
});
