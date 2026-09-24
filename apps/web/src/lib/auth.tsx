import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onAuthChange, refreshSession, setAccess } from './api';
import { clearLock, forgetLock } from './lock';

/** Set while this device holds a session, so a cold start offline can still open the cache. */
const HAD_SESSION = 'rise-had-session';
const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(HAD_SESSION, '1');
    else localStorage.removeItem(HAD_SESSION);
  } catch {
    // Private mode: offline start just won't be available.
  }
};
const hadSession = () => {
  try {
    return localStorage.getItem(HAD_SESSION) === '1';
  } catch {
    return false;
  }
};

type Status = 'loading' | 'signedOut' | 'signedIn';

interface Auth {
  status: Status;
  signInWithPasskey(): Promise<void>;
  signInWithCode(kind: 'totp' | 'recovery', email: string, code: string): Promise<void>;
  registerPasskey(registrationToken?: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const off = onAuthChange((signedIn) => {
      remember(signedIn);
      setStatus(signedIn ? 'signedIn' : 'signedOut');
    });
    // Offline with a session on this device: open on cached data. The next request that
    // reaches the server refreshes the token, or signs out if the session has ended.
    void refreshSession().then((r) =>
      setStatus(r === 'ok' || (r === 'offline' && hadSession()) ? 'signedIn' : 'signedOut'),
    );
    return off;
  }, []);

  const value: Auth = {
    status,
    async signInWithPasskey() {
      const { options, challengeToken } = await api<{ options: never; challengeToken: string }>(
        'POST',
        '/auth/passkey/login/options',
      );
      const response = await startAuthentication({ optionsJSON: options });
      const { access } = await api<{ access: string }>('POST', '/auth/passkey/login/verify', {
        challengeToken,
        response,
      });
      clearLock();
      setAccess(access);
    },
    async signInWithCode(kind, email, code) {
      const { access } = await api<{ access: string }>('POST', `/auth/${kind}/verify`, {
        email,
        code,
      });
      clearLock();
      setAccess(access);
    },
    async registerPasskey(registrationToken) {
      const { options, challengeToken } = await api<{ options: never; challengeToken: string }>(
        'POST',
        '/auth/passkey/register/options',
        registrationToken ? { registrationToken } : {},
      );
      const response = await startRegistration({ optionsJSON: options });
      await api('POST', '/auth/passkey/register/verify', { challengeToken, response });
    },
    async signOut() {
      await api('POST', '/auth/logout').catch(() => undefined);
      forgetLock();
      setAccess(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
