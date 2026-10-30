import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { SoftAuthenticator } from './helpers/authenticator';
import { call, passkeyLogin, signedInUser } from './helpers/http';

async function mint(u: Awaited<ReturnType<typeof signedInUser>>) {
  const r = await call('POST', '/auth/invite', {
    access: u.access,
    headers: { 'x-step-up': u.stepUp },
  });
  expect(r.status).toBe(201);
  return r.json as { token: string; expiresAt: string };
}

async function register(
  inviteToken: string,
  device = new SoftAuthenticator(env.RP_ID, env.RP_ORIGIN),
) {
  const opts = await call('POST', '/auth/passkey/register/options', { body: { inviteToken } });
  if (opts.status !== 200) return { opts, verify: null, device };
  const verify = await call('POST', '/auth/passkey/register/verify', {
    body: {
      challengeToken: opts.json.challengeToken,
      response: await device.register(opts.json.options),
      deviceLabel: 'Sam',
    },
  });
  return { opts, verify, device };
}

describe('share links', () => {
  it('needs a name, which labels the new profile; profiles can be renamed', async () => {
    const owner = await signedInUser();
    const { token } = await mint(owner);
    const dev = new SoftAuthenticator(env.RP_ID, env.RP_ORIGIN);
    const opts = await call('POST', '/auth/passkey/register/options', {
      body: { inviteToken: token },
    });
    const noName = await call('POST', '/auth/passkey/register/verify', {
      body: {
        challengeToken: opts.json.challengeToken,
        response: await dev.register(opts.json.options),
      },
    });
    expect(noName.status).toBe(400);
    expect((await register(token)).verify?.status).toBe(201);
    const list = await call('GET', '/devices', { access: owner.access });
    const sam = list.json.passkeys.find((k: { label: string }) => k.label === 'Sam');
    expect(sam).toBeTruthy();
    const patch = await call('PATCH', `/devices/passkeys/${sam.id}`, {
      access: owner.access,
      body: { label: 'Sam R' },
    });
    expect(patch.status).toBe(204);
    const after = await call('GET', '/devices', { access: owner.access });
    expect(after.json.passkeys.map((k: { label: string }) => k.label)).toContain('Sam R');
  });

  it('a link registers one passkey that signs in to the same account, then is spent', async () => {
    const owner = await signedInUser();
    const { token, expiresAt } = await mint(owner);
    const hours = (Date.parse(expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);

    const first = await register(token);
    expect(first.verify?.status).toBe(201);
    const login = await passkeyLogin(first.device);
    expect(login.status).toBe(200);
    const me = await call('GET', '/me', { access: login.json.access });
    expect(me.json.id).toBe(owner.userId);

    const second = await register(token);
    expect(second.opts.status).toBe(401);
    expect((await call('GET', '/auth/invite', { access: owner.access })).json.invites).toEqual([]);
  });

  it('only a hash is stored, never the secret', async () => {
    const owner = await signedInUser();
    const { token } = await mint(owner);
    const secret = token.split('.')[2] as string;
    const row = await env.DB.prepare('SELECT secret_hash FROM invite WHERE user_id = ?1')
      .bind(owner.userId)
      .first<{ secret_hash: string }>();
    expect(row?.secret_hash).toBeTruthy();
    expect(row?.secret_hash).not.toContain(secret);
  });

  it('an expired link is refused', async () => {
    const owner = await signedInUser();
    const { token } = await mint(owner);
    await env.DB.prepare('UPDATE invite SET expires_at = ?2 WHERE user_id = ?1')
      .bind(owner.userId, new Date(Date.now() - 1000).toISOString())
      .run();
    expect((await register(token)).opts.status).toBe(401);
  });

  it('a revoked link is refused, and revoking is audited', async () => {
    const owner = await signedInUser();
    const { token } = await mint(owner);
    const list = await call('GET', '/auth/invite', { access: owner.access });
    expect(list.json.invites).toHaveLength(1);
    const del = await call('DELETE', `/auth/invite/${list.json.invites[0].id}`, {
      access: owner.access,
    });
    expect(del.status).toBe(204);
    expect((await register(token)).opts.status).toBe(401);
    const { results } = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE user_id = ?1 AND action LIKE 'auth.invite_%' ORDER BY created_at",
    )
      .bind(owner.userId)
      .all<{ action: string }>();
    expect(results.map((r) => r.action)).toEqual(['auth.invite_created', 'auth.invite_revoked']);
  });

  it('a tampered secret is refused', async () => {
    const owner = await signedInUser();
    const { token } = await mint(owner);
    const bad = `${token.slice(0, -2)}xx`;
    expect((await register(bad)).opts.status).toBe(401);
    expect((await register('nonsense')).opts.status).toBe(401);
  });

  it('a challenge from a link cannot be used twice', async () => {
    const owner = await signedInUser();
    const { token } = await mint(owner);
    const a = new SoftAuthenticator(env.RP_ID, env.RP_ORIGIN);
    const b = new SoftAuthenticator(env.RP_ID, env.RP_ORIGIN);
    const [oa, ob] = await Promise.all(
      [a, b].map(() =>
        call('POST', '/auth/passkey/register/options', { body: { inviteToken: token } }),
      ),
    );
    const va = await call('POST', '/auth/passkey/register/verify', {
      body: {
        challengeToken: oa?.json.challengeToken,
        response: await a.register(oa?.json.options),
        deviceLabel: 'A',
      },
    });
    const vb = await call('POST', '/auth/passkey/register/verify', {
      body: {
        challengeToken: ob?.json.challengeToken,
        response: await b.register(ob?.json.options),
        deviceLabel: 'B',
      },
    });
    expect([va.status, vb.status].sort()).toEqual([201, 401]);
  });

  it('minting needs a fresh passkey check and a session', async () => {
    const owner = await signedInUser();
    expect((await call('POST', '/auth/invite', { access: owner.access })).status).toBe(401);
    expect((await call('POST', '/auth/invite')).status).toBe(401);
    expect((await call('GET', '/auth/invite')).status).toBe(401);
  });

  it("one account's links are not another's to list or revoke", async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    await mint(a);
    const id = (await call('GET', '/auth/invite', { access: a.access })).json.invites[0].id;
    expect((await call('GET', '/auth/invite', { access: b.access })).json.invites).toEqual([]);
    expect((await call('DELETE', `/auth/invite/${id}`, { access: b.access })).status).toBe(404);
  });

  it('a member can see profiles but cannot manage them; removing one signs it out', async () => {
    const owner = await signedInUser();
    const { token } = await mint(owner);
    const { verify, device } = await register(token);
    expect(verify?.status).toBe(201);
    const m = await passkeyLogin(device);
    const mAccess = m.json.access as string;
    const mStep = m.json.stepUp as string;

    const list = await call('GET', '/devices', { access: mAccess });
    expect(list.json.viewerRole).toBe('member');
    expect(list.json.passkeys).toHaveLength(2);
    const ownerKey = list.json.passkeys.find((k: { role: string }) => k.role === 'owner');
    const memberKey = list.json.passkeys.find((k: { role: string }) => k.role === 'member');

    const stepUp = { 'x-step-up': mStep };
    expect((await call('POST', '/auth/invite', { access: mAccess, headers: stepUp })).status).toBe(
      403,
    );
    expect((await call('GET', '/auth/invite', { access: mAccess })).status).toBe(403);
    expect(
      (
        await call('PATCH', `/devices/passkeys/${ownerKey.id}`, {
          access: mAccess,
          body: { label: 'x' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('DELETE', `/devices/passkeys/${ownerKey.id}`, {
          access: mAccess,
          headers: stepUp,
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('POST', '/auth/recovery/generate', { access: mAccess, headers: stepUp })).status,
    ).toBe(403);
    expect(
      (await call('POST', '/auth/totp/setup', { access: mAccess, headers: stepUp })).status,
    ).toBe(403);

    // The owner removes the member: that profile's session ends at once.
    const del = await call('DELETE', `/devices/passkeys/${memberKey.id}`, {
      access: owner.access,
      headers: { 'x-step-up': owner.stepUp },
    });
    expect(del.status).toBe(204);
    expect((await call('GET', '/me', { access: mAccess })).status).toBe(401);
  });

  it('the last owner passkey cannot be removed', async () => {
    const owner = await signedInUser();
    const list = await call('GET', '/devices', { access: owner.access });
    expect(list.json.viewerRole).toBe('owner');
    const del = await call('DELETE', `/devices/passkeys/${list.json.passkeys[0].id}`, {
      access: owner.access,
      headers: { 'x-step-up': owner.stepUp },
    });
    expect(del.status).toBe(409);
  });
});
