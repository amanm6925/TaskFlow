import { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  authHeader,
  closeTestApp,
  createOrg,
  createProject,
  getTestApp,
  resetDb,
  signupUser,
} from './helpers.js';

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closeTestApp(); });

describe('role matrix — project:create (POST /api/orgs/:orgId/projects)', () => {
  it.each([
    [Role.OWNER, 201],
    [Role.ADMIN, 201],
    [Role.MEMBER, 403], // bug fix: MEMBER used to be allowed
    [Role.VIEWER, 403],
  ])('role %s → %i', async (role, expected) => {
    const app = await getTestApp();
    const owner = await signupUser();
    const actor = await signupUser();
    const org = await createOrg(owner.user.id);
    if (role !== Role.OWNER) {
      await addMember(actor.user.id, org.id, role);
    }

    const token = role === Role.OWNER ? owner.accessToken : actor.accessToken;
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.id}/projects`,
      headers: authHeader(token),
      payload: { name: 'Proj', key: `KEY${Date.now().toString().slice(-4)}` },
    });
    expect(res.statusCode).toBe(expected);
  });
});

describe('project:read visibility', () => {
  it('all roles can list projects', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const viewer = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(viewer.user.id, org.id, Role.VIEWER);
    await createProject(org.id, owner.user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${org.id}/projects`,
      headers: authHeader(viewer.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('non-member gets 404 on direct project read (IDOR defense)', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const outsider = await signupUser();
    const org = await createOrg(owner.user.id);
    const project = await createProject(org.id, owner.user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
      headers: authHeader(outsider.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('project:update — creator override', () => {
  it('MEMBER who created the project can update it', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const creator = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(creator.user.id, org.id, Role.MEMBER);
    const project = await createProject(org.id, creator.user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      headers: authHeader(creator.accessToken),
      payload: { name: 'Renamed by creator' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renamed by creator');
  });

  it('MEMBER who did not create the project cannot update it', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const other = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(other.user.id, org.id, Role.MEMBER);
    const project = await createProject(org.id, owner.user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      headers: authHeader(other.accessToken),
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('VIEWER who created the project still cannot update it (read-only invariant)', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const viewer = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(viewer.user.id, org.id, Role.VIEWER);
    const project = await createProject(org.id, viewer.user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      headers: authHeader(viewer.accessToken),
      payload: { name: 'Viewer creator edit' },
    });
    expect(res.statusCode).toBe(403);
  });
});
