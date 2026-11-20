import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { ClientPerfBody } from '@rise/shared/activity';
import { upsertPerfStmt } from '../db';
import { buildActivityReport } from '../lib/activityReport';
import { buildDiagnostics, buildTxnHistory } from '../lib/diagnostics';
import { body } from '../lib/validate';

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

/**
 * The on-demand review (summary by default; `mode=detail` adds every edit and sync decision).
 * Backs the connector's `review_activity` tool.
 */
diagnostics.get('/activity', async (c) =>
  c.json(
    await buildActivityReport(c.get('userId'), c.env.DB, {
      days: num(c.req.query('days')) ?? 7,
      mode: c.req.query('mode') === 'detail' ? 'detail' : 'summary',
    }),
  ),
);

/** The browser's own timings and failures, batched; aggregated like server latency. */
diagnostics.post('/client', async (c) => {
  const b = await body(c, ClientPerfBody);
  const now = new Date();
  if (b.samples.length > 0)
    await c.env.DB.batch(
      b.samples.map((s) =>
        upsertPerfStmt(c.env.DB, now, {
          kind: 'client',
          route: s.route,
          requests: s.n,
          errors: s.errors,
          slow: 0,
          msTotal: s.msTotal,
          msMax: s.msMax,
          rowsRead: 0,
          rowsWritten: 0,
        }),
      ),
    );
  return c.body(null, 204);
});
