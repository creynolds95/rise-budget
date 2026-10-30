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
  claimFallbackAttempt,
  confirmTotp,
  consumeInvite,
  consumeRecoveryCode,
  findUserIdByEmail,
  getCredential,
  getSession,
  getTotp,
  getUser,
  insertCredential,
  insertInvite,
  listCredentials,
  listLiveInvites,
  liveInviteHash,
  pendingTotpSecret,
  putPendingTotp,
  releaseFallbackAttempt,
  replaceRecoveryCodes,
  revokeInvite,
  revokeSession,
  rotateSession,
  spendTotpStep,
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
import { deviceLabel } from '../lib/device';
import { AppError } from '../lib/errors';
import {
  clearRefreshCookie,
  issueSession,
  optionalAuth,
  readRefreshCookie,
  refreshExpiry,
  requireAuth,
  requireOwner,
  requireStepUp,
  setRefreshCookie,
} from '../lib/session';
import {
  formatInvite,
  formatRefresh,
  hashRecoveryCode,
  hashSecret,
  INVITE_TTL_MS,
  newRefreshSecret,
  nextRefreshSecret,
  parseInvite,
  parseRefresh,
  REFRESH_GRACE_MS,
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

/**
 * Who a registration is for, and (for a share link) which invite it spends. A signed-in session
 * adds a device; a seed link registers the first one; a share link registers one more, once.
 */
async function registeringUser(c: Context<AppEnv>, token?: string, inviteToken?: string) {
  const signedIn = c.get('userId');
  if (signedIn) return { userId: signedIn, inviteId: '', role: c.get('role') };
  if (inviteToken) {
    const parsed = parseInvite(inviteToken);
    const stored = parsed && (await liveInviteHash(parsed.userId, c.env.DB, parsed.sessionId));
    if (!parsed || !stored || !safeEqual(await hashSecret(parsed.secret), stored))
      throw unauthorized('This link has expired or was already used. Ask for a new one.');
    return { userId: parsed.userId, inviteId: parsed.sessionId, role: 'member' as const };
  }
  const reg = token ? await verifyRegistration(c.env, token) : null;
  if (!reg) throw unauthorized();
  return { userId: reg.userId, inviteId: '', role: 'owner' as const };
}

auth.post('/passkey/register/options', optionalAuth, requireStepUp, async (c) => {
  const { registrationToken, inviteToken } = await body(c, RegisterOptionsBody);
  const { userId, inviteId, role } = await registeringUser(c, registrationToken, inviteToken);
  const user = await getUser(userId, c.env.DB);
  if (!user) throw unauthorized();
  const existing = await listCredentials(userId, c.env.DB);
  // The link from `seed:user` registers the FIRST device only; later devices need a session
  // or a share link.
  if (!c.get('userId') && !inviteId && existing.length > 0)
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
    challengeToken: await signChallenge(c.env, options.challenge, 'register', userId, {
      inviteId,
      role,
    }),
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
  // A share link is spent only by a passkey that verified, and only once.
  if (ch.inviteId) {
    if (!b.deviceLabel?.trim()) throw new AppError(400, 'BAD_REQUEST', 'Enter your name first');
    if (!(await consumeInvite(ch.userId, c.env.DB, ch.inviteId)))
      throw unauthorized('This link has expired or was already used. Ask for a new one.');
    await writeAudit(ch.userId, c.env.DB, 'auth.invite_used', { type: 'invite', id: ch.inviteId });
  }
  const cred = verification.registrationInfo.credential;
  await insertCredential(ch.userId, c.env.DB, {
    id: cred.id,
    publicKey: cred.publicKey,
    counter: cred.counter,
    transports: cred.transports ?? [],
    deviceLabel: b.deviceLabel?.trim() || deviceLabel(c.req.header('User-Agent')),
    role: ch.role,
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
  return issueSession(c, userId, { role: cred.role, credentialId: cred.id });
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

/**
 * Resolves the user and claims one attempt against the lockout before any code is checked. The
 * claim is a single conditional write, so a burst of parallel guesses can't all read "under the
 * limit" first; an accepted code gives its attempt back (`succeedFallback`).
 */
async function fallbackUser(c: Context<AppEnv>, email: string) {
  const userId = await findUserIdByEmail(c.env.DB, email);
  if (!userId) throw unauthorized('Code not accepted');
  if (!(await claimFallbackAttempt(userId, c.env.DB, MAX_FAILURES, LOCKOUT_MS))) {
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
  const step = await verifyTotp(secret, b.code, Date.now());
  // A code is good once: replaying it (or an older one) inside its window fails like a wrong one.
  if (step === null || !(await spendTotpStep(userId, c.env.DB, step)))
    return failFallback(userId, c.env.DB, 'totp');
  await releaseFallbackAttempt(userId, c.env.DB);
  await writeAudit(userId, c.env.DB, 'auth.login', { detail: { method: 'totp' } });
  return issueSession(c, userId);
});

auth.post('/recovery/verify', async (c) => {
  const b = await body(c, FallbackLoginBody);
  const userId = await fallbackUser(c, b.email);
  const code = normalizeRecovery(b.code);
  const [hash, legacy] = await Promise.all([hashRecoveryCode(c.env, code), hashSecret(code)]);
  if (!(await consumeRecoveryCode(userId, c.env.DB, hash, legacy)))
    return failFallback(userId, c.env.DB, 'recovery');
  await releaseFallbackAttempt(userId, c.env.DB);
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
  const next = await nextRefreshSecret(c.env, sessionId, secret);
  const nextHash = await hashSecret(next);
  const issue = async () => {
    setRefreshCookie(c, formatRefresh(userId, sessionId, next));
    return c.json({ access: await signAccess(c.env, userId, sessionId) });
  };

  if (safeEqual(presented, session.refresh_hash)) {
    if (await rotateSession(userId, c.env.DB, sessionId, presented, nextHash, refreshExpiry()))
      return issue();
    // Lost the compare-and-swap to a concurrent refresh with this same token. The successor
    // is derived, so if that one rotated to it, this caller gets the same token.
    const now = await getSession(userId, c.env.DB, sessionId);
    if (now && !now.revoked_at && safeEqual(nextHash, now.refresh_hash)) return issue();
    throw unauthorized();
  }

  // The token that was current a moment ago: another tab refreshed first, or this device never
  // got the last response. Within the grace window it gets the session's current token.
  const inGrace =
    session.prev_refresh_hash !== null &&
    session.rotated_at !== null &&
    Date.parse(session.rotated_at) > Date.now() - REFRESH_GRACE_MS &&
    safeEqual(presented, session.prev_refresh_hash) &&
    safeEqual(nextHash, session.refresh_hash);
  if (inGrace) return issue();

  // An older token, or the last one replayed after the window: assume theft, end the family.
  await revokeSession(userId, c.env.DB, sessionId);
  await writeAudit(userId, c.env.DB, 'auth.refresh_reuse_detected', {
    type: 'session',
    id: sessionId,
  });
  clearRefreshCookie(c);
  throw unauthorized('Session ended — sign in again');
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

auth.post('/totp/setup', requireAuth, requireOwner, requireStepUp, async (c) => {
  const userId = c.get('userId');
  const user = await getUser(userId, c.env.DB);
  if (!user) throw unauthorized();
  const secret = newTotpSecret();
  // A confirmed authenticator keeps working until this new one is confirmed.
  await putPendingTotp(userId, c.env.DB, await encryptString(c.env.TOTP_KEY, secret));
  return c.json({ otpauthUri: otpauthUri(secret, user.email, c.env.RP_NAME), secret });
});

auth.post('/totp/confirm', requireAuth, requireOwner, requireStepUp, async (c) => {
  const userId = c.get('userId');
  const { code } = await body(c, TotpConfirmBody);
  const row = await getTotp(userId, c.env.DB);
  const pendingEnc = row && pendingTotpSecret(row);
  if (!pendingEnc) throw new AppError(409, 'CONFLICT', 'Start TOTP setup first');
  const secret = await decryptString(c.env.TOTP_KEY, pendingEnc);
  const step = await verifyTotp(secret, code, Date.now());
  if (step === null) throw new AppError(400, 'BAD_REQUEST', 'Code not accepted');
  if (!(await confirmTotp(userId, c.env.DB, pendingEnc, step)))
    throw new AppError(409, 'CONFLICT', 'Setup was restarted — scan the newest code');
  await writeAudit(userId, c.env.DB, 'auth.totp_enabled');
  return c.json({ ok: true });
});

/** Generates 10 fresh codes, invalidating any previous set. Shown once; stored hashed. */
auth.post('/recovery/generate', requireAuth, requireOwner, requireStepUp, async (c) => {
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
        hash: await hashRecoveryCode(c.env, normalizeRecovery(code)),
      })),
    ),
  );
  await writeAudit(userId, c.env.DB, 'auth.recovery_generated');
  return c.json({ codes });
});

// ── share links (Settings > Share) ────────────────────────────────────────────

auth.get('/invite', requireAuth, requireOwner, async (c) => {
  const rows = await listLiveInvites(c.get('userId'), c.env.DB);
  return c.json({
    invites: rows.map((r) => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at })),
  });
});

/** Mints a single-use link that registers one passkey. Only its hash is kept. */
auth.post('/invite', requireAuth, requireOwner, requireStepUp, async (c) => {
  const userId = c.get('userId');
  const id = crypto.randomUUID();
  const secret = newRefreshSecret();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  await insertInvite(userId, c.env.DB, { id, secretHash: await hashSecret(secret), expiresAt });
  await writeAudit(userId, c.env.DB, 'auth.invite_created', { type: 'invite', id });
  return c.json({ token: formatInvite(userId, id, secret), expiresAt }, 201);
});

auth.delete('/invite/:id', requireAuth, requireOwner, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await revokeInvite(userId, c.env.DB, id)))
    throw new AppError(404, 'NOT_FOUND', 'That link is already gone');
  await writeAudit(userId, c.env.DB, 'auth.invite_revoked', { type: 'invite', id });
  return c.body(null, 204);
});
