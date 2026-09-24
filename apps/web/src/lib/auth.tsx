import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onAuthChange, refresh, setAccess } from './api';

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
    const off = onAuthChange((signedIn) => setStatus(signedIn ? 'signedIn' : 'signedOut'));
    void refresh().then((ok) => setStatus(ok ? 'signedIn' : 'signedOut'));
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
      setAccess(access);
    },
    async signInWithCode(kind, email, code) {
      const { access } = await api<{ access: string }>('POST', `/auth/${kind}/verify`, {
        email,
        code,
      });
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
