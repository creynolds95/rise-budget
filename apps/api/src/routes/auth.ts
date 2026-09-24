import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  FallbackLoginBody,
  LoginVerifyBody,
  RegisterOptionsBody,
  RegisterVerifyBody,
  TotpConfirmBody,
} from '@rise/shared/schemas';
import { Hono, type Context } from 'hono';
import {
  confirmTotp,
  consumeRecoveryCode,
  countAuditSince,
  findUserIdByEmail,
  getCredential,
  getSession,
  getTotp,
  getUser,
  insertCredential,
  listCredentials,
  putPendingTotp,
  replaceRecoveryCodes,
  revokeSession,
  rotateSession,
  touchCredential,
  writeAudit,
} from '../db';
import type { AppEnv } from '../env';
import {
  b64urlDecode,
  b64urlEncode,
  decryptString,
  encryptString,
  randomBytes,
  safeEqual,
} from '../lib/crypto';
import { AppError } from '../lib/errors';
import {
  clearRefreshCookie,
  issueSession,
  optionalAuth,
  readRefreshCookie,
  refreshExpiry,
  requireAuth,
  requireStepUp,
  setRefreshCookie,
} from '../lib/session';
import {
  formatRefresh,
  hashSecret,
  newRefreshSecret,
  parseRefresh,
  signAccess,
  signChallenge,
  signStepUp,
  verifyChallenge,
  verifyRegistration,
} from '../lib/tokens';
import { newTotpSecret, otpauthUri, verifyTotp } from '../lib/totp';
import { body } from '../lib/validate';

export const auth = new Hono<AppEnv>();

const unauthorized = (msg = 'Sign in required') => new AppError(401, 'UNAUTHORIZED', msg);

/** Fallback-login lockout: 5 failures in 15 minutes. */
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// ── passkey registration ──────────────────────────────────────────────────────

async function registeringUser(c: Context<AppEnv>, token?: string) {
  const signedIn = c.get('userId');
  if (signedIn) return signedIn;
  const reg = token ? await verifyRegistration(c.env, token) : null;
  if (!reg) throw unauthorized();
  return reg.userId;
}

auth.post('/passkey/register/options', optionalAuth, requireStepUp, async (c) => {
  const { registrationToken } = await body(c, RegisterOptionsBody);
  const userId = await registeringUser(c, registrationToken);
  const user = await getUser(userId, c.env.DB);
  if (!user) throw unauthorized();
  const existing = await listCredentials(userId, c.env.DB);
  // The link from `seed:user` registers the FIRST device only; later devices need a session.
  if (!c.get('userId') && existing.length > 0)
    throw unauthorized('Link already used — sign in to add a device');
  const options = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID: c.env.RP_ID,
    userName: user.email,
    userDisplayName: user.displayName,
    userID: new Uint8Array(new TextEncoder().encode(userId)),
    challenge: randomBytes(32),
    attestationType: 'none',
    excludeCredentials: existing.map((cr) => ({ id: cr.id })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return c.json({
    options,
    challengeToken: await signChallenge(c.env, options.challenge, 'register', userId),
  });
});

auth.post('/passkey/register/verify', async (c) => {
  const b = await body(c, RegisterVerifyBody);
  const ch = await verifyChallenge(c.env, b.challengeToken, 'register');
  if (!ch || !ch.userId) throw unauthorized('Registration expired — start again');
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: b.response as unknown as RegistrationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin: c.env.RP_ORIGIN,
      expectedRPID: c.env.RP_ID,
      requireUserVerification: true,
    });
  } catch {
    throw unauthorized('Passkey could not be verified');
  }
  if (!verification.verified) throw unauthorized('Passkey could not be verified');
  const cred = verification.registrationInfo.credential;
  await insertCredential(ch.userId, c.env.DB, {
    id: cred.id,
    publicKey: cred.publicKey,
    counter: cred.counter,
    transports: cred.transports ?? [],
    deviceLabel: b.deviceLabel ?? null,
  });
  await writeAudit(ch.userId, c.env.DB, 'auth.passkey_added', { type: 'credential', id: cred.id });
  return c.json({ credentialId: cred.id }, 201);
});

// ── passkey login ─────────────────────────────────────────────────────────────

