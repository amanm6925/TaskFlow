import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, requireMembership, requireRole } from '../permissions.js';

const createOrgBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]{3,50}$/, 'slug must be 3-50 chars: a-z, 0-9, -'),
});

const updateOrgBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: z.string().regex(/^[a-z0-9-]{3,50}$/).optional(),
});

const inviteBody = z.object({
  email: z.string().email().toLowerCase(),
  role: z.nativeEnum(Role),
});

const updateMemberBody = z.object({
  role: z.nativeEnum(Role),
});

export async function orgRoutes(app: FastifyInstance) {
  app.post('/api/orgs', { preHandler: app.authenticate }, async (request, reply) => {
    const body = createOrgBody.parse(request.body);
    const userId = request.user.userId;

    const existing = await prisma.organization.findUnique({ where: { slug: body.slug } });
    if (existing) throw new HttpError(409, 'slug_taken');

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { name: body.name, slug: body.slug } });
      await tx.membership.create({
        data: { userId, organizationId: created.id, role: Role.OWNER },
      });
      return created;
    });

    return reply.code(201).send({ id: org.id, name: org.name, slug: org.slug, role: Role.OWNER });
  });

  app.get('/api/orgs/:orgId', { preHandler: app.authenticate }, async (request) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.params);
    await requireMembership(request.user.userId, orgId);
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new HttpError(404, 'org_not_found');
    return org;
  });

  app.patch('/api/orgs/:orgId', { preHandler: app.authenticate }, async (request) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.params);
    const body = updateOrgBody.parse(request.body);
    const m = await requireMembership(request.user.userId, orgId);
    requireRole(m.role, Role.ADMIN);

    if (body.slug) {
      const conflict = await prisma.organization.findFirst({
        where: { slug: body.slug, NOT: { id: orgId } },
      });
      if (conflict) throw new HttpError(409, 'slug_taken');
    }

    return prisma.organization.update({ where: { id: orgId }, data: body });
  });

  app.delete('/api/orgs/:orgId', { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.params);
    const m = await requireMembership(request.user.userId, orgId);
    requireRole(m.role, Role.OWNER);

    await prisma.organization.delete({ where: { id: orgId } });
    return reply.code(204).send();
  });

  app.get('/api/orgs/:orgId/members', { preHandler: app.authenticate }, async (request) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.params);
    await requireMembership(request.user.userId, orgId);

    const members = await prisma.membership.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
  });

  app.post('/api/orgs/:orgId/members', { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.params);
    const body = inviteBody.parse(request.body);
    const actor = await requireMembership(request.user.userId, orgId);
    requireRole(actor.role, Role.ADMIN);
    if (body.role === Role.OWNER && actor.role !== Role.OWNER) {
      throw new HttpError(403, 'only_owner_can_create_owner');
    }

    const targetUser = await prisma.user.findUnique({ where: { email: body.email } });
    if (!targetUser) throw new HttpError(404, 'user_not_found');

    const existing = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: targetUser.id, organizationId: orgId } },
    });
    if (existing) throw new HttpError(409, 'already_member');

    const created = await prisma.membership.create({
      data: { userId: targetUser.id, organizationId: orgId, role: body.role },
    });
    return reply.code(201).send({ userId: targetUser.id, role: created.role });
  });

  app.patch('/api/orgs/:orgId/members/:userId', { preHandler: app.authenticate }, async (request) => {
    const { orgId, userId: targetId } = z
      .object({ orgId: z.string().uuid(), userId: z.string().uuid() })
      .parse(request.params);
    const body = updateMemberBody.parse(request.body);
    const actor = await requireMembership(request.user.userId, orgId);
    requireRole(actor.role, Role.ADMIN);
    if (body.role === Role.OWNER && actor.role !== Role.OWNER) {
      throw new HttpError(403, 'only_owner_can_create_owner');
    }

    const target = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: targetId, organizationId: orgId } },
    });
    if (!target) throw new HttpError(404, 'member_not_found');

    if (target.role === Role.OWNER && body.role !== Role.OWNER) {
      const owners = await prisma.membership.count({
        where: { organizationId: orgId, role: Role.OWNER },
      });
      if (owners <= 1) throw new HttpError(409, 'cannot_demote_last_owner');
    }

    const updated = await prisma.membership.update({
      where: { id: target.id },
      data: { role: body.role },
    });
    return { userId: targetId, role: updated.role };
  });

  app.delete('/api/orgs/:orgId/members/:userId', { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId, userId: targetId } = z
      .object({ orgId: z.string().uuid(), userId: z.string().uuid() })
      .parse(request.params);
    const actor = await requireMembership(request.user.userId, orgId);
    requireRole(actor.role, Role.ADMIN);

    const target = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: targetId, organizationId: orgId } },
    });
    if (!target) throw new HttpError(404, 'member_not_found');

    if (target.role === Role.OWNER) {
      if (actor.role !== Role.OWNER) throw new HttpError(403, 'only_owner_can_remove_owner');
      const owners = await prisma.membership.count({
        where: { organizationId: orgId, role: Role.OWNER },
      });
      if (owners <= 1) throw new HttpError(409, 'cannot_remove_last_owner');
    }

    await prisma.membership.delete({ where: { id: target.id } });
    return reply.code(204).send();
  });
}
