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

test('cross-org isolation: user in Org B receives zero WS frames for Org A events', async ({ browser }) => {
  // Two entirely separate tenants. No membership overlap.
  const ownerA = await signupViaApi({ name: 'Owner A' });
  const ownerB = await signupViaApi({ name: 'Owner B' });
  const orgA = await createOrg(ownerA.accessToken, { name: 'Tenant A' });
  const orgB = await createOrg(ownerB.accessToken, { name: 'Tenant B' });
  const projectA = await createProject(ownerA.accessToken, orgA.id);
  const projectB = await createProject(ownerB.accessToken, orgB.id);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  // Capture every WS frame pageB receives. This is the ground truth —
  // asserts at the protocol layer, not the UI layer, so a server-side leak
  // can't hide behind the frontend's projectId filter.
  const framesReceivedByB: string[] = [];
  pageB.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const payload = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf-8');
      framesReceivedByB.push(payload);
    });
  });

  await injectTokens(pageA, ownerA.accessToken, ownerA.refreshToken);
  await injectTokens(pageB, ownerB.accessToken, ownerB.refreshToken);

  await pageA.goto(`/orgs/${orgA.slug}/projects/${projectA.key}`);
  await pageB.goto(`/orgs/${orgB.slug}/projects/${projectB.key}`);
  await expect(pageA.getByText('WS: open')).toBeVisible();
  await expect(pageB.getByText('WS: open')).toBeVisible();

  // A performs a mutation that would broadcast.
  await pageA.getByPlaceholder(/new task title/i).fill('Secret Tenant A task');
  await pageA.getByRole('button', { name: /^add$/i }).click();
  await expect(pageA.getByText('Secret Tenant A task')).toBeVisible();

  // Let any potential WS frame propagate.
  await pageB.waitForTimeout(500);

  // B must have received zero frames mentioning Org A — no task title, no orgId.
  const leaked = framesReceivedByB.some(
    (f) => f.includes('Secret Tenant A task') || f.includes(orgA.id) || f.includes(projectA.id)
  );
  expect(leaked, `pageB received leaked frames: ${JSON.stringify(framesReceivedByB)}`).toBe(false);

  await contextA.close();
  await contextB.close();
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