auth.post('/passkey/login/options', async (c) => {
  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    challenge: randomBytes(32),
    userVerification: 'required',
  });
  return c.json({
    options,
    challengeToken: await signChallenge(c.env, options.challenge, 'login'),
  });
});

auth.post('/passkey/login/verify', async (c) => {
  const b = await body(c, LoginVerifyBody);
  const ch = await verifyChallenge(c.env, b.challengeToken, 'login');
  if (!ch) throw unauthorized('Sign-in expired — try again');
  const response = b.response as unknown as AuthenticationResponseJSON;
  // Discoverable credentials return the user handle we set at registration.
  const handle = response.response?.userHandle;
  if (!handle) throw unauthorized('Passkey could not be verified');
  const userId = new TextDecoder().decode(b64urlDecode(handle));
  const cred = await getCredential(userId, c.env.DB, response.id);
  if (!cred) throw unauthorized('Passkey could not be verified');
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: c.env.RP_ORIGIN,
      expectedRPID: c.env.RP_ID,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(cred.public_key),
        counter: cred.counter,
        transports: cred.transports ? JSON.parse(cred.transports) : [],
      },
      requireUserVerification: true,
    });
  } catch {
    throw unauthorized('Passkey could not be verified');
  }
  if (!result.verified) throw unauthorized('Passkey could not be verified');
  await touchCredential(userId, c.env.DB, cred.id, result.authenticationInfo.newCounter);
  await writeAudit(userId, c.env.DB, 'auth.login', { detail: { method: 'passkey' } });
  return issueSession(c, userId);
});

/**
 * H4: re-verify a passkey without starting a whole new session — for stepping up an already
 * signed-in session before a sensitive change (enabling TOTP, generating recovery codes,
 * adding another passkey). Reuses `/passkey/login/options` for the challenge.
 */
auth.post('/passkey/stepup/verify', requireAuth, async (c) => {
  const userId = c.get('userId');
  const b = await body(c, LoginVerifyBody);
  const ch = await verifyChallenge(c.env, b.challengeToken, 'login');
  if (!ch) throw unauthorized('Verification expired — try again');
  const response = b.response as unknown as AuthenticationResponseJSON;
  const cred = await getCredential(userId, c.env.DB, response.id);
  if (!cred) throw unauthorized('Passkey could not be verified');
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: c.env.RP_ORIGIN,
      expectedRPID: c.env.RP_ID,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(cred.public_key),
        counter: cred.counter,
        transports: cred.transports ? JSON.parse(cred.transports) : [],
      },
      requireUserVerification: true,
    });
  } catch {
    throw unauthorized('Passkey could not be verified');
  }
  if (!result.verified) throw unauthorized('Passkey could not be verified');
  await touchCredential(userId, c.env.DB, cred.id, result.authenticationInfo.newCounter);
  return c.json({ stepUp: await signStepUp(c.env, userId) });
});

// ── TOTP + recovery fallback ──────────────────────────────────────────────────

async function fallbackUser(c: Context<AppEnv>, email: string) {
  const userId = await findUserIdByEmail(c.env.DB, email);
  if (!userId) throw unauthorized('Code not accepted');
  const since = new Date(Date.now() - LOCKOUT_MS).toISOString();
  if ((await countAuditSince(userId, c.env.DB, 'auth.login_failed', since)) >= MAX_FAILURES) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many attempts — wait 15 minutes');
  }
  return userId;
}

async function failFallback(userId: string, db: D1Database, method: string): Promise<never> {
  await writeAudit(userId, db, 'auth.login_failed', { detail: { method } });
  throw unauthorized('Code not accepted');
}

auth.post('/totp/verify', async (c) => {
  const b = await body(c, FallbackLoginBody);
  const userId = await fallbackUser(c, b.email);
  const row = await getTotp(userId, c.env.DB);
  if (!row?.confirmed_at) return failFallback(userId, c.env.DB, 'totp');
  const secret = await decryptString(c.env.TOTP_KEY, row.secret_enc);
  if (!(await verifyTotp(secret, b.code, Date.now())))
    return failFallback(userId, c.env.DB, 'totp');
  await writeAudit(userId, c.env.DB, 'auth.login', { detail: { method: 'totp' } });
  return issueSession(c, userId);
});

