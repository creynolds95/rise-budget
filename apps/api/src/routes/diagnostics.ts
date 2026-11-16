import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { buildDiagnostics, buildTxnHistory } from '../lib/diagnostics';

/**
 * Read-only, redacted view of what sync did (migration 0036). The same routes back the
 * Settings export and the Claude connector's diagnostics tools. Nothing here writes.
 */
export const diagnostics = new Hono<AppEnv>();

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

/** Runs, per-row decisions, balance history and signals for the last `days` (default 7, max 60). */
diagnostics.get('/', async (c) =>
  c.json(
    await buildDiagnostics(c.get('userId'), c.env.DB, {
      days: num(c.req.query('days')) ?? 7,
      limit: num(c.req.query('limit')) ?? 600,
    }),
  ),
);

/** The same snapshot as a pasteable file. */
diagnostics.get('/export', async (c) => {
  const snap = await buildDiagnostics(c.get('userId'), c.env.DB, {
    days: num(c.req.query('days')) ?? 14,
    limit: 2000,
  });
  c.header('content-disposition', 'attachment; filename="rise-diagnostics.json"');
  return c.json(snap);
});

diagnostics.get('/transactions/:id', async (c) => {
  const h = await buildTxnHistory(c.get('userId'), c.env.DB, c.req.param('id'));
  if (!h) throw new AppError(404, 'NOT_FOUND', 'No such transaction');
  return c.json(h);
});
