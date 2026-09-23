import { Hono } from 'hono';
import type { AppEnv } from './env';
import { errorBody, renderError } from './lib/errors';
import { requireAuth } from './lib/session';
import { auth } from './routes/auth';
import { me } from './routes/me';

export const app = new Hono<AppEnv>();

// Public: health and the auth handshake. There is no signup route (SPEC §9).
app.get('/health', (c) => c.json({ ok: true as const }));
app.route('/auth', auth);

// Everything else requires a valid access token (T16).
app.use('*', requireAuth);
app.route('/me', me);

app.notFound((c) =>
  c.json(errorBody('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`), 404),
);
app.onError(renderError);

export default app;
