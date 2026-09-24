import type { AppLock } from '@rise/shared/schemas';

/**
 * App lock (T45, SPEC §9). Everything here is local to the device: the lock gates the app
 * on this phone, never the account. The server only stores the chosen timing.
 */

const AFTER_MS: Record<Exclude<AppLock, 'off'>, number> = {
  immediate: 0,
  '5m': 5 * 60_000,
  '1h': 60 * 60_000,
};

/** Whether the app should be locked now, given when it was last put away. */
export function shouldLock(mode: AppLock, hiddenAt: number | null, now: number): boolean {
  if (mode === 'off') return false;
  // No record of leaving (a crash, a fresh install of the page): lock, the safe side.
  if (hiddenAt === null) return true;
  return now - hiddenAt >= AFTER_MS[mode];
}

const K = {
  mode: 'rise-lock-mode',
  hiddenAt: 'rise-lock-hidden-at',
  locked: 'rise-locked',
  pin: 'rise-lock-pin',
  fails: 'rise-lock-pin-fails',
} as const;

/** localStorage that never throws (private mode, blocked storage). */
export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      // Nothing to do: the lock falls back to its safe defaults.
    }
  },
};

export const lockKeys = K;

export const localMode = (): AppLock => {
  const v = store.get(K.mode);
  return v === 'immediate' || v === '5m' || v === '1h' ? v : 'off';
};

// ── PIN ────────────────────────────────────────────────────────────────────────

export const PIN_MAX_FAILS = 5;
const ITERATIONS = 150_000;

interface StoredPin {
  salt: string;
  hash: string;
  iterations: number;
  /** So the pad can submit on the last digit instead of asking for a tap. */
  length: number;
}

const b64 = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const validPin = (pin: string) => /^\d{4,8}$/.test(pin);

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return b64(bits);
}

/** Only a salted PBKDF2 hash is kept; the PIN itself never touches storage. */
export async function setPin(pin: string): Promise<void> {
  if (!validPin(pin)) throw new Error('PIN must be 4 to 8 digits');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const stored: StoredPin = {
    salt: b64(salt),
    hash: await derive(pin, salt, ITERATIONS),
    iterations: ITERATIONS,
    length: pin.length,
  };
  store.set(K.pin, JSON.stringify(stored));
  store.set(K.fails, null);
}

export const clearPin = () => {
  store.set(K.pin, null);
  store.set(K.fails, null);
};

export const hasPin = () => store.get(K.pin) !== null;

export function pinLength(): number | null {
  const raw = store.get(K.pin);
  return raw ? ((JSON.parse(raw) as StoredPin).length ?? null) : null;
}

export const pinFails = () => Number(store.get(K.fails) ?? 0) || 0;

/**
 * Checks a PIN. After PIN_MAX_FAILS wrong tries the PIN is wiped and only the passkey can
 * unlock — a PIN is short, so it must not be guessable at leisure.
 */
export async function checkPin(pin: string): Promise<'ok' | 'wrong' | 'wiped'> {
  const raw = store.get(K.pin);
  if (!raw) return 'wiped';
  const p = JSON.parse(raw) as StoredPin;
  const got = await derive(pin, unb64(p.salt), p.iterations);
  if (got === p.hash) {
    store.set(K.fails, null);
    return 'ok';
  }
  const fails = pinFails() + 1;
  if (fails >= PIN_MAX_FAILS) {
    clearPin();
    return 'wiped';
  }
  store.set(K.fails, String(fails));
  return 'wrong';
}

/** A fresh, interactive sign-in is itself the check: start unlocked. */
export function clearLock() {
  store.set(K.locked, null);
  store.set(K.hiddenAt, null);
}

/** Signing out leaves nothing of the lock behind on this device. */
export function forgetLock() {
  clearLock();
  clearPin();
  store.set(K.mode, null);
}
