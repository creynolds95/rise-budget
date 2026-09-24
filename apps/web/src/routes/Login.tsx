import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/primitives/Button';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Passkey first; a code is the fallback (SPEC §9). */
export function Login() {
  const auth = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<'passkey' | 'totp' | 'recovery'>('passkey');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      void nav('/', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in was cancelled or failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gutter mx-auto flex min-h-dvh max-w-sm flex-col justify-center">
      <h1 className="font-serif text-5xl tracking-tight text-sage-700">Rise</h1>
      <p className="mt-2 text-ink-muted">Money you plan, carried month to month.</p>
      {mode === 'passkey' ? (
        <div className="mt-12 flex flex-col gap-3">
          <Button disabled={busy} onClick={() => run(auth.signInWithPasskey)}>
            Sign in with passkey
          </Button>
          <Button variant="quiet" onClick={() => setMode('totp')}>
            Use a code instead
          </Button>
        </div>
      ) : (
        <form
          className="mt-12 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => auth.signInWithCode(mode, email, code));
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="type-label text-ink-muted">Email</span>
            <input
              className="min-h-11 rounded-input border border-hairline bg-surface px-3"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="type-label text-ink-muted">
              {mode === 'totp' ? 'Authenticator code' : 'Recovery code'}
            </span>
            <input
              className="min-h-11 rounded-input border border-hairline bg-surface px-3 money"
              inputMode={mode === 'totp' ? 'numeric' : 'text'}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <Button type="submit" disabled={busy}>
            Sign in
          </Button>
          <div className="flex justify-between">
            <Button variant="quiet" onClick={() => setMode(mode === 'totp' ? 'recovery' : 'totp')}>
              {mode === 'totp' ? 'Use a recovery code' : 'Use an authenticator code'}
            </Button>
            <Button variant="quiet" onClick={() => setMode('passkey')}>
              Passkey
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-4 text-clay">
          {error}
        </p>
      )}
    </div>
  );
}

/** The one-time link from `pnpm seed:user`: /register#token=… */
export function Register() {
  const auth = useAuth();
  const nav = useNavigate();
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="gutter mx-auto flex min-h-dvh max-w-sm flex-col justify-center">
      <h1 className="font-serif text-5xl tracking-tight text-sage-700">Rise</h1>
      <p className="mt-2 text-ink-muted">Create the passkey you'll sign in with on this device.</p>
      <Button
        className="mt-12"
        disabled={busy || !token}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await auth.registerPasskey(token);
            await auth.signInWithPasskey();
            void nav('/', { replace: true });
          } catch (e) {
            setError(
              e instanceof ApiError ? e.message : 'Passkey creation was cancelled or failed.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Create passkey
      </Button>
      {!token && (
        <p className="mt-4 text-clay">This link is missing its token. Ask for a new one.</p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-clay">
          {error}
        </p>
      )}
    </div>
  );
}
