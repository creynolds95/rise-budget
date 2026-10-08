import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { sha256Hex } from '../src/lib/crypto';
import { signAccess, signRegistration } from '../src/lib/tokens';
import { totpAt } from '../src/lib/totp';
import { SoftAuthenticator } from './helpers/authenticator';
import { call, newUser, passkeyLogin, refreshCookie, signedInUser } from './helpers/http';

describe('T14 passkeys + sessions', () => {
  it('register → login → refresh → logout', async () => {
    const u = await signedInUser();
    expect(u.access).toBeTruthy();
    expect(u.cookie).toMatch(/^rise_refresh=/);

    const me = await call('GET', '/me', { access: u.access });
    expect(me.status).toBe(200);
    expect(me.json.id).toBe(u.userId);

    const r1 = await call('POST', '/auth/refresh', { cookie: u.cookie });
    expect(r1.status).toBe(200);
    const cookie2 = refreshCookie(r1.headers);
    expect(cookie2).not.toBe(u.cookie);
    expect((await call('GET', '/me', { access: r1.json.access })).status).toBe(200);

    const out = await call('POST', '/auth/logout', { cookie: cookie2 });
    expect(out.status).toBe(204);
    expect((await call('POST', '/auth/refresh', { cookie: cookie2 })).status).toBe(401);
  });

  it('two tabs refreshing with the same token both stay signed in (60 s grace)', async () => {
    const u = await signedInUser();
    const [a, b] = await Promise.all([
      call('POST', '/auth/refresh', { cookie: u.cookie }),
      call('POST', '/auth/refresh', { cookie: u.cookie }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Both land on the same new refresh token, so neither tab strands the other.
    expect(refreshCookie(a.headers)).toBe(refreshCookie(b.headers));
    expect(refreshCookie(a.headers)).not.toBe(u.cookie);
    expect((await call('GET', '/me', { access: b.json.access })).status).toBe(200);
    expect((await call('POST', '/auth/refresh', { cookie: refreshCookie(a.headers) })).status).toBe(
      200,
    );
  });

  it('a lost refresh response can be retried with the old token within the grace window', async () => {
    const u = await signedInUser();
    const lost = await call('POST', '/auth/refresh', { cookie: u.cookie });
    expect(lost.status).toBe(200);
    // The response never reached the device; it still holds the old cookie.
    const retry = await call('POST', '/auth/refresh', { cookie: u.cookie });
    expect(retry.status).toBe(200);
    expect(refreshCookie(retry.headers)).toBe(refreshCookie(lost.headers));
    const next = await call('POST', '/auth/refresh', { cookie: refreshCookie(retry.headers) });
    expect(next.status).toBe(200);
    const { results } = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE user_id = ?1 AND action = 'auth.refresh_reuse_detected'",
    )
      .bind(u.userId)
      .all();
    expect(results).toHaveLength(0);
  });

  it('a token two rotations old is reuse even inside the grace window', async () => {
    const u = await signedInUser();
    const r1 = await call('POST', '/auth/refresh', { cookie: u.cookie });
    const r2 = await call('POST', '/auth/refresh', { cookie: refreshCookie(r1.headers) });
    expect(r2.status).toBe(200);
    expect((await call('POST', '/auth/refresh', { cookie: u.cookie })).status).toBe(401);
    expect(
      (await call('POST', '/auth/refresh', { cookie: refreshCookie(r2.headers) })).status,
    ).toBe(401);
  });

  it('a replayed refresh token revokes the whole session family', async () => {
    const u = await signedInUser();
    const r1 = await call('POST', '/auth/refresh', { cookie: u.cookie });
    const current = refreshCookie(r1.headers);
    // Past the grace window.
    await env.DB.prepare('UPDATE session SET rotated_at = ?2 WHERE user_id = ?1')
      .bind(u.userId, new Date(Date.now() - 120_000).toISOString())
      .run();

    // Attacker replays the superseded token.
    const replay = await call('POST', '/auth/refresh', { cookie: u.cookie });
    expect(replay.status).toBe(401);

    // The legitimate, current token is now dead too.
    expect((await call('POST', '/auth/refresh', { cookie: current })).status).toBe(401);
    const { results } = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE user_id = ?1 AND action = 'auth.refresh_reuse_detected'",
    )
      .bind(u.userId)
      .all();
    expect(results).toHaveLength(1);
  });

  it('registration needs a valid one-time link token or a signed-in user', async () => {
    const { userId } = await newUser();
    expect((await call('POST', '/auth/passkey/register/options', { body: {} })).status).toBe(401);
    // An access token is not a registration token.
    const wrongPurpose = await signAccess(env, userId, 'sid');
    expect(
      (
        await call('POST', '/auth/passkey/register/options', {
          body: { registrationToken: wrongPurpose },
        })
      ).status,
    ).toBe(401);
    const ok = await call('POST', '/auth/passkey/register/options', {
      body: { registrationToken: await signRegistration(env, userId) },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.options.authenticatorSelection.residentKey).toBe('required');
  });

  it('the one-time link cannot register a second device', async () => {
    const u = await signedInUser();
    const again = await call('POST', '/auth/passkey/register/options', {
      body: { registrationToken: await signRegistration(env, u.userId) },
    });
    expect(again.status).toBe(401);
  });

  it('H4: adding a device needs a moments-old step-up, not just the access token', async () => {
    const u = await signedInUser();
    const noStepUp = await call('POST', '/auth/passkey/register/options', {
      access: u.access,
      body: {},
    });
    expect(noStepUp.status).toBe(401);
    expect(noStepUp.json.error.code).toBe('STEP_UP_REQUIRED');

    // A fresh passkey re-verification mints one that works.
    const opts = await call('POST', '/auth/passkey/login/options');
    const verify = await call('POST', '/auth/passkey/stepup/verify', {
      access: u.access,
      body: {
        challengeToken: opts.json.challengeToken,
        response: await u.device.login(opts.json.options),
      },
    });
    expect(verify.status).toBe(200);
    const ok = await call('POST', '/auth/passkey/register/options', {
      access: u.access,
      headers: { 'x-step-up': verify.json.stepUp },
      body: {},
    });
    expect(ok.status).toBe(200);
  });

  it('a signed-in user can add a second device, excluding existing ones', async () => {
    const u = await signedInUser();
    const opts = await call('POST', '/auth/passkey/register/options', {
      access: u.access,
      headers: { 'x-step-up': u.stepUp },
      body: {},
    });
    expect(opts.json.options.excludeCredentials).toHaveLength(1);
    const second = new SoftAuthenticator(env.RP_ID, env.RP_ORIGIN);
    const reg = await call('POST', '/auth/passkey/register/verify', {
      body: {
        challengeToken: opts.json.challengeToken,
        response: await second.register(opts.json.options),
        deviceLabel: 'iPad',
      },
    });
    expect(reg.status).toBe(201);
    expect((await passkeyLogin(second)).status).toBe(200);
  });

  it('rejects a login whose user handle points at another user', async () => {
    const a = await signedInUser();
    const b = await newUser();
    const handle = btoa(b.userId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect((await passkeyLogin(a.device, handle)).status).toBe(401);
  });

  it('rejects a challenge from the wrong ceremony', async () => {
    const u = await signedInUser();
    const regOpts = await call('POST', '/auth/passkey/register/options', {
      access: u.access,
      headers: { 'x-step-up': u.stepUp },
      body: {},
    });
    const res = await call('POST', '/auth/passkey/login/verify', {
      body: {
        challengeToken: regOpts.json.challengeToken,
        response: await u.device.login(regOpts.json.options),
      },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a tampered assertion', async () => {
    const u = await signedInUser();
    const opts = await call('POST', '/auth/passkey/login/options');
    const response = await u.device.login(opts.json.options);
    response.response.signature = response.response.signature.slice(0, -4) + 'AAAA';
    const res = await call('POST', '/auth/passkey/login/verify', {
      body: { challengeToken: opts.json.challengeToken, response },
    });
    expect(res.status).toBe(401);
  });
});

describe('T15 TOTP, recovery codes, provisioning', () => {
  it('TOTP: setup → confirm → sign in; secret stored encrypted', async () => {
    const u = await signedInUser();
    const stepUp = { 'x-step-up': u.stepUp };
    const setup = await call('POST', '/auth/totp/setup', { access: u.access, headers: stepUp });
    expect(setup.json.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const secret = setup.json.secret as string;

    // Not usable until confirmed.
    const early = await call('POST', '/auth/totp/verify', {
      body: { email: u.email, code: await totpAt(secret, Date.now()) },
    });
    expect(early.status).toBe(401);

    expect(
      (
        await call('POST', '/auth/totp/confirm', {
          access: u.access,
          headers: stepUp,
          body: { code: await totpAt(secret, Date.now()) },
        })
      ).status,
    ).toBe(200);
    // The code that confirmed setup is spent; the next one signs in.
    const login = await call('POST', '/auth/totp/verify', {
      body: { email: u.email, code: await totpAt(secret, Date.now() + 30_000) },
    });
    expect(login.status).toBe(200);
    expect(login.json.access).toBeTruthy();

    const row = await env.DB.prepare('SELECT secret_enc FROM totp_secret WHERE user_id = ?1')
      .bind(u.userId)
      .first<{ secret_enc: string }>();
    expect(row?.secret_enc).not.toContain(secret);
  });

  it('TOTP: a code works once, even inside its 30-second window', async () => {
    const u = await signedInUser();
    const stepUp = { 'x-step-up': u.stepUp };
    const { json } = await call('POST', '/auth/totp/setup', { access: u.access, headers: stepUp });
    await call('POST', '/auth/totp/confirm', {
      access: u.access,
      headers: stepUp,
      body: { code: await totpAt(json.secret, Date.now() - 30_000) },
    });
    const code = await totpAt(json.secret, Date.now());
    const first = await call('POST', '/auth/totp/verify', { body: { email: u.email, code } });
    expect(first.status).toBe(200);
    const replay = await call('POST', '/auth/totp/verify', { body: { email: u.email, code } });
    expect(replay.status).toBe(401);
    // An earlier step is spent too once a later one has been used.
    const older = await call('POST', '/auth/totp/verify', {
      body: { email: u.email, code: await totpAt(json.secret, Date.now() - 30_000) },
    });
    expect(older.status).toBe(401);
  });

  it('TOTP: re-running setup keeps the confirmed authenticator until the new one confirms', async () => {
    const u = await signedInUser();
    const stepUp = { 'x-step-up': u.stepUp };
    const first = (await call('POST', '/auth/totp/setup', { access: u.access, headers: stepUp }))
      .json.secret as string;
    await call('POST', '/auth/totp/confirm', {
      access: u.access,
      headers: stepUp,
      body: { code: await totpAt(first, Date.now() - 30_000) },
    });
    const second = (await call('POST', '/auth/totp/setup', { access: u.access, headers: stepUp }))
      .json.secret as string;
    expect(second).not.toBe(first);
    // Still the old one until the new one is confirmed.
    expect(
      (
        await call('POST', '/auth/totp/verify', {
          body: { email: u.email, code: await totpAt(first, Date.now()) },
        })
      ).status,
    ).toBe(200);
    // Confirming checks the new secret, not the old one.
    expect(
      (
        await call('POST', '/auth/totp/confirm', {
          access: u.access,
          headers: stepUp,
          body: { code: await totpAt(first, Date.now() + 30_000) },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/auth/totp/confirm', {
          access: u.access,
          headers: stepUp,
          body: { code: await totpAt(second, Date.now()) },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', '/auth/totp/verify', {
          body: { email: u.email, code: await totpAt(first, Date.now() + 30_000) },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call('POST', '/auth/totp/verify', {
          body: { email: u.email, code: await totpAt(second, Date.now() + 30_000) },
        })
      ).status,
    ).toBe(200);
  });

  it('fallback lockout holds against attempts sent all at once', async () => {
    const u = await signedInUser();
    const tries = await Promise.all(
      Array.from({ length: 12 }, () =>
        call('POST', '/auth/recovery/verify', { body: { email: u.email, code: 'AAAAA-BBBBB' } }),
      ),
    );
    const statuses = tries.map((t) => t.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });

  it('a successful fallback sign-in does not count toward the lockout', async () => {
    const u = await signedInUser();
    const gen = await call('POST', '/auth/recovery/generate', {
      access: u.access,
      headers: { 'x-step-up': u.stepUp },
    });
    const codes = gen.json.codes as string[];
    for (const code of codes.slice(0, 6)) {
      expect(
        (await call('POST', '/auth/recovery/verify', { body: { email: u.email, code } })).status,
      ).toBe(200);
    }
  });

  it('TOTP: locks out after 5 failures in 15 minutes', async () => {
    const u = await signedInUser();
    const stepUp = { 'x-step-up': u.stepUp };
    const { json } = await call('POST', '/auth/totp/setup', { access: u.access, headers: stepUp });
    await call('POST', '/auth/totp/confirm', {
      access: u.access,
      headers: stepUp,
      body: { code: await totpAt(json.secret, Date.now()) },
    });
    for (let i = 0; i < 5; i++) {
      expect(
        (await call('POST', '/auth/totp/verify', { body: { email: u.email, code: '000000' } }))
          .status,
      ).toBe(401);
    }
    const locked = await call('POST', '/auth/totp/verify', {
      body: { email: u.email, code: await totpAt(json.secret, Date.now()) },
    });
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe('RATE_LIMITED');
  });

  it('recovery codes are single-use and stored hashed', async () => {
    const u = await signedInUser();
    const gen = await call('POST', '/auth/recovery/generate', {
      access: u.access,
      headers: { 'x-step-up': u.stepUp },
    });
    const codes = gen.json.codes as string[];
    expect(codes).toHaveLength(10);

    expect(
      (await call('POST', '/auth/recovery/verify', { body: { email: u.email, code: codes[0] } }))
        .status,
    ).toBe(200);
    expect(
      (await call('POST', '/auth/recovery/verify', { body: { email: u.email, code: codes[0] } }))
        .status,
    ).toBe(401);
    // Formatting-insensitive.
    const loose = (codes[1] as string).replace('-', '').toLowerCase();
    expect(
      (await call('POST', '/auth/recovery/verify', { body: { email: u.email, code: loose } }))
        .status,
    ).toBe(200);

    const { results } = await env.DB.prepare(
      'SELECT code_hash FROM recovery_code WHERE user_id = ?1',
    )
      .bind(u.userId)
      .all<{ code_hash: string }>();
    const stored = results.map((r) => r.code_hash).join(' ');
    for (const c of codes) expect(stored).not.toContain(c.replace('-', ''));
    // Keyed, not a bare SHA-256 that a leaked backup could be brute-forced against.
    for (const c of codes) expect(stored).not.toContain(await sha256Hex(c.replace('-', '')));
  });

  it('a recovery code stored by the old unkeyed hash still works, once', async () => {
    const u = await signedInUser();
    await env.DB.prepare('INSERT INTO recovery_code (id, user_id, code_hash) VALUES (?1, ?2, ?3)')
      .bind(crypto.randomUUID(), u.userId, await sha256Hex('LEGACY1234'))
      .run();
    const use = () =>
      call('POST', '/auth/recovery/verify', { body: { email: u.email, code: 'legac-y1234' } });
    expect((await use()).status).toBe(200);
    expect((await use()).status).toBe(401);
  });

  it('unknown emails are rejected without revealing whether the user exists', async () => {
    const res = await call('POST', '/auth/totp/verify', {
      body: { email: 'nobody@example.com', code: '123456' },
    });
    expect(res.status).toBe(401);
    expect(res.json.error.message).toBe('Code not accepted');
  });

  it('there is no signup route', () => {
    const paths = app.routes.map((r) => r.path);
    expect(
      paths.some(
        (p) => /signup|sign-up|register$|users?$/i.test(p) && !p.startsWith('/auth/passkey'),
      ),
    ).toBe(false);
  });
});

describe('T16 auth middleware + error contract', () => {
  const guarded = [
    ...new Map(
      app.routes
        .filter((r) => r.method !== 'ALL' && !r.path.startsWith('/auth') && r.path !== '/health')
        .map((r) => [`${r.method} ${r.path}`, r]),
    ).values(),
  ];

  it('has guarded routes to check', () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  it.each(guarded.map((r) => [r.method, r.path]))(
    '%s %s 401s without a token',
    async (method, path) => {
      const res = await call(method, path.replace(/:[a-z]+/gi, 'x'));
      expect(res.status).toBe(401);
      expect(res.json).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } });
    },
  );

  it('rejects a garbage or expired-shape token', async () => {
    expect((await call('GET', '/me', { access: 'not-a-jwt' })).status).toBe(401);
  });

  it('bad bodies return BAD_REQUEST with issues', async () => {
    const u = await signedInUser();
    const res = await call('PATCH', '/me/settings', {
      access: u.access,
      body: { appLock: 'forever' },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('BAD_REQUEST');
  });

  it('settings patch keeps unspecified values', async () => {
    const u = await signedInUser();
    const res = await call('PATCH', '/me/settings', { access: u.access, body: { appLock: '5m' } });
    expect(res.json).toEqual({
      appLock: '5m',
      planChangesApplyToFuture: false,
      cushionCents: 50_000,
      cashAccountIds: [],
      dismissedPayMerchants: [],
      dismissedMisses: [],
      dashboard: null,
      retirement: null,
      debt: null,
      savings: null,
      follow: { rules: [], log: [] },
      alerts: {
        priceUp: true,
        doubleCharge: true,
        duplicate: true,
        unusual: true,
        firstTime: true,
      },
      binder: { passwordsLiveIn: '', entries: [] },
    });
  });

  it('saves a retirement plan and keeps it through an unrelated patch', async () => {
    const u = await signedInUser();
    const plan = {
      currentAge: 31,
      goalAge: 65,
      spendTargetCents: 500_000,
      contributions: [{ accountId: 'acct_1', monthlyCents: 120_000 }],
      realGrowthBps: 400,
      withdrawalBps: 350,
      volatilityBps: 1500,
    };
    await call('PATCH', '/me/settings', { access: u.access, body: { retirement: plan } });
    const res = await call('PATCH', '/me/settings', { access: u.access, body: { appLock: '5m' } });
    // A plan saved before Social Security existed reads back with it off.
    expect(res.json.retirement).toEqual({
      ...plan,
      ssBenefitCents: 0,
      ssClaimAge: 67,
      spouse: null,
      ssHaircutPct: 100,
      lifeEvents: [],
    });
  });
});

describe('C17 device management', () => {
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

  it('lists passkeys and signed-in devices, marking this one', async () => {
    const u = await signedInUser();
    const r = await call('GET', '/devices', { access: u.access });
    expect(r.status).toBe(200);
    expect(r.json.passkeys).toHaveLength(1);
    expect(r.json.sessions).toEqual([expect.objectContaining({ current: true })]);
  });

  it('names a device from its browser', async () => {
    const u = await signedInUser();
    const opts = await call('POST', '/auth/passkey/login/options');
    await call('POST', '/auth/passkey/login/verify', {
      headers: { 'user-agent': iphone },
      body: {
        challengeToken: opts.json.challengeToken,
        response: await u.device.login(opts.json.options),
      },
    });
    const r = await call('GET', '/devices', { access: u.access });
    expect(r.json.sessions.map((s: { label: string | null }) => s.label)).toContain(
      'iPhone · Safari',
    );
  });

  it('signing a device out ends its refresh and its access token at once', async () => {
    const u = await signedInUser();
    const otherAccess = (await passkeyLogin(u.device)).json.access as string;
    const sessions = (await call('GET', '/devices', { access: otherAccess })).json.sessions as {
      id: string;
      current: boolean;
    }[];
    const s = sessions.find((x) => !x.current);
    expect(
      (await call('DELETE', `/devices/sessions/${String(s?.id)}`, { access: otherAccess })).status,
    ).toBe(204);
    expect((await call('POST', '/auth/refresh', { cookie: u.cookie })).status).toBe(401);
    // Not "within 15 minutes": the signed-out session's access token stops working now.
    expect((await call('GET', '/me', { access: u.access })).status).toBe(401);
    expect((await call('GET', '/me', { access: otherAccess })).status).toBe(200);
    expect((await call('GET', '/devices', { access: otherAccess })).json.sessions).toHaveLength(1);
  });

  it('an access token for a session that does not exist is refused', async () => {
    const u = await signedInUser();
    const forged = await signAccess(env, u.userId, crypto.randomUUID());
    expect((await call('GET', '/me', { access: forged })).status).toBe(401);
  });

  it('removing a passkey needs a step-up and never removes the last one', async () => {
    const u = await signedInUser();
    const [only] = (await call('GET', '/devices', { access: u.access })).json.passkeys;
    const path = `/devices/passkeys/${only.id}`;
    expect((await call('DELETE', path, { access: u.access })).status).toBe(401);
    const last = await call('DELETE', path, {
      access: u.access,
      headers: { 'x-step-up': u.stepUp },
    });
    expect(last.status).toBe(409);
    const missing = await call('DELETE', '/devices/passkeys/nope', {
      access: u.access,
      headers: { 'x-step-up': u.stepUp },
    });
    expect(missing.status).toBe(404);

    // With a second passkey, the first can go — and then can't sign in.
    const opts = await call('POST', '/auth/passkey/register/options', {
      access: u.access,
      headers: { 'x-step-up': u.stepUp },
      body: {},
    });
    const second = new SoftAuthenticator(env.RP_ID, env.RP_ORIGIN);
    await call('POST', '/auth/passkey/register/verify', {
      body: {
        challengeToken: opts.json.challengeToken,
        response: await second.register(opts.json.options),
      },
    });
    const ok = await call('DELETE', path, { access: u.access, headers: { 'x-step-up': u.stepUp } });
    expect(ok.status).toBe(204);
    expect((await passkeyLogin(u.device)).status).toBe(401);
    expect((await passkeyLogin(second)).status).toBe(200);
  });
});

describe('C17 security headers', () => {
  it('API responses forbid rendering, framing and sniffing', async () => {
    const r = await call('GET', '/health');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});
