'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE, api, clearTokens, getAccessToken, getRefreshToken, setTokens } from './api';

export type User = { id: string; email: string; name: string; avatarUrl: string | null };
export type OrgSummary = { id: string; name: string; slug: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' };

type AuthContextValue = {
  user: User | null;
  orgs: OrgSummary[];
  loading: boolean;
  refresh: () => Promise<void>;
  signup: (input: { email: string; password: string; name: string }) => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
};

type AuthResponse = { user: User; accessToken: string; refreshToken: string };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null);
      setOrgs([]);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: User; organizations: OrgSummary[] }>('/api/me');
      setUser(data.user);
      setOrgs(data.organizations);
    } catch {
      setUser(null);
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const data = await api<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setTokens(data.accessToken, data.refreshToken);
    await refresh();
    router.push('/dashboard');
  }, [refresh, router]);

  const signup = useCallback(async (input: { email: string; password: string; name: string }) => {
    const data = await api<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setTokens(data.accessToken, data.refreshToken);
    await refresh();
    router.push('/dashboard');
  }, [refresh, router]);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // Network failure shouldn't trap the user — fall through to local clear.
      }
    }
    clearTokens();
    setUser(null);
    setOrgs([]);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, orgs, loading, refresh, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
