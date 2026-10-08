import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { errorBody, renderError } from './lib/errors';
import { idempotency } from './lib/idempotency';
import { requireAuth } from './lib/session';
import { flushUsage, meter, meterDb, type Tally } from './lib/usage';
import { usage } from './routes/usage';
import { auth } from './routes/auth';
import { accounts } from './routes/accounts';
import { categories, categoryGroups } from './routes/categories';
import { merchants, rules } from './routes/rules';
import { me } from './routes/me';
import { investments } from './routes/investments';
import { monarchImport } from './routes/monarchImport';
import { networth } from './routes/networth';
import { allocations, periods } from './routes/periods';
import { cashToPayday } from './routes/cashToPayday';
import { recurring } from './routes/recurring';
import { reports } from './routes/reports';
import { tags } from './routes/tags';
import { push } from './routes/push';
import { review } from './routes/review';
import { sync } from './routes/sync';
import { transactions } from './routes/transactions';
import { dataExport } from './routes/export';
import { devices } from './routes/devices';
import { findUserIdByEmail } from './db';
import type { Env } from './env';
import { HOUSEKEEPING_CRON, runHousekeeping } from './backup/run';
import { applyFollows } from './lib/follow';
import { applyLoanPayments } from './lib/loanPayments';
import { runPush } from './lib/push';
import { cronOverlapDays, runSync } from './sync/run';
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

// Every request counts the D1 rows it reads and writes, for the Settings usage meter.
app.use('*', meter);

// Public: health and the auth handshake. There is no signup route (SPEC §9).
app.get('/health', (c) => c.json({ ok: true as const }));
app.route('/auth', auth);

// Everything else requires a valid access token (T16).
app.use('*', requireAuth);
app.use('*', idempotency);
app.route('/me', me);
app.route('/devices', devices);
app.route('/usage', usage);
app.route('/accounts', accounts);
app.route('/networth', networth);
app.route('/investments', investments);
app.route('/category-groups', categoryGroups);
app.route('/categories', categories);
app.route('/rules', rules);
app.route('/merchants', merchants);
app.route('/periods', periods);
app.route('/allocations', allocations);
app.route('/transactions', transactions);
app.route('/tags', tags);
app.route('/push', push);
app.route('/sync', sync);
app.route('/recurring', recurring);
app.route('/cash-to-payday', cashToPayday);
app.route('/review', review);
app.route('/reports', reports);
app.route('/export', dataExport);
app.route('/import/monarch', monarchImport);

app.notFound((c) =>
  c.json(errorBody('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`), 404),
);
app.onError(renderError);

/**
 * Crons: SimpleFIN sync 3× daily (ARCHITECTURE §6), and nightly housekeeping (§8) at 09:30 UTC
 * (early morning Central), well after the evening sync and before the GitHub backup job. Single-user, so sync runs for the configured owner.
 */
export async function scheduled(event: ScheduledController, env: Env): Promise<void> {
  const job = event.cron === HOUSEKEEPING_CRON ? 'housekeeping' : 'sync';
  const started = Date.now();
  const tally: Tally = { read: 0, written: 0 };
  const db = meterDb(env.DB, tally);
  try {
    if (job === 'housekeeping') {
      const r = await runHousekeeping(db, env.BACKUPS, new Date(event.scheduledTime));
      log({
        job,
        ok: true,
        ms: Date.now() - started,
        backupsPruned: r.pruned.length,
        rowsPruned: r.rowsPruned,
      });
      return;
    }
    const source = sourceFromEnv(env);
    if (!source || !env.SIMPLEFIN_OWNER_EMAIL) return;
    const userId = await findUserIdByEmail(db, env.SIMPLEFIN_OWNER_EMAIL);
    if (!userId) return;
    // An idle cron run (nothing new from the bank) skips the CPU-heavy recurring re-detection.
    // Once a week it re-reads five weeks back, for rows a bank backfills late.
    const r = await runSync(db, userId, source, {
      skipRecurringWhenIdle: true,
      overlapDays: cronOverlapDays(new Date(event.scheduledTime)),
    });
    if (r.status !== 'failed') {
      // A loan-payment hiccup must not fail the sync; the Debt page still offers Apply by hand.
      await applyLoanPayments(db, userId, new Date(event.scheduledTime)).catch((e: unknown) =>
        log({
          job,
          ok: false,
          step: 'loan-payments',
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      await applyFollows(db, userId, new Date(event.scheduledTime)).catch((e: unknown) =>
        log({
          job,
          ok: false,
          step: 'follow',
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
    // After every sync, failed ones too: a bank needing a look is itself an alert.
    await runPush(userId, db, new Date(event.scheduledTime)).catch((e: unknown) =>
      log({ job, ok: false, step: 'push', error: e instanceof Error ? e.message : String(e) }),
    );
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
  } finally {
    await flushUsage(env.DB, tally, 0, `cron ${job}`);
  }
}

/** One JSON line per cron run, for Workers Logs ([observability] in wrangler.toml). */
function log(entry: Record<string, unknown>) {
  (entry['ok'] ? console.log : console.error)(JSON.stringify({ cron: true, ...entry }));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
