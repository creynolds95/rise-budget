import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode } from '../src/lib/crypto';
import {
  deriveContentKeys,
  encryptPayload,
  generateVapidKeys,
  vapidAuthorization,
} from '../src/lib/webpush';

/** A browser's side of a subscription, made up for the test. */
async function browser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, pub, auth, p256dh: b64urlEncode(pub), authB64: b64urlEncode(auth) };
}

describe('Web Push (RFC 8291 / 8292)', () => {
  it('encrypts a payload only the subscribing browser can read', async () => {
    const b = await browser();
    const body = await encryptPayload(
      { endpoint: 'https://push.example/x', p256dh: b.p256dh, auth: b.authB64 },
      '{"title":"Rise"}',
    );
    const salt = body.slice(0, 16);
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    const asPublic = body.slice(21, 86);
    const as = await crypto.subtle.importKey(
      'raw',
      asPublic,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const secret = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: as } as unknown as SubtleCryptoDeriveKeyAlgorithm,
        b.pair.privateKey,
        256,
      ),
    );
    const { cek, nonce } = await deriveContentKeys(secret, b.auth, b.pub, asPublic, salt);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(86)),
    );
    expect(plain.at(-1)).toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"title":"Rise"}');
  });

  it('signs a VAPID token the public key verifies, for the push service origin', async () => {
    const keys = await generateVapidKeys();
    const h = await vapidAuthorization(
      keys,
      'https://web.push.example/abc',
      'mailto:owner@example.com',
      new Date('2026-10-08T12:00:00Z'),
    );
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
    expect(m?.[4]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m?.[2] ?? '')));
    expect(claims).toMatchObject({
      aud: 'https://web.push.example',
      sub: 'mailto:owner@example.com',
    });
    const pub = await crypto.subtle.importKey(
      'raw',
      b64urlDecode(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      b64urlDecode(m?.[3] ?? ''),
      new TextEncoder().encode(`${m?.[1]}.${m?.[2]}`),
    );
    expect(ok).toBe(true);
  });
});
