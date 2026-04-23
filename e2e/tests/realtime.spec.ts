import { expect, test } from '@playwright/test';
import { resetDb } from '../helpers/db';
import { injectTokens, signupViaApi } from '../helpers/auth';
import { createOrg, createProject, inviteMember } from '../helpers/fixtures';

test.beforeEach(async () => {
  await resetDb();
});

async function setupSharedProject() {
  const owner = await signupViaApi({ name: 'Owner User' });
  const member = await signupViaApi({ name: 'Member User' });
  const org = await createOrg(owner.accessToken, { name: 'Realtime Inc' });
  await inviteMember(owner.accessToken, org.id, member.user.email, 'MEMBER');
  const project = await createProject(owner.accessToken, org.id);
  return { owner, member, org, project };
}

test('task created by one user appears in another user\'s tab without reload', async ({ browser }) => {
  const { owner, member, org, project } = await setupSharedProject();

  const contextOwner = await browser.newContext();
  const contextMember = await browser.newContext();
  const pageOwner = await contextOwner.newPage();
  const pageMember = await contextMember.newPage();

  await injectTokens(pageOwner, owner.accessToken, owner.refreshToken);
  await injectTokens(pageMember, member.accessToken, member.refreshToken);

  const projectPath = `/orgs/${org.slug}/projects/${project.key}`;
  await pageOwner.goto(projectPath);
  await pageMember.goto(projectPath);

  // Wait for the WS indicator on both tabs before proceeding —
  // otherwise the owner could send a task before member's socket is listening.
  await expect(pageOwner.getByText('WS: open')).toBeVisible();
  await expect(pageMember.getByText('WS: open')).toBeVisible();

  // Member sees empty state.
  await expect(pageMember.getByText(/no tasks yet/i)).toBeVisible();

  // Owner creates a task.
  await pageOwner.getByPlaceholder(/new task title/i).fill('Collaborate in realtime');
  await pageOwner.getByRole('button', { name: /^add$/i }).click();

  // The task appears on the member's tab without them doing anything.
  await expect(pageMember.getByText('Collaborate in realtime')).toBeVisible();
  await expect(pageMember.getByText(`${project.key}-1`)).toBeVisible();

  await contextOwner.close();
  await contextMember.close();
});

test('task status changed by one user updates in another user\'s tab', async ({ browser }) => {
  const { owner, member, org, project } = await setupSharedProject();

  const contextOwner = await browser.newContext();
  const contextMember = await browser.newContext();
  const pageOwner = await contextOwner.newPage();
  const pageMember = await contextMember.newPage();

  await injectTokens(pageOwner, owner.accessToken, owner.refreshToken);
  await injectTokens(pageMember, member.accessToken, member.refreshToken);

  const projectPath = `/orgs/${org.slug}/projects/${project.key}`;
  await pageOwner.goto(projectPath);
  await pageMember.goto(projectPath);
  await expect(pageOwner.getByText('WS: open')).toBeVisible();
  await expect(pageMember.getByText('WS: open')).toBeVisible();

  // Owner creates a task, both tabs now show it.
  await pageOwner.getByPlaceholder(/new task title/i).fill('Status propagation test');
  await pageOwner.getByRole('button', { name: /^add$/i }).click();
  const memberRow = pageMember.getByRole('listitem').filter({ hasText: 'Status propagation test' });
  await expect(memberRow).toBeVisible();

  // Owner changes the task's status via the dropdown.
  const ownerRow = pageOwner.getByRole('listitem').filter({ hasText: 'Status propagation test' });
  await ownerRow.locator('select').selectOption('DONE');

  // Member's dropdown reflects the new status.
  await expect(memberRow.locator('select')).toHaveValue('DONE');

  await contextOwner.close();
  await contextMember.close();
});
