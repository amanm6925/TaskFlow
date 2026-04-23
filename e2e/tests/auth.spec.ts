import { expect, test } from '@playwright/test';
import { resetDb } from '../helpers/db';
import { signupViaApi } from '../helpers/auth';

test.beforeEach(async () => {
  await resetDb();
});

test('signup form creates a user and lands on dashboard', async ({ page }) => {
  await page.goto('/signup');

  const email = `signup+${Date.now()}@test.local`;
  await page.locator('form input').nth(0).fill('Ada Lovelace');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('password1234');
  await page.getByRole('button', { name: /sign up/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
});

test('login form accepts valid credentials', async ({ page }) => {
  const { user } = await signupViaApi({
    email: 'login-test@test.local',
    password: 'password1234',
    name: 'Login Test',
  });

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill('password1234');
  await page.getByRole('button', { name: /log in/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(user.email)).toBeVisible();
});

test('login with wrong password shows an error and stays on /login', async ({ page }) => {
  await signupViaApi({ email: 'wrongpw@test.local', password: 'password1234' });

  await page.goto('/login');
  await page.locator('input[type="email"]').fill('wrongpw@test.local');
  await page.locator('input[type="password"]').fill('this-is-wrong');
  await page.getByRole('button', { name: /log in/i }).click();

  await expect(page.getByText(/invalid_credentials/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('unauthenticated visit to /dashboard redirects to /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});
