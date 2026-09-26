import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { errorBody, renderError } from './lib/errors';
import { idempotency } from './lib/idempotency';
import { requireAuth } from './lib/session';
import { auth } from './routes/auth';
import { accounts } from './routes/accounts';
import { categories, categoryGroups } from './routes/categories';
import { merchants, rules } from './routes/rules';
import { me } from './routes/me';
import { networth } from './routes/networth';
import { allocations, periods } from './routes/periods';
import { cashToPayday } from './routes/cashToPayday';
import { recurring } from './routes/recurring';
import { reports } from './routes/reports';
import { review } from './routes/review';
import { sync } from './routes/sync';
import { transactions } from './routes/transactions';
import { dataExport } from './routes/export';
import { devices } from './routes/devices';
import { findUserIdByEmail } from './db';
import type { Env } from './env';
import { BACKUP_CRON, runBackup } from './backup/run';
import { runSync } from './sync/run';
import { sourceFromEnv } from './sync/source';

/** Everything is under /api; the rest of the origin is the web app (Workers Static Assets). */
export const app = new Hono<AppEnv>().basePath('/api');

// JSON only: nothing here should ever render, frame or load anything (C17 / L2).
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    crossOriginResourcePolicy: 'same-origin',
  }),
);

// Public: health and the auth handshake. There is no signup route (SPEC §9).
app.get('/health', (c) => c.json({ ok: true as const }));
app.route('/auth', auth);

// Everything else requires a valid access token (T16).
app.use('*', requireAuth);
app.use('*', idempotency);
app.route('/me', me);
app.route('/devices', devices);
app.route('/accounts', accounts);
app.route('/networth', networth);
app.route('/category-groups', categoryGroups);
app.route('/categories', categories);
app.route('/rules', rules);
app.route('/merchants', merchants);
app.route('/periods', periods);
app.route('/allocations', allocations);
app.route('/transactions', transactions);
app.route('/sync', sync);
app.route('/recurring', recurring);
app.route('/cash-to-payday', cashToPayday);
app.route('/review', review);
app.route('/reports', reports);
app.route('/export', dataExport);

app.notFound((c) =>
  c.json(errorBody('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`), 404),
);
app.onError(renderError);

/**
 * Crons: SimpleFIN sync 3× daily (ARCHITECTURE §6), and the nightly backup (§8) at 09:30 UTC
 * (early morning Central), well after the evening sync. Single-user, so sync runs for the configured owner.
 */
export async function scheduled(event: ScheduledController, env: Env): Promise<void> {
  const job = event.cron === BACKUP_CRON ? 'backup' : 'sync';
  const started = Date.now();
  try {
    if (job === 'backup') {
      const r = await runBackup(env.DB, env.BACKUPS, new Date(event.scheduledTime));
      log({
        job,
        ok: true,
        ms: Date.now() - started,
        key: r.key,
        bytes: r.bytes,
        rowsPruned: r.rowsPruned,
      });
      return;
    }
    const source = sourceFromEnv(env);
    if (!source || !env.SIMPLEFIN_OWNER_EMAIL) return;
    const userId = await findUserIdByEmail(env.DB, env.SIMPLEFIN_OWNER_EMAIL);
    if (!userId) return;
    const r = await runSync(env.DB, userId, source);
    log({ job, ok: r.status !== 'failed', ms: Date.now() - started, status: r.status });
  } catch (e) {
    // Rethrown so the Cron Trigger is marked failed in Cloudflare too; the Dashboard flags a
    // failed sync or a late backup from what's stored (C6).
    log({
      job,
      ok: false,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/** One JSON line per cron run, for Workers Logs ([observability] in wrangler.toml). */
function log(entry: Record<string, unknown>) {
  (entry['ok'] ? console.log : console.error)(JSON.stringify({ cron: true, ...entry }));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
