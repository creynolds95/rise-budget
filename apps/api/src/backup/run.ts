import { pruneOperational } from '../db/backup';
import { backupDate, expiredBackups } from './sql';

/**
 * Must match the housekeeping entry in wrangler.toml [triggers]. Kept out of src/index.ts: any
 * named export of the Worker's entry module has to be a handler function (or `default`), and
 * Wrangler/Miniflare reject a plain constant there ("not of type function or ExportedHandler").
 */
export const HOUSEKEEPING_CRON = '30 9 * * *';

export type HousekeepingResult = { pruned: string[]; rowsPruned: number };

/**
 * The nightly cleanup (ARCHITECTURE §8): prune operational rows, then drop backups past 90
 * days. The backup itself is written by the `backup` GitHub workflow (`wrangler d1 export`),
 * which runs after this: a whole-database dump doesn't fit a free-plan Worker's CPU limit.
 */
export async function runHousekeeping(
  db: D1Database,
  bucket: R2Bucket,
  now: Date,
): Promise<HousekeepingResult> {
  const rowsPruned = await pruneOperational(db, now);
  const keys = await listBackups(bucket);
  const pruned = expiredBackups(
    keys.map((k) => k.key),
    now,
  );
  if (pruned.length) await bucket.delete(pruned);
  return { pruned, rowsPruned };
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
