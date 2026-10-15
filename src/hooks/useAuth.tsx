'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api, tokenStore, ApiClientError } from '@/lib/api';
import type { PublicUser } from '@/types';

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, if a token exists, verify it and hydrate the user. A stale or
  // revoked token clears itself rather than leaving the UI in a broken state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tokenStore.get()) {
        setLoading(false);
        return;
      }
      try {
        const { user } = await api.auth.me();
        if (!cancelled) setUser(user);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) tokenStore.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user, token } = await api.auth.login({ email, password });
    tokenStore.set(token);
    setUser(user);
  }, []);

  const signup = useCallback(async (email: string, password: string, fullName: string) => {
    const { user, token } = await api.auth.signup({ email, password, fullName });
    tokenStore.set(token);
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
