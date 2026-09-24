import { useEffect, useState, type ReactNode } from 'react';
import { isOnline } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PIN_MAX_FAILS,
  checkPin,
  hasPin,
  localMode,
  lockKeys as K,
  pinFails,
  pinLength,
  shouldLock,
  store,
} from '../lib/lock';
import { useMe } from '../lib/queries';
import { Button } from './primitives/Button';

const hiddenAt = () => {
  const v = Number(store.get(K.hiddenAt));
  return Number.isFinite(v) && v > 0 ? v : null;
};

function lockedNow(): boolean {
  if (store.get(K.locked) === '1') return true;
  return shouldLock(localMode(), hiddenAt(), Date.now());
}

/**
 * T45. Covers the whole app when it comes back after the chosen time, and covers it the moment
 * it's put away so the app switcher never shows balances. The lock survives a reload: once
 * locked, it stays locked until unlocked.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const me = useMe().data;
  const [locked, setLocked] = useState(lockedNow);
  const [covered, setCovered] = useState(false);

  // The server holds the choice; this device keeps a copy so it can lock before /me loads.
  useEffect(() => {
    if (me) store.set(K.mode, me.settings.appLock);
  }, [me?.settings.appLock]);

  useEffect(() => {
    if (locked) store.set(K.locked, '1');
  }, [locked]);

  useEffect(() => {
    const away = () => {
      if (localMode() === 'off') return;
      store.set(K.hiddenAt, String(Date.now()));
      setCovered(true);
    };
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      if (lockedNow()) setLocked(true);
      setCovered(false);
    };
    const onVis = () => (document.visibilityState === 'hidden' ? away() : back());
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', away);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', away);
    };
  }, []);

  const unlock = () => {
    store.set(K.locked, null);
    store.set(K.hiddenAt, null);
    setLocked(false);
  };

  if (locked) return <LockScreen onUnlock={unlock} />;
  return (
    <>
      {children}
      {covered && (
        <div aria-hidden className="fixed inset-0 z-50 flex items-center justify-center bg-canvas">
          <img src="/favicon.svg" alt="" className="size-16" />
        </div>
      )}
    </>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { signInWithPasskey, signOut } = useAuth();
  const [mode, setMode] = useState<'passkey' | 'pin'>(() =>
    hasPin() && !isOnline() ? 'pin' : 'passkey',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `quiet` is the automatic prompt on open: if the browser refuses it (some need a tap
  // first), the Unlock button is already there, so an error would only be noise.
  const passkey = async (quiet = false) => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPasskey();
      onUnlock();
    } catch {
      if (quiet) return;
      setError(
        isOnline()
          ? 'That didn’t go through. Try again.'
          : 'You’re offline, and a passkey needs a connection.' +
              (hasPin() ? ' Use your PIN instead.' : ''),
      );
    } finally {
      setBusy(false);
    }
  };

  // Offer the passkey straight away, the way a banking app asks for Face ID on open.
  useEffect(() => {
    if (mode === 'passkey' && isOnline()) void passkey(true);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="gutter fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas pb-[env(safe-area-inset-bottom)] text-center"
    >
      <img src="/favicon.svg" alt="" className="size-16 rounded-[18px] shadow-soft" />
      <h1 id="lock-title" className="mt-6 type-title">
        Rise is locked
      </h1>
      {mode === 'passkey' ? (
        <>
          <p className="mt-2 max-w-xs text-ink-muted">
            Unlock with your passkey to see your money.
          </p>
          <div className="mt-8 flex w-full max-w-xs flex-col gap-2">
            <Button disabled={busy} onClick={() => void passkey()}>
              {busy ? 'Waiting for passkey…' : 'Unlock'}
            </Button>
            {hasPin() && (
              <Button variant="quiet" onClick={() => setMode('pin')}>
                Use PIN
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-4 max-w-xs type-caption text-clay">
              {error}
            </p>
          )}
        </>
      ) : (
        <PinPad
          onUnlock={onUnlock}
          onPasskey={() => {
            setError(null);
            setMode('passkey');
          }}
        />
      )}
      <button
        onClick={() => void signOut()}
        className="absolute bottom-[max(24px,env(safe-area-inset-bottom))] min-h-11 px-4 type-caption text-ink-muted"
      >
        Sign out
      </button>
    </div>
  );
}

function PinPad({ onUnlock, onPasskey }: { onUnlock: () => void; onPasskey: () => void }) {
  const length = pinLength() ?? 4;
  const [digits, setDigits] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [gone, setGone] = useState(!hasPin());

  const submit = async (pin: string) => {
    const r = await checkPin(pin);
    if (r === 'ok') return onUnlock();
    setDigits('');
    setShake(true);
    setTimeout(() => setShake(false), 400);
    if (r === 'wiped') {
      setGone(true);
      setMessage(`Too many wrong tries, so the PIN was turned off. Unlock with your passkey.`);
    } else {
      const left = PIN_MAX_FAILS - pinFails();
      setMessage(`Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
    }
  };
  const press = (d: string) => {
    if (gone) return;
    const next = (digits + d).slice(0, length);
    setDigits(next);
    if (next.length === length) void submit(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') setDigits((x) => x.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <p className="mt-2 text-ink-muted">{gone ? 'PIN turned off' : 'Enter your PIN'}</p>
      <div
        aria-label={`${digits.length} of ${length} digits entered`}
        role="status"
        className={`mt-6 flex gap-3 ${shake ? 'animate-[shake_0.4s]' : ''}`}
      >
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={`size-3.5 rounded-full border-2 ${
              i < digits.length ? 'border-sage-700 bg-sage-700' : 'border-ink-faint'
            }`}
          />
        ))}
      </div>
      {message && (
        <p role="alert" className="mt-4 max-w-xs type-caption text-clay">
          {message}
        </p>
      )}
      <div className="mt-8 grid w-full max-w-[264px] grid-cols-3 gap-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} label={d} onClick={() => press(d)} disabled={gone} />
        ))}
        <button
          onClick={onPasskey}
          className="aspect-square rounded-full type-caption text-sage-700"
        >
          Passkey
        </button>
        <Key label="0" onClick={() => press('0')} disabled={gone} />
        <button
          aria-label="Delete digit"
          onClick={() => setDigits((x) => x.slice(0, -1))}
          className="aspect-square rounded-full text-ink-muted active:bg-sage-100"
        >
          ⌫
        </button>
      </div>
    </>
  );
}

function Key({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="aspect-square rounded-full bg-surface text-2xl shadow-soft active:bg-sage-100 disabled:opacity-40 money"
    >
      {label}
    </button>
  );
}