auth.post('/recovery/verify', async (c) => {
  const b = await body(c, FallbackLoginBody);
  const userId = await fallbackUser(c, b.email);
  const hash = await hashSecret(normalizeRecovery(b.code));
  if (!(await consumeRecoveryCode(userId, c.env.DB, hash)))
    return failFallback(userId, c.env.DB, 'recovery');
  await writeAudit(userId, c.env.DB, 'auth.recovery_used');
  return issueSession(c, userId);
});

const normalizeRecovery = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();

// ── refresh rotation with reuse detection ─────────────────────────────────────

auth.post('/refresh', async (c) => {
  const parsed = parseRefresh(readRefreshCookie(c) ?? '');
  if (!parsed) throw unauthorized();
  const { userId, sessionId, secret } = parsed;
  const session = await getSession(userId, c.env.DB, sessionId);
  if (!session || session.revoked_at || session.expires_at <= new Date().toISOString()) {
    clearRefreshCookie(c);
    throw unauthorized();
  }
  const presented = await hashSecret(secret);
  if (!safeEqual(presented, session.refresh_hash)) {
    // A superseded token was replayed: assume theft and kill the whole family.
    await revokeSession(userId, c.env.DB, sessionId);
    await writeAudit(userId, c.env.DB, 'auth.refresh_reuse_detected', {
      type: 'session',
      id: sessionId,
    });
    clearRefreshCookie(c);
    throw unauthorized('Session ended — sign in again');
  }
  const next = newRefreshSecret();
  const rotated = await rotateSession(
    userId,
    c.env.DB,
    sessionId,
    presented,
    await hashSecret(next),
    refreshExpiry(),
  );
  if (!rotated) throw unauthorized();
  setRefreshCookie(c, formatRefresh(userId, sessionId, next));
  return c.json({ access: await signAccess(c.env, userId, sessionId) });
});

auth.post('/logout', async (c) => {
  const parsed = parseRefresh(readRefreshCookie(c) ?? '');
  if (parsed) {
    const s = await getSession(parsed.userId, c.env.DB, parsed.sessionId);
    if (s && safeEqual(await hashSecret(parsed.secret), s.refresh_hash)) {
      await revokeSession(parsed.userId, c.env.DB, parsed.sessionId);
      await writeAudit(parsed.userId, c.env.DB, 'auth.logout');
    }
  }
  clearRefreshCookie(c);
  return c.body(null, 204);
});

// ── signed-in setup of the fallbacks ──────────────────────────────────────────

auth.post('/totp/setup', requireAuth, requireStepUp, async (c) => {
  const userId = c.get('userId');
  const user = await getUser(userId, c.env.DB);
  if (!user) throw unauthorized();
  const secret = newTotpSecret();
  await putPendingTotp(userId, c.env.DB, await encryptString(c.env.TOTP_KEY, secret));
  return c.json({ otpauthUri: otpauthUri(secret, user.email, c.env.RP_NAME), secret });
});

auth.post('/totp/confirm', requireAuth, requireStepUp, async (c) => {
  const userId = c.get('userId');
  const { code } = await body(c, TotpConfirmBody);
  const row = await getTotp(userId, c.env.DB);
  if (!row) throw new AppError(409, 'CONFLICT', 'Start TOTP setup first');
  const secret = await decryptString(c.env.TOTP_KEY, row.secret_enc);
  if (!(await verifyTotp(secret, code, Date.now())))
    throw new AppError(400, 'BAD_REQUEST', 'Code not accepted');
  await confirmTotp(userId, c.env.DB);
  await writeAudit(userId, c.env.DB, 'auth.totp_enabled');
  return c.json({ ok: true });
});

/** Generates 10 fresh codes, invalidating any previous set. Shown once; stored hashed. */
auth.post('/recovery/generate', requireAuth, requireStepUp, async (c) => {
  const userId = c.get('userId');
  const codes = Array.from({ length: 10 }, () => {
    const raw = b64urlEncode(randomBytes(8)).replace(/[-_]/g, 'X').slice(0, 10).toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  await replaceRecoveryCodes(
    userId,
    c.env.DB,
    await Promise.all(
      codes.map(async (code) => ({
        id: crypto.randomUUID(),
        hash: await hashSecret(normalizeRecovery(code)),
      })),
    ),
  );
  await writeAudit(userId, c.env.DB, 'auth.recovery_generated');
  return c.json({ codes });
});
