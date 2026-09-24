import { Hono } from 'hono';
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
import { recurring } from './routes/recurring';
import { review } from './routes/review';
import { sync } from './routes/sync';
import { transactions } from './routes/transactions';
import { findUserIdByEmail } from './db';
import type { Env } from './env';
import { runSync } from './sync/run';
import { sourceFromEnv } from './sync/source';

/** Everything is under /api; the rest of the origin is the web app (Workers Static Assets). */
export const app = new Hono<AppEnv>().basePath('/api');

// Public: health and the auth handshake. There is no signup route (SPEC §9).
app.get('/health', (c) => c.json({ ok: true as const }));
app.route('/auth', auth);

// Everything else requires a valid access token (T16).
app.use('*', requireAuth);
app.use('*', idempotency);
app.route('/me', me);
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
app.route('/review', review);

app.notFound((c) =>
  c.json(errorBody('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`), 404),
);
app.onError(renderError);

/** Cron (ARCHITECTURE §6): 3× daily. Single-user, so it syncs the configured owner. */
export async function scheduled(_event: ScheduledController, env: Env): Promise<void> {
  const source = sourceFromEnv(env);
  if (!source || !env.SIMPLEFIN_OWNER_EMAIL) return;
  const userId = await findUserIdByEmail(env.DB, env.SIMPLEFIN_OWNER_EMAIL);
  if (userId) await runSync(env.DB, userId, source);
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
