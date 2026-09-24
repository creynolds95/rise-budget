import { BackupStatus, ExportQuery } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { listBackups } from '../backup/run';
import { exportUserData, transactionsCsv, writeAudit } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';

/** T46: the user can always walk away with their data (ARCHITECTURE §8). */
export const dataExport = new Hono<AppEnv>();

dataExport.get('/', async (c) => {
  const q = ExportQuery.safeParse(c.req.query());
  if (!q.success) throw new AppError(400, 'BAD_REQUEST', 'format must be json or csv');
  const { format } = q.data;
  const userId = c.get('userId');
  const today = new Date().toISOString().slice(0, 10);

  const [body, type, name] =
    format === 'csv'
      ? [
          await transactionsCsv(userId, c.env.DB),
          'text/csv; charset=utf-8',
          `rise-transactions-${today}.csv`,
        ]
      : [
          await exportUserData(userId, c.env.DB, {
            format: 'rise-export',
            version: 1,
            exportedAt: new Date().toISOString(),
            note: 'Amounts are integer cents. Spending is positive, income negative.',
          }),
          'application/json',
          `rise-export-${today}.json`,
        ];

  // SPEC §9: export is audited. Only the format is recorded, never the contents.
  await writeAudit(userId, c.env.DB, 'data.exported', { detail: { format } });
  return c.body(body, 200, {
    'content-type': type,
    'content-disposition': `attachment; filename="${name}"`,
    'cache-control': 'no-store',
  });
});

dataExport.get('/backups', async (c) => {
  const all = await listBackups(c.env.BACKUPS);
  const last = all.at(-1);
  return c.json(
    BackupStatus.parse({
      latest: last ? { date: last.date, bytes: last.bytes } : null,
      count: all.length,
    }),
  );
});
