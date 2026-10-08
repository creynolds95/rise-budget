import { b64urlDecode, b64urlEncode, randomBytes } from './crypto';

/**
 * Web Push from the Worker with nothing but WebCrypto: VAPID (RFC 8292) to identify the
 * sender, and aes128gcm payload encryption (RFC 8291) so the push service never reads the
 * message. One ECDH, two HKDFs, one AES-GCM and one ECDSA signature per send.
 */

const enc = new TextEncoder();
const utf8 = (s: string): Uint8Array<ArrayBuffer> => concat(enc.encode(s));

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url: the browser's `applicationServerKey`. */
  publicKey: string;
  /** The private key as a JWK, JSON. */
  privateJwk: string;
}

export interface PushTarget {
  endpoint: string;
  /** The browser's P-256 key and auth secret, base64url, from `PushSubscription.toJSON()`. */
  p256dh: string;
  auth: string;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64urlEncode(raw), privateJwk: JSON.stringify(jwk) };
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8),
  );
}

/** The content key and nonce both sides derive (RFC 8291 §3.4, RFC 8188 §2.2). */
export async function deriveContentKeys(
  ecdhSecret: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
  uaPublic: Uint8Array,
  asPublic: Uint8Array,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ cek: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer> }> {
  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(enc.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const [cek, nonce] = await Promise.all([
    hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16),
    hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12),
  ]);
  return { cek, nonce };
}

/** One aes128gcm record: salt, record size, the sender's public key, then the ciphertext. */
export async function encryptPayload(target: PushTarget, payload: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  const ephemeral = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer,
  );
  const ua = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      // Standard name `public`; the Workers types spell it `$public`.
      { name: 'ECDH', public: ua } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      ephemeral.privateKey,
      256,
    ),
  );
  const salt = randomBytes(16);
  const { cek, nonce } = await deriveContentKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // A single, last record: the payload then the 0x02 delimiter, no padding.
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** The VAPID Authorization header for one push service (its origin is the audience). */
export async function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  subject: string,
  now: Date,
): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(keys.privateJwk) as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      enc.encode(`${header}.${claims}`),
    ),
  );
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Send one message. `gone` means the browser unsubscribed: drop the subscription. */
export async function sendPush(
  keys: VapidKeys,
  target: PushTarget,
  payload: string,
  subject: string,
  now: Date,
): Promise<PushOutcome> {
  const body = await encryptPayload(target, payload);
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(keys, target.endpoint, subject, now),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.ok ? 'sent' : 'failed';
}
