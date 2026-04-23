export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

function wsBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) {
    if (typeof window === 'undefined') return 'ws://localhost:3001/ws';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  return base.replace(/^http/, 'ws') + '/ws';
}

/**
 * Build the /ws URL with the current access token in a query param.
 * Call at connect time — not as a module-level constant — so the token reflects
 * the latest refresh rotation.
 */
export function getWsUrl(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  return `${wsBase()}?token=${encodeURIComponent(token)}`;
}

const ACCESS_KEY = 'taskflow_access_token';
const REFRESH_KEY = 'taskflow_refresh_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  const response = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  });

  if (!response.ok) {
    clearTokens();
    return null;
  }

  const data = (await response.json()) as { accessToken: string; refreshToken: string };
  setTokens(data.accessToken, data.refreshToken);
  return data.accessToken;
}

function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

type RequestOptions = RequestInit & { _retried?: boolean };

export async function api<T = unknown>(path: string, init: RequestOptions = {}): Promise<T> {
  const accessToken = getAccessToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (response.status === 401 && !init._retried && getRefreshToken()) {
    const newAccess = await refreshOnce();
    if (newAccess) {
      return api<T>(path, { ...init, _retried: true });
    }
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    const body = await response.json().catch(() => ({}));
    throw new ApiError(401, body.error ?? 'unauthenticated', body.message ?? body.error);
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearTokens();
    throw new ApiError(response.status, body.error ?? 'unknown', body.message ?? body.error);
  }
  return body as T;
}
