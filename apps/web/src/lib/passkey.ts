import { ApiError } from './api';

/**
 * What a failed passkey ceremony should say. The browser's reason matters: "cancelled" and
 * "this device already has one" need different next steps, and a generic "failed" hid a
 * misconfigured domain once already.
 */
export function passkeyMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  const { name, code } = (e ?? {}) as { name?: string; code?: string };
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError')
    return 'This device already has a Rise passkey. Use it to sign in.';
  if (code === 'ERROR_INVALID_RP_ID' || code === 'ERROR_INVALID_DOMAIN' || name === 'SecurityError')
    return "This browser won't use a passkey on this address. Open Rise at its usual address and try again.";
  if (name === 'NotAllowedError') return `${fallback} It was cancelled or timed out.`;
  if (name === 'NotSupportedError' || code === 'ERROR_CEREMONY_ABORTED')
    return `${fallback} This browser can't make that passkey. Try Safari or Chrome.`;
  return fallback;
}
