import { encodeCBOR, type CBORType } from '@levischuck/tiny-cbor';
import { b64urlDecode, b64urlEncode, randomBytes } from '../../src/lib/crypto';

const enc = new TextEncoder();
const sha256 = async (b: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};

/** DER-encode a raw r||s ECDSA signature, as authenticators do. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (x: Uint8Array) => {
    let i = 0;
    while (i < x.length - 1 && x[i] === 0) i++;
    let v = x.slice(i);
    if ((v[0] as number) & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

/**
 * A software passkey (ES256, "none" attestation) for exercising the real WebAuthn
 * verification path end to end in tests.
 */
export class SoftAuthenticator {
  private keys!: CryptoKeyPair;
  readonly credId = randomBytes(16);
  private counter = 0;
  userHandle = '';

  constructor(
    private rpId: string,
    private origin: string,
  ) {}

  private clientData(type: string, challenge: string) {
    return enc.encode(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  async register(options: { challenge: string; user: { id: string } }) {
    this.keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    this.userHandle = options.user.id;
    const raw = new Uint8Array(
      (await crypto.subtle.exportKey('raw', this.keys.publicKey)) as ArrayBuffer,
    );
    const cose = encodeCBOR(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, raw.slice(1, 33)],
        [-3, raw.slice(33, 65)],
      ]),
    );
    const authData = concat(
      await sha256(enc.encode(this.rpId)),
      new Uint8Array([0x01 | 0x04 | 0x40]),
      u32(this.counter),
      new Uint8Array(16),
      new Uint8Array([0, this.credId.length]),
      this.credId,
      cose,
    );
    const attestationObject = encodeCBOR(
      new Map<string, CBORType>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    const id = b64urlEncode(this.credId);
    return {
      id,
      rawId: id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64urlEncode(this.clientData('webauthn.create', options.challenge)),
        attestationObject: b64urlEncode(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  async login(options: { challenge: string }, userHandle = this.userHandle) {
    this.counter += 1;
    const clientDataJSON = this.clientData('webauthn.get', options.challenge);
    const authData = concat(
      await sha256(enc.encode(this.rpId)),
      new Uint8Array([0x01 | 0x04]),
      u32(this.counter),
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        this.keys.privateKey,
        concat(authData, await sha256(clientDataJSON)),
      ),
    );
    const id = b64urlEncode(this.credId);
    return {
      id,
      rawId: id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64urlEncode(clientDataJSON),
        authenticatorData: b64urlEncode(authData),
        signature: b64urlEncode(rawToDer(sig)),
        userHandle,
      },
      clientExtensionResults: {},
    };
  }
}

export { b64urlDecode };
