import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { runBackup } from '../src/backup/run';
import { gunzip } from '../src/backup/sql';
import { meterDb, type Tally } from '../src/lib/usage';
import { call, signedInUser } from './helpers/http';

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
    await call('GET', '/periods/2026-10', { access: u.access });
    await call('GET', '/periods/2026-11', { access: u.access });
    const r = await call('GET', '/usage', { access: u.access });
    const row = r.json.routes.find((x: { route: string }) => x.route === 'GET /api/periods/:id');
    expect(row?.requests).toBeGreaterThanOrEqual(2);
    expect(row?.rowsRead).toBeGreaterThan(0);
  });
});

describe('latest backup download', () => {
  it('404s with none, then serves the gzipped dump', async () => {
    const u = await signedInUser();
    const keys = await env.BACKUPS.list({ prefix: 'backups/' });
    if (keys.objects.length) await env.BACKUPS.delete(keys.objects.map((o) => o.key));
    expect((await call('GET', '/export/backups/latest', { access: u.access })).status).toBe(404);
    await runBackup(env.DB, env.BACKUPS, new Date());
    const res = await exports.default.fetch('https://rise.test/api/export/backups/latest', {
      headers: { authorization: `Bearer ${u.access}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('rise-backup-');
    expect(await gunzip(await res.arrayBuffer())).toContain('CREATE TABLE');
  });
});
