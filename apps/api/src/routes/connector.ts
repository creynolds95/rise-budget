import { Hono } from 'hono';
import { deleteMcpToken, getMcpToken, saveMcpToken } from '../db';
import type { AppEnv } from '../env';
import { b64urlEncode, randomBytes, sha256Hex } from '../lib/crypto';
import { requireStepUp } from '../lib/session';

/** Turn the optional Claude connector on or off (SPEC §12.3). Off by default. */
export const connector = new Hono<AppEnv>();

connector.get('/', async (c) => {
  const t = await getMcpToken(c.get('userId'), c.env.DB);
  return c.json({ on: t !== null, createdAt: t?.createdAt ?? null });
});

/** A fresh link, shown once; any earlier link stops working. Needs a fresh passkey check. */
connector.post('/', requireStepUp, async (c) => {
  const userId = c.get('userId');
  const token = b64urlEncode(randomBytes(32));
  await saveMcpToken(userId, c.env.DB, await sha256Hex(token));
  return c.json({ url: `${c.env.RP_ORIGIN}/api/mcp/${userId}/${token}` }, 201);
});

connector.delete('/', async (c) => {
  await deleteMcpToken(c.get('userId'), c.env.DB);
  return c.body(null, 204);
});
