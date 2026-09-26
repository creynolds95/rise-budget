import { DevicesResponse } from '@rise/shared/schemas';
import { Hono } from 'hono';
import { deletePasskey, listActiveSessions, listPasskeys, revokeSession, writeAudit } from '../db';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { requireStepUp } from '../lib/session';

/** C17: see and remove the passkeys and signed-in devices on the account. */
export const devices = new Hono<AppEnv>();

devices.get('/', async (c) => {
  const userId = c.get('userId');
  const [keys, sessions] = await Promise.all([
    listPasskeys(userId, c.env.DB),
    listActiveSessions(userId, c.env.DB),
  ]);
  return c.json(
    DevicesResponse.parse({
      passkeys: keys.map((k) => ({
        id: k.id,
        label: k.device_label,
        createdAt: k.created_at,
        lastUsedAt: k.last_used_at,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        label: s.device_label,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        current: s.id === c.get('sessionId'),
      })),
    }),
  );
});

/** Removing a way to sign in needs the same fresh re-verification as adding one (H4). */
devices.delete('/passkeys/:id', requireStepUp, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const r = await deletePasskey(userId, c.env.DB, id);
  if (r === 'missing') throw new AppError(404, 'NOT_FOUND', 'No such passkey');
  if (r === 'last')
    throw new AppError(
      409,
      'CONFLICT',
      'This is your only passkey. Add another before removing it.',
    );
  await writeAudit(userId, c.env.DB, 'auth.passkey_removed', { type: 'credential', id });
  return c.body(null, 204);
});

/** Signs a device out: its refresh token stops working, so it's out within 15 minutes. */
devices.delete('/sessions/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await revokeSession(userId, c.env.DB, id);
  await writeAudit(userId, c.env.DB, 'auth.session_revoked', { type: 'session', id });
  return c.body(null, 204);
});
