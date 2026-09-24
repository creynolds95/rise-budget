import { RunSyncBody } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { listSyncRuns } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';
import { runSync } from '../sync/run';
import { sourceFromEnv } from '../sync/source';

export const sync = new Hono<AppEnv>();

/** Manual trigger (SPEC §6.1). Read-only by protocol: SimpleFIN cannot move money. */
sync.post('/run', async (c) => {
  const source = sourceFromEnv(c.env);
  if (!source) throw new AppError(409, 'CONFLICT', 'SimpleFIN is not connected yet');
  const { since } = await body(c, RunSyncBody);
  const result = await runSync(c.env.DB, c.get('userId'), source, since ? { since } : {});
  return c.json(result);
});

sync.get('/status', async (c) => {
  const source = sourceFromEnv(c.env);
  const runs = await listSyncRuns(c.get('userId'), c.env.DB);
  return c.json({
    mode: source?.mode ?? 'off',
    runs: runs.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      accountsTouched: r.accounts_touched,
      rowsInserted: r.rows_inserted,
      rowsUpdated: r.rows_updated,
      errors: r.error_json ? (JSON.parse(r.error_json) as unknown[]) : [],
    })),
  });
});
