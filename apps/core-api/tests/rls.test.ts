import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, prismaAdmin } from '../src/db.js';
import { withTx } from '../src/tenant.js';
import {
  addMember,
  closeTestApp,
  createOrg,
  createProject,
  createTask,
  resetDb,
  signupUser,
} from './helpers.js';
import { Role } from '@prisma/client';

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closeTestApp(); });

describe('RLS canary — app client without session variable', () => {
  it('returns zero rows on tasks when no app.current_user_id is set', async () => {
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);
    const project = await createProject(org.id, owner.user.id);
    await createTask(project.id, owner.user.id);

    // prismaAdmin: bypasses RLS, should see the row.
    const seenByAdmin = await prismaAdmin.task.count();
    expect(seenByAdmin).toBe(1);

    // prisma (app role) without withTx: no session var → policies filter everything.
    const seenByApp = await prisma.task.count();
    expect(seenByApp).toBe(0);
  });

  it('returns zero rows on organizations when no app.current_user_id is set', async () => {
    const owner = await signupUser();
    await createOrg(owner.user.id);

    const seenByAdmin = await prismaAdmin.organization.count();
    expect(seenByAdmin).toBe(1);

    const seenByApp = await prisma.organization.count();
    expect(seenByApp).toBe(0);
  });
});

describe('RLS canary — cross-user isolation inside withTx', () => {
  it('user B cannot see user A\'s projects via direct DB query', async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const aliceOrg = await createOrg(alice.user.id);
    const bobOrg = await createOrg(bob.user.id);
    await createProject(aliceOrg.id, alice.user.id, { name: 'Alice secret' });
    await createProject(bobOrg.id, bob.user.id, { name: 'Bob project' });

    const bobSees = await withTx(bob.user.id, (tx) => tx.project.findMany());
    expect(bobSees).toHaveLength(1);
    expect(bobSees[0].name).toBe('Bob project');

    const aliceSees = await withTx(alice.user.id, (tx) => tx.project.findMany());
    expect(aliceSees).toHaveLength(1);
    expect(aliceSees[0].name).toBe('Alice secret');
  });

  it('user B cannot see user A\'s tasks even by guessed id', async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const aliceOrg = await createOrg(alice.user.id);
    await createOrg(bob.user.id);
    const aliceProject = await createProject(aliceOrg.id, alice.user.id);
    const aliceTask = await createTask(aliceProject.id, alice.user.id);

    const bobAttempt = await withTx(bob.user.id, (tx) =>
      tx.task.findUnique({ where: { id: aliceTask.id } })
    );
    expect(bobAttempt).toBeNull();
  });

  it('user B cannot see memberships of user A\'s org', async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const aliceOrg = await createOrg(alice.user.id);
    await createOrg(bob.user.id);
    const third = await signupUser();
    await addMember(third.user.id, aliceOrg.id, Role.MEMBER);

    const bobSees = await withTx(bob.user.id, (tx) =>
      tx.membership.findMany({ where: { organizationId: aliceOrg.id } })
    );
    expect(bobSees).toHaveLength(0);
  });
});

describe('RLS canary — positive: own tenant is still visible', () => {
  it('user sees their own org, project, tasks via withTx', async () => {
    const alice = await signupUser();
    const org = await createOrg(alice.user.id);
    const project = await createProject(org.id, alice.user.id);
    await createTask(project.id, alice.user.id);
    await createTask(project.id, alice.user.id);

    const result = await withTx(alice.user.id, async (tx) => ({
      orgs: await tx.organization.count(),
      projects: await tx.project.count(),
      tasks: await tx.task.count(),
    }));

    expect(result.orgs).toBe(1);
    expect(result.projects).toBe(1);
    expect(result.tasks).toBe(2);
  });
});
