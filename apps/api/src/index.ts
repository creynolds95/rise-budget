import { Hono } from 'hono';
import type { AppEnv } from './env';
import { errorBody, renderError } from './lib/errors';
import { requireAuth } from './lib/session';
import { auth } from './routes/auth';
import { accounts } from './routes/accounts';
import { categories, categoryGroups } from './routes/categories';
import { me } from './routes/me';
import { networth } from './routes/networth';
import { allocations, periods } from './routes/periods';

export const app = new Hono<AppEnv>();

// Public: health and the auth handshake. There is no signup route (SPEC §9).
app.get('/health', (c) => c.json({ ok: true as const }));
app.route('/auth', auth);

// Everything else requires a valid access token (T16).
app.use('*', requireAuth);
app.route('/me', me);
app.route('/accounts', accounts);
app.route('/networth', networth);
app.route('/category-groups', categoryGroups);
app.route('/categories', categories);
app.route('/periods', periods);
app.route('/allocations', allocations);

app.notFound((c) =>
  c.json(errorBody('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`), 404),
);
app.onError(renderError);

export default app;
