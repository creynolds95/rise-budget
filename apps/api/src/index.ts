import { Hono } from 'hono';
import type { Env } from './env';
import { errorBody, renderError } from './lib/errors';

export const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true as const }));

app.notFound((c) =>
  c.json(errorBody('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`), 404),
);
app.onError(renderError);

export default app;
