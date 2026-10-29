import { env, exports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { backupKey, gunzip, gzip } from '../src/backup/sql';
import { addUsage, dumpDatabase, listRouteUsage, listUsage, ROUTE_USAGE_MIN_ROWS } from '../src/db';
import { meterDb, type Tally } from '../src/lib/usage';
import { call, signedInUser } from './helpers/http';
import { seedProdShape } from './helpers/prodShape';

describe('D1 usage meter', () => {
  it('counts rows read and written per statement, batch and first()', async () => {
    const tally: Tally = { read: 0, written: 0 };
    const db = meterDb(env.DB, tally);
    await db.prepare('CREATE TABLE IF NOT EXISTS zz_meter (n INTEGER)').run();
    await db.batch(
      [1, 2, 3].map((n) => db.prepare('INSERT INTO zz_meter (n) VALUES (?1)').bind(n)),
    );
    expect(tally.written).toBeGreaterThanOrEqual(3);
    const before = tally.read;
    const row = await db.prepare('SELECT COUNT(*) AS n FROM zz_meter').first<{ n: number }>();
    expect(row?.n).toBe(3);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM zz_meter').first('n')).toBe(3);
    expect(tally.read).toBeGreaterThan(before);
    expect((await db.prepare('SELECT n FROM zz_meter WHERE n = 99').all()).results).toEqual([]);
    expect(await db.prepare('SELECT n FROM zz_meter WHERE n = 99').first()).toBeNull();
  });

  it('logs a statement that reads too many rows, with its SQL, in a batch too', async () => {
    const tally: Tally = { read: 0, written: 0 };
    const db = meterDb(env.DB, tally, 3);
    await db.prepare('CREATE TABLE IF NOT EXISTS zz_heavy (n INTEGER)').run();
    await db.batch(
      [1, 2, 3, 4, 5].map((n) => db.prepare('INSERT INTO zz_heavy (n) VALUES (?1)').bind(n)),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.prepare('SELECT n FROM zz_heavy').all();
    await db.batch([db.prepare('SELECT COUNT(*) FROM zz_heavy')]);
    const logged = spy.mock.calls.map((c) => JSON.parse(c[0] as string) as { sql: string });
    spy.mockRestore();
    expect(logged.map((l) => l.sql)).toEqual([
      'SELECT n FROM zz_heavy',
      'SELECT COUNT(*) FROM zz_heavy',
    ]);
  });

  it('GET /usage reports today from the requests already made', async () => {
    const u = await signedInUser();
    await call('GET', '/accounts', { access: u.access });
    const r = await call('GET', '/usage', { access: u.access });
    expect(r.status).toBe(200);
    expect(r.json.limits).toEqual({ rowsRead: 5_000_000, rowsWritten: 100_000 });
    const today = new Date().toISOString().slice(0, 10);
    expect(r.json.days[0].day).toBe(today);
    expect(r.json.days[0].rowsRead).toBeGreaterThan(0);
    expect(r.json.days[0].requests).toBeGreaterThan(0);
  });

  it('names the heaviest routes by pattern, not by URL', async () => {
    const u = await signedInUser();
    await seedProdShape(u.userId, 'use');
    await call('GET', '/periods/2026-09', { access: u.access });
    await call('GET', '/periods/2026-08', { access: u.access });
    const r = await call('GET', '/usage', { access: u.access });
    const row = r.json.routes.find((x: { route: string }) => x.route === 'GET /api/periods/:id');
    expect(row?.requests).toBeGreaterThanOrEqual(2);
    expect(row?.rowsRead).toBeGreaterThanOrEqual(2 * ROUTE_USAGE_MIN_ROWS);
  });

  it('a light request counts toward the day but writes no per-route row', async () => {
    const now = new Date('2031-03-04T12:00:00Z');
    await addUsage(env.DB, now, ROUTE_USAGE_MIN_ROWS - 1, 2, 1, 'GET /api/light');
    await addUsage(env.DB, now, ROUTE_USAGE_MIN_ROWS, 0, 1, 'GET /api/heavy');
    expect((await listRouteUsage(env.DB, now, 10)).map((r) => r.route)).toEqual(['GET /api/heavy']);
    expect((await listUsage(env.DB, now, 1))[0]).toMatchObject({
      rows_read: 2 * ROUTE_USAGE_MIN_ROWS - 1,
      rows_written: 2,
      requests: 2,
    });
  });
});

describe('latest backup download', () => {
  it('404s with none, then serves the gzipped dump', async () => {
    const u = await signedInUser();
    const keys = await env.BACKUPS.list({ prefix: 'backups/' });
    if (keys.objects.length) await env.BACKUPS.delete(keys.objects.map((o) => o.key));
    const stepUp = { 'x-step-up': u.stepUp };
    expect(
      (await call('GET', '/export/backups/latest', { access: u.access, headers: stepUp })).status,
    ).toBe(404);
    // What the `backup` workflow uploads.
    const now = new Date();
    await env.BACKUPS.put(backupKey(now), await gzip(await dumpDatabase(env.DB, now)));
    const res = await exports.default.fetch('https://rise.test/api/export/backups/latest', {
      headers: { authorization: `Bearer ${u.access}`, ...stepUp },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('rise-backup-');
    expect(await gunzip(await res.arrayBuffer())).toContain('CREATE TABLE');
  });
});
