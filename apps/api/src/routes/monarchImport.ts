import {
  MONARCH_WINDOW,
  MonarchMergeBody,
  MonarchRowsBody,
  MonarchSetupBody,
} from '@rise/shared/schemas';
import { Hono } from 'hono';
import {
  importMonarchRows,
  listMergeCandidates,
  listMonarchBatches,
  mergeHistoryAccount,
  monarchSetup,
  undoMonarchBatch,
  writeAudit,
} from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { body } from '../lib/validate';

/**
 * Monarch history import. The browser reads the file and does the matching; these routes only
 * create what the person confirmed and write rows in small chunks. Nothing here touches a
 * period, plan or carry: it is history, so the budget going forward is unchanged.
 */
export const monarchImport = new Hono<AppEnv>();

monarchImport.post('/setup', async (c) => {
  const b = await body(c, MonarchSetupBody);
  return c.json(await monarchSetup(c.get('userId'), c.env.DB, b));
});

monarchImport.post('/rows', async (c) => {
  const userId = c.get('userId');
  const b = await body(c, MonarchRowsBody);
  const result = await importMonarchRows(userId, c.env.DB, b, MONARCH_WINDOW);
  if (result.imported > 0) {
    await writeAudit(userId, c.env.DB, 'import.monarch', {
      type: 'import_batch',
      id: b.batchId,
      detail: { ...result },
    });
  }
  return c.json(result);
});

monarchImport.get('/batches', async (c) =>
  c.json(await listMonarchBatches(c.get('userId'), c.env.DB)),
);

monarchImport.delete('/batches/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const removed = await undoMonarchBatch(userId, c.env.DB, id);
  if (removed === 0) throw new AppError(404, 'NOT_FOUND', 'Import not found');
  await writeAudit(userId, c.env.DB, 'import.monarch.undone', {
    type: 'import_batch',
    id,
    detail: { removed },
  });
  return c.body(null, 204);
});

monarchImport.get('/merges', async (c) =>
  c.json(await listMergeCandidates(c.get('userId'), c.env.DB)),
);

monarchImport.post('/merges', async (c) => {
  const userId = c.get('userId');
  const b = await body(c, MonarchMergeBody);
  const moved = await mergeHistoryAccount(userId, c.env.DB, b.historyId, b.liveId);
  await writeAudit(userId, c.env.DB, 'import.monarch.merged', {
    type: 'account',
    id: b.liveId,
    detail: { from: b.historyId, moved },
  });
  return c.json({ moved });
});
