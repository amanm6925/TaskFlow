import { Role, TaskStatus } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  authHeader,
  closeTestApp,
  createOrg,
  createProject,
  createTask,
  getTestApp,
  resetDb,
  signupUser,
} from './helpers.js';

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closeTestApp(); });

describe('IDOR defense — cross-org task access', () => {
  it('user from Org B cannot GET a task in Org A', async () => {
    const app = await getTestApp();
    const ownerA = await signupUser();
    const ownerB = await signupUser();
    const orgA = await createOrg(ownerA.user.id);
    await createOrg(ownerB.user.id);
    const projectA = await createProject(orgA.id, ownerA.user.id);
    const taskA = await createTask(projectA.id, ownerA.user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskA.id}`,
      headers: authHeader(ownerB.accessToken),
    });
    // RLS filters the task out at the DB level, so the handler responds
    // 'task_not_found' — strictly better than 'org_not_found' because it
    // doesn't leak that a task with this id exists.
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('task_not_found');
  });

  it('user from Org B cannot PATCH a task in Org A', async () => {
    const app = await getTestApp();
    const ownerA = await signupUser();
    const ownerB = await signupUser();
    const orgA = await createOrg(ownerA.user.id);
    await createOrg(ownerB.user.id);
    const projectA = await createProject(orgA.id, ownerA.user.id);
    const taskA = await createTask(projectA.id, ownerA.user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskA.id}`,
      headers: authHeader(ownerB.accessToken),
      payload: { title: 'Hijacked' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('user from Org B cannot DELETE a task in Org A', async () => {
    const app = await getTestApp();
    const ownerA = await signupUser();
    const ownerB = await signupUser();
    const orgA = await createOrg(ownerA.user.id);
    await createOrg(ownerB.user.id);
    const projectA = await createProject(orgA.id, ownerA.user.id);
    const taskA = await createTask(projectA.id, ownerA.user.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskA.id}`,
      headers: authHeader(ownerB.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('role matrix — task:create (POST /api/projects/:projectId/tasks)', () => {
  it.each([
    [Role.OWNER, 201],
    [Role.ADMIN, 201],
    [Role.MEMBER, 201],
    [Role.VIEWER, 403],
  ])('role %s → %i', async (role, expected) => {
    const app = await getTestApp();
    const owner = await signupUser();
    const actor = await signupUser();
    const org = await createOrg(owner.user.id);
    if (role !== Role.OWNER) await addMember(actor.user.id, org.id, role);
    const project = await createProject(org.id, owner.user.id);

    const token = role === Role.OWNER ? owner.accessToken : actor.accessToken;
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/tasks`,
      headers: authHeader(token),
      payload: { title: 'New task' },
    });
    expect(res.statusCode).toBe(expected);
  });
});

describe('task:update stakeholder override', () => {
  it('MEMBER who is neither reporter nor assignee cannot update', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const bystander = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(bystander.user.id, org.id, Role.MEMBER);
    const project = await createProject(org.id, owner.user.id);
    const task = await createTask(project.id, owner.user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: authHeader(bystander.accessToken),
      payload: { status: TaskStatus.DONE },
    });
    expect(res.statusCode).toBe(403);
  });

  it('MEMBER who is the assignee can update', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const assignee = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(assignee.user.id, org.id, Role.MEMBER);
    const project = await createProject(org.id, owner.user.id);
    const task = await createTask(project.id, owner.user.id, { assigneeId: assignee.user.id });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: authHeader(assignee.accessToken),
      payload: { status: TaskStatus.DONE },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe(TaskStatus.DONE);
  });

  it('MEMBER who is the reporter can update their own task', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const reporter = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(reporter.user.id, org.id, Role.MEMBER);
    const project = await createProject(org.id, owner.user.id);
    const task = await createTask(project.id, reporter.user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: authHeader(reporter.accessToken),
      payload: { title: 'Updated by reporter' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('ADMIN can update any task without the stakeholder override', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const admin = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(admin.user.id, org.id, Role.ADMIN);
    const project = await createProject(org.id, owner.user.id);
    const task = await createTask(project.id, owner.user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: authHeader(admin.accessToken),
      payload: { status: TaskStatus.DONE },
    });
    expect(res.statusCode).toBe(200);
  });

  it('VIEWER cannot update any task (matrix denies outright)', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const viewer = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(viewer.user.id, org.id, Role.VIEWER);
    const project = await createProject(org.id, owner.user.id);
    const task = await createTask(project.id, owner.user.id, { assigneeId: viewer.user.id });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: authHeader(viewer.accessToken),
      payload: { status: TaskStatus.DONE },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('task:delete reporter override', () => {
  it('MEMBER who is the reporter can delete their own task', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const reporter = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(reporter.user.id, org.id, Role.MEMBER);
    const project = await createProject(org.id, owner.user.id);
    const task = await createTask(project.id, reporter.user.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${task.id}`,
      headers: authHeader(reporter.accessToken),
    });
    expect(res.statusCode).toBe(204);
  });

  it('MEMBER who is assignee-only cannot delete (must be reporter)', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const assignee = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(assignee.user.id, org.id, Role.MEMBER);
    const project = await createProject(org.id, owner.user.id);
    const task = await createTask(project.id, owner.user.id, { assigneeId: assignee.user.id });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${task.id}`,
      headers: authHeader(assignee.accessToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
