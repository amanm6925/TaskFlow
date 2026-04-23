import type { Page } from '@playwright/test';
import { API_BASE } from '../playwright.config';

export type SignupResult = {
  user: { id: string; email: string; name: string };
  accessToken: string;
  refreshToken: string;
};

let counter = 0;

export async function signupViaApi(overrides: { email?: string; password?: string; name?: string } = {}): Promise<SignupResult> {
  counter += 1;
  const email = overrides.email ?? `e2e${counter}+${Date.now()}@test.local`;
  const password = overrides.password ?? 'correct-horse-battery-staple';
  const name = overrides.name ?? `E2E User ${counter}`;

  const response = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!response.ok) {
    throw new Error(`signupViaApi failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as SignupResult;
}

/**
 * Seed localStorage before any page JS runs, so the auth context reads the tokens
 * on first render. Must be called BEFORE page.goto().
 */
export async function injectTokens(page: Page, accessToken: string, refreshToken: string) {
  await page.addInitScript(([access, refresh]) => {
    window.localStorage.setItem('taskflow_access_token', access);
    window.localStorage.setItem('taskflow_refresh_token', refresh);
  }, [accessToken, refreshToken]);
}
