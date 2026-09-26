import { dumpDatabase, pruneOperational } from '../db/backup';
import { backupDate, backupKey, expiredBackups, gzip } from './sql';

/**
 * Must match the backup entry in wrangler.toml [triggers]. Kept out of src/index.ts: any
 * named export of the Worker's entry module has to be a handler function (or `default`), and
 * Wrangler/Miniflare reject a plain constant there ("not of type function or ExportedHandler").
 */
export const BACKUP_CRON = '30 9 * * *';

export type BackupResult = { key: string; bytes: number; pruned: string[]; rowsPruned: number };

/** The nightly job (ARCHITECTURE §8): prune ops rows → dump → gzip → R2, then drop old backups. */
export async function runBackup(
  db: D1Database,
  bucket: R2Bucket,
  now: Date,
): Promise<BackupResult> {
  const rowsPruned = await pruneOperational(db, now);
  const body = await gzip(await dumpDatabase(db, now));
  const key = backupKey(now);
  await bucket.put(key, body, {
    httpMetadata: { contentType: 'application/sql', contentEncoding: 'gzip' },
    customMetadata: { createdAt: now.toISOString() },
  });
  const keys = await listBackups(bucket);
  const pruned = expiredBackups(
    keys.map((k) => k.key),
    now,
  );
  if (pruned.length) await bucket.delete(pruned);
  return { key, bytes: body.byteLength, pruned, rowsPruned };
}

export async function listBackups(
  bucket: R2Bucket,
): Promise<{ key: string; date: string; bytes: number }[]> {
  const out: { key: string; date: string; bytes: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: 'backups/', ...(cursor ? { cursor } : {}) });
    for (const o of page.objects) {
      const date = backupDate(o.key);
      if (date) out.push({ key: o.key, date, bytes: o.size });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
