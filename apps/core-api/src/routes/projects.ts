import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, authorize, can, loadMembership } from '../permissions.js';

const createProjectBody = z.object({
  name: z.string().trim().min(1).max(200),
  key: z.string().regex(/^[A-Z0-9]{2,10}$/, 'key must be 2-10 uppercase alphanumerics'),
  description: z.string().max(10_000).optional(),
});

const updateProjectBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10_000).nullable().optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.get('/api/orgs/:orgId/projects', { preHandler: app.authenticate }, async (request) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.params);
    await authorize(request, 'project:read', { orgId });

    return prisma.project.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
    });
  });

  app.post('/api/orgs/:orgId/projects', { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.params);
    const body = createProjectBody.parse(request.body);
    await authorize(request, 'project:create', { orgId });

    const conflict = await prisma.project.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: body.key } },
    });
    if (conflict) throw new HttpError(409, 'key_taken');

    const created = await prisma.project.create({
      data: {
        organizationId: orgId,
        name: body.name,
        key: body.key,
        description: body.description ?? null,
        createdById: request.user.userId,
      },
    });
    return reply.code(201).send(created);
  });

  app.get('/api/projects/:projectId', { preHandler: app.authenticate }, async (request) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new HttpError(404, 'project_not_found');
    await authorize(request, 'project:read', { orgId: project.organizationId });
    return project;
  });

  app.patch('/api/projects/:projectId', { preHandler: app.authenticate }, async (request) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = updateProjectBody.parse(request.body);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new HttpError(404, 'project_not_found');

    // Matrix allows OWNER/ADMIN. Creator override lifts MEMBER to edit their own project,
    // but never VIEWER — viewers are read-only across the system.
    const membership = await loadMembership(request, { orgId: project.organizationId });
    const isCreator = project.createdById === request.user.userId;
    const canViaMatrix = can('project:update', membership.role);
    const canViaOverride = isCreator && membership.role !== Role.VIEWER;
    if (!canViaMatrix && !canViaOverride) {
      throw new HttpError(403, 'forbidden');
    }

    return prisma.project.update({ where: { id: projectId }, data: body });
  });

  app.delete('/api/projects/:projectId', { preHandler: app.authenticate }, async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new HttpError(404, 'project_not_found');

    await authorize(request, 'project:delete', { orgId: project.organizationId });

    await prisma.project.delete({ where: { id: projectId } });
    return reply.code(204).send();
  });
}
