import { env, exports } from 'cloudflare:workers';
import { createUser } from '../../src/db';
import { signRegistration } from '../../src/lib/tokens';
import { SoftAuthenticator } from './authenticator';

export const BASE = 'https://rise.test';

export async function call(
  method: string,
  path: string,
  opts: { body?: unknown; access?: string; cookie?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.access) headers['authorization'] = `Bearer ${opts.access}`;
  if (opts.cookie) headers['cookie'] = opts.cookie;
  const res = await exports.default.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}

/** The `rise_refresh=…` pair from a response, ready to send back as a Cookie header. */
export function refreshCookie(headers: Headers): string {
  const set = headers.get('set-cookie') ?? '';
  const m = /rise_refresh=([^;]*)/.exec(set);
  return m && m[1] ? `rise_refresh=${m[1]}` : '';
}

export async function newUser() {
  const userId = crypto.randomUUID();
  const email = `${userId.slice(0, 8)}@example.com`;
  await createUser(userId, env.DB, { email, displayName: 'Caleb' });
  return { userId, email };
}

/** Provision a user, register a passkey via the one-time link, and sign in. */
export async function signedInUser() {
  const { userId, email } = await newUser();
  const device = new SoftAuthenticator(env.RP_ID, env.RP_ORIGIN);
  const registrationToken = await signRegistration(env, userId);
  const opts = await call('POST', '/auth/passkey/register/options', {
    body: { registrationToken },
  });
  const reg = await call('POST', '/auth/passkey/register/verify', {
    body: {
      challengeToken: opts.json.challengeToken,
      response: await device.register(opts.json.options),
    },
  });
  if (reg.status !== 201) throw new Error(`registration failed: ${JSON.stringify(reg.json)}`);
  const login = await passkeyLogin(device);
  return {
    userId,
    email,
    device,
    access: login.json.access as string,
    cookie: refreshCookie(login.headers),
  };
}

export async function passkeyLogin(device: SoftAuthenticator, userHandle?: string) {
  const opts = await call('POST', '/auth/passkey/login/options');
  return call('POST', '/auth/passkey/login/verify', {
    body: {
      challengeToken: opts.json.challengeToken,
      response: await device.login(opts.json.options, userHandle),
    },
  });
}
