import type { Page } from '@playwright/test';

// Reads PROD_URL at module load. playwright.prod.config.ts validates this is set.
const PROD_URL = (process.env.PROD_URL ?? '').replace(/\/$/, '');

type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export type SignupResult = {
  user: { id: string; email: string; name: string };
  accessToken: string;
  refreshToken: string;
};

let counter = 0;

function bearer(token: string) {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

export async function signupViaApi(overrides: { email?: string; password?: string; name?: string } = {}): Promise<SignupResult> {
  counter += 1;
  const stamp = `${Date.now()}-${counter}`;
  const email = overrides.email ?? `prod-smoke+${stamp}@taskflow.test`;
  const password = overrides.password ?? 'correct-horse-battery-staple';
  const name = overrides.name ?? `Prod Smoke ${stamp}`;

  const response = await fetch(`${PROD_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!response.ok) {
    throw new Error(`signupViaApi failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as SignupResult;
}

export async function createOrgApi(
  token: string,
  overrides: { name?: string; slug?: string } = {},
): Promise<{ id: string; name: string; slug: string; role: Role }> {
  counter += 1;
  const stamp = `${Date.now()}-${counter}`;
  const name = overrides.name ?? `Prod Org ${stamp}`;
  const slug = overrides.slug ?? `prod-${Date.now().toString().slice(-6)}-${counter}`;
  const res = await fetch(`${PROD_URL}/api/orgs`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({ name, slug }),
  });
  if (!res.ok) throw new Error(`createOrgApi failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function createProjectApi(
  token: string,
  orgId: string,
  overrides: { name?: string; key?: string } = {},
): Promise<{ id: string; name: string; key: string }> {
  counter += 1;
  const name = overrides.name ?? `Prod Project ${counter}`;
  const rawKey = overrides.key ?? `PR${Date.now().toString().slice(-4)}${counter}`;
  const key = rawKey.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const res = await fetch(`${PROD_URL}/api/orgs/${orgId}/projects`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({ name, key }),
  });
  if (!res.ok) throw new Error(`createProjectApi failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Seed localStorage before any page JS runs, so the auth context picks up the
 * tokens on first render. Must be called before page.goto().
 */
export async function injectTokens(page: Page, accessToken: string, refreshToken: string) {
  await page.addInitScript(([access, refresh]) => {
    window.localStorage.setItem('taskflow_access_token', access);
    window.localStorage.setItem('taskflow_refresh_token', refresh);
  }, [accessToken, refreshToken]);
}
