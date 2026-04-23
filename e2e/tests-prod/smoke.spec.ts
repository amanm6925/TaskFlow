import { expect, test } from '@playwright/test';
import { createOrgApi, createProjectApi, injectTokens, signupViaApi } from './helpers';

// These tests run against a real deployed TaskFlow. Every test creates fresh,
// uniquely-named tenant data — we never reset the prod DB, and assertions must
// tolerate unrelated orgs/users that already exist.

test('signup via UI → dashboard shows user', async ({ page }) => {
  const email = `ui-signup+${Date.now()}@t.local`;

  await page.goto('/signup');
  await page.locator('form input').nth(0).fill('Prod UI User');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('password1234');
  await page.getByRole('button', { name: /sign up/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
});

test('unauthenticated /dashboard redirects to /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('full flow: API signup → UI create org → project → task', async ({ page }) => {
  // API-level setup keeps the UI assertions tight and fast.
  const { accessToken, refreshToken } = await signupViaApi({ name: 'Flow User' });
  await injectTokens(page, accessToken, refreshToken);

  // Dashboard reflects empty org list.
  await page.goto('/dashboard');
  await expect(page.getByText(/no orgs yet/i)).toBeVisible();

  // Create an org.
  const slug = `prodflow-${Date.now().toString().slice(-6)}`;
  await page.getByPlaceholder('name').fill('Prod Flow Co');
  await page.getByPlaceholder(/slug/i).fill(slug);
  await page.getByRole('button', { name: /create org/i }).click();
  await expect(page.getByRole('link', { name: /Prod Flow Co/ })).toBeVisible();

  // Into the org.
  await page.getByRole('link', { name: /Prod Flow Co/ }).click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${slug}$`));

  // Create a project.
  const projectKey = `F${Date.now().toString().slice(-4)}`;
  await page.getByPlaceholder('name').fill('Launch');
  await page.getByPlaceholder(/key/i).fill(projectKey);
  await page.getByRole('button', { name: /create project/i }).click();
  const projectLink = page.getByRole('link', { name: new RegExp(`${projectKey} Launch`) });
  await expect(projectLink).toBeVisible();

  // Into the project.
  await projectLink.click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${slug}/projects/${projectKey}$`));

  // The task list only re-renders via WebSocket broadcast (no optimistic update
  // from the HTTP response). Wait for the socket to be open before we create.
  await expect(page.getByText('WS: open')).toBeVisible();

  // Create a task; assert it renders with the right numbering.
  await page.getByPlaceholder(/new task title/i).fill('Prod smoke task');
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByText('Prod smoke task')).toBeVisible();
  await expect(page.getByText(`${projectKey}-1`)).toBeVisible();
});

test('realtime: two tabs in the same org see each other\'s task changes', async ({ browser }) => {
  // Fully API-set-up shared project so we only time the UI WS propagation.
  const owner = await signupViaApi({ name: 'WS Owner' });
  const org = await createOrgApi(owner.accessToken, { name: 'WS Realtime Co' });
  // Invite a second user as a MEMBER.
  const member = await signupViaApi({ name: 'WS Member' });
  const inviteRes = await fetch(`${process.env.PROD_URL!.replace(/\/$/, '')}/api/orgs/${org.id}/members`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ email: member.user.email, role: 'MEMBER' }),
  });
  expect(inviteRes.ok, `invite failed: ${inviteRes.status}`).toBeTruthy();
  const project = await createProjectApi(owner.accessToken, org.id);

  const ctxOwner = await browser.newContext();
  const ctxMember = await browser.newContext();
  const pageOwner = await ctxOwner.newPage();
  const pageMember = await ctxMember.newPage();

  await injectTokens(pageOwner, owner.accessToken, owner.refreshToken);
  await injectTokens(pageMember, member.accessToken, member.refreshToken);

  const path = `/orgs/${org.slug}/projects/${project.key}`;
  await pageOwner.goto(path);
  await pageMember.goto(path);
  await expect(pageOwner.getByText('WS: open')).toBeVisible();
  await expect(pageMember.getByText('WS: open')).toBeVisible();

  await pageOwner.getByPlaceholder(/new task title/i).fill('Cross-tab visibility');
  await pageOwner.getByRole('button', { name: /^add$/i }).click();

  await expect(pageMember.getByText('Cross-tab visibility')).toBeVisible();

  await ctxOwner.close();
  await ctxMember.close();
});
