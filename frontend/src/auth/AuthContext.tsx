import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, refreshSession, setAccessToken, setAuthLostHandler } from '../lib/api';
import type { AuthResult, User } from '../lib/types';

type Status = 'loading' | 'authenticated' | 'anonymous';
interface AuthValue {
  status: Status; user: User | null; bootstrapError: string | null;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
  retryBootstrap: () => void;
}
const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cancelled = useRef(false);

  // On first load there is no access token in memory: ask the server to rotate the refresh cookie (if any).
  useEffect(() => {
    cancelled.current = false;
    setStatus('loading'); setBootstrapError(null);
    refreshSession().then((r) => {
      if (cancelled.current) return;
      if (r) { setUser(r.user); setStatus('authenticated'); } else { setUser(null); setStatus('anonymous'); }
    }).catch((e: unknown) => {
      if (cancelled.current) return;
      setBootstrapError(e instanceof ApiError ? e.message : 'Cannot reach the server.');
      setStatus('anonymous');
    });
    return () => { cancelled.current = true; };
  }, [attempt]);

  const clear = useCallback(() => { setAccessToken(null); setUser(null); setStatus('anonymous'); qc.clear(); }, [qc]);
  useEffect(() => { setAuthLostHandler(clear); return () => setAuthLostHandler(null); }, [clear]);

  const adopt = useCallback((r: AuthResult) => { setAccessToken(r.accessToken); setUser(r.user); setStatus('authenticated'); setBootstrapError(null); qc.clear(); }, [qc]);
  const value = useMemo<AuthValue>(() => ({
    status, user, bootstrapError, setUser,
    login: async (email, password, rememberMe) => adopt(await api.post<AuthResult>('/auth/login', { email, password, rememberMe }, { auth: false })),
    register: async (fullName, email, password) => adopt(await api.post<AuthResult>('/auth/register', { fullName, email, password }, { auth: false })),
    logout: async () => { try { await api.post('/auth/logout', {}, { auth: false }); } catch { /* the cookie may already be gone; clear locally anyway */ } clear(); },
    retryBootstrap: () => setAttempt((n) => n + 1),
  }), [status, user, bootstrapError, adopt, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
