import { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  authHeader,
  closeTestApp,
  createOrg,
  getTestApp,
  resetDb,
  signupUser,
} from './helpers.js';

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closeTestApp(); });

describe('org scope isolation (IDOR defense)', () => {
  it('non-member gets 404 on GET /api/orgs/:orgId', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const outsider = await signupUser();
    const org = await createOrg(owner.user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${org.id}`,
      headers: authHeader(outsider.accessToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('org_not_found');
  });

  it('unauthenticated gets 401', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);

    const res = await app.inject({ method: 'GET', url: `/api/orgs/${org.id}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('role matrix — org:update (PATCH /api/orgs/:orgId)', () => {
  it.each([
    [Role.OWNER, 200],
    [Role.ADMIN, 200],
    [Role.MEMBER, 403],
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
      method: 'PATCH',
      url: `/api/orgs/${org.id}`,
      headers: authHeader(token),
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(expected);
  });
});

describe('role matrix — org:delete (DELETE /api/orgs/:orgId)', () => {
  it.each([
    [Role.OWNER, 204],
    [Role.ADMIN, 403],
    [Role.MEMBER, 403],
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
      method: 'DELETE',
      url: `/api/orgs/${org.id}`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(expected);
  });
});

describe('role matrix — member:invite (POST /api/orgs/:orgId/members)', () => {
  it('ADMIN can invite a MEMBER', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const admin = await signupUser();
    const invitee = await signupUser({ email: 'invitee@test.local' });
    const org = await createOrg(owner.user.id);
    await addMember(admin.user.id, org.id, Role.ADMIN);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.id}/members`,
      headers: authHeader(admin.accessToken),
      payload: { email: 'invitee@test.local', role: Role.MEMBER },
    });
    expect(res.statusCode).toBe(201);
  });

  it('ADMIN cannot invite someone as OWNER (only_owner_can_create_owner)', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const admin = await signupUser();
    const invitee = await signupUser({ email: 'invitee@test.local' });
    const org = await createOrg(owner.user.id);
    await addMember(admin.user.id, org.id, Role.ADMIN);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.id}/members`,
      headers: authHeader(admin.accessToken),
      payload: { email: 'invitee@test.local', role: Role.OWNER },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('only_owner_can_create_owner');
  });

  it('MEMBER cannot invite anyone', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const member = await signupUser();
    const invitee = await signupUser({ email: 'invitee@test.local' });
    const org = await createOrg(owner.user.id);
    await addMember(member.user.id, org.id, Role.MEMBER);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.id}/members`,
      headers: authHeader(member.accessToken),
      payload: { email: 'invitee@test.local', role: Role.MEMBER },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('last-owner invariants', () => {
  it('demoting the sole owner fails with 409', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${org.id}/members/${owner.user.id}`,
      headers: authHeader(owner.accessToken),
      payload: { role: Role.ADMIN },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('cannot_demote_last_owner');
  });

  it('removing the sole owner fails with 409', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${org.id}/members/${owner.user.id}`,
      headers: authHeader(owner.accessToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('cannot_remove_last_owner');
  });

  it('demoting an owner when a second owner exists succeeds', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const second = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(second.user.id, org.id, Role.OWNER);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${org.id}/members/${second.user.id}`,
      headers: authHeader(owner.accessToken),
      payload: { role: Role.ADMIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe(Role.ADMIN);
  });
});
