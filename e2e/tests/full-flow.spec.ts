import { expect, test } from '@playwright/test';
import { resetDb } from '../helpers/db';
import { injectTokens, signupViaApi } from '../helpers/auth';

test.beforeEach(async () => {
  await resetDb();
});

test('signup → create org → create project → create task, visible end-to-end', async ({ page }) => {
  const { accessToken, refreshToken, user } = await signupViaApi({ name: 'Journey User' });
  await injectTokens(page, accessToken, refreshToken);

  // 1. Dashboard shows no orgs yet.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  await expect(page.getByText(/no orgs yet/i)).toBeVisible();

  // 2. Create an organization.
  const slug = `acme-${Date.now().toString().slice(-6)}`;
  await page.getByPlaceholder('name').fill('Acme Corp');
  await page.getByPlaceholder(/slug/i).fill(slug);
  await page.getByRole('button', { name: /create org/i }).click();

  const orgLink = page.getByRole('link', { name: /Acme Corp/ });
  await expect(orgLink).toBeVisible();

  // 3. Navigate into the org.
  await orgLink.click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${slug}$`));
  await expect(page.getByRole('heading', { name: 'Acme Corp' })).toBeVisible();
  await expect(page.getByText(/no projects yet/i)).toBeVisible();

  // 4. Create a project.
  const projectKey = `P${Date.now().toString().slice(-4)}`;
  await page.getByPlaceholder('name').fill('Website');
  await page.getByPlaceholder(/key/i).fill(projectKey);
  await page.getByRole('button', { name: /create project/i }).click();

  const projectLink = page.getByRole('link', { name: new RegExp(`${projectKey} Website`) });
  await expect(projectLink).toBeVisible();

  // 5. Open the project.
  await projectLink.click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${slug}/projects/${projectKey}$`));
  await expect(page.getByRole('heading', { name: new RegExp(`${projectKey} · Website`) })).toBeVisible();
  await expect(page.getByText(/no tasks yet/i)).toBeVisible();

  // 6. Create a task.
  await page.getByPlaceholder(/new task title/i).fill('Ship the landing page');
  await page.getByRole('button', { name: /^add$/i }).click();

  // 7. Task appears in the list with the expected key.
  await expect(page.getByText('Ship the landing page')).toBeVisible();
  await expect(page.getByText(`${projectKey}-1`)).toBeVisible();
});
