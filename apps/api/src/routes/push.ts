import { PushSubscriptionBody, PushUnsubscribeBody } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { deletePushSubscription, listPushSubscriptions, savePushSubscription } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { deliver, markCurrentAsSent, vapidKeys } from '../lib/push';
import { body } from '../lib/validate';

/** Push notifications (SPEC §8.2): sign a device up, take it off, send a test. */
export const push = new Hono<AppEnv>();

/** The key a browser needs to subscribe (`applicationServerKey`). */
push.get('/key', async (c) =>
  c.json({ publicKey: (await vapidKeys(c.get('userId'), c.env.DB)).publicKey }),
);

push.post('/subscriptions', async (c) => {
  const userId = c.get('userId');
  const b = await body(c, PushSubscriptionBody);
  // The first device starts from now: nothing already waiting gets pushed at it.
  if ((await listPushSubscriptions(userId, c.env.DB)).length === 0)
    await markCurrentAsSent(userId, c.env.DB, new Date());
  await savePushSubscription(userId, c.env.DB, { endpoint: b.endpoint, ...b.keys });
  return c.body(null, 204);
});

push.delete('/subscriptions', async (c) => {
  const b = await body(c, PushUnsubscribeBody);
  await deletePushSubscription(c.get('userId'), c.env.DB, b.endpoint);
  return c.body(null, 204);
});

push.post('/test', async (c) => {
  const sent = await deliver(
    c.get('userId'),
    c.env.DB,
    { title: 'Rise', body: 'Alerts are on for this device.', url: '/settings' },
    new Date(),
  );
  if (sent === 0) throw new AppError(409, 'CONFLICT', 'No device took the test alert');
  return c.json({ sent });
});
