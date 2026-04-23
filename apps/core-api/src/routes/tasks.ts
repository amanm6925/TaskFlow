import type { FastifyInstance } from 'fastify';
import { Prisma, Role, TaskPriority, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { HttpError, authorize } from '../permissions.js';
import { withTx, type Tx } from '../tenant.js';
import { broadcast } from '../realtime.js';

const createTaskBody = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10_000).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

const updateTaskBody = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(10_000).nullable().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

async function loadTaskWithProject(tx: Tx, taskId: string) {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });
  if (!task) throw new HttpError(404, 'task_not_found');
  return task;
}

async function assertAssigneeInOrg(tx: Tx, assigneeId: string, organizationId: string) {
  const m = await tx.membership.findUnique({
    where: { userId_organizationId: { userId: assigneeId, organizationId } },
  });
  if (!m) throw new HttpError(400, 'assignee_not_in_org');
}

export async function taskRoutes(app: FastifyInstance) {
  app.get('/api/projects/:projectId/tasks', { preHandler: app.authenticate }, async (request) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    return withTx(request.user.userId, async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) throw new HttpError(404, 'project_not_found');
      await authorize(request, 'task:read', { orgId: project.organizationId }, tx);

      return tx.task.findMany({
        where: { projectId },
        orderBy: { number: 'asc' },
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          reporter: { select: { id: true, name: true, email: true } },
        },
      });
    });
  });

  app.post('/api/projects/:projectId/tasks', { preHandler: app.authenticate }, async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = createTaskBody.parse(request.body);

    const { task, projectKey, orgId } = await withTx(request.user.userId, async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) throw new HttpError(404, 'project_not_found');
      await authorize(request, 'task:create', { orgId: project.organizationId }, tx);

      if (body.assigneeId) await assertAssigneeInOrg(tx, body.assigneeId, project.organizationId);

      const created = await createTaskWithRetry(tx, projectId, {
        title: body.title,
        description: body.description ?? null,
        status: body.status ?? TaskStatus.TODO,
        priority: body.priority ?? TaskPriority.MEDIUM,
        reporterId: request.user.userId,
        assigneeId: body.assigneeId ?? null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
      });

      return { task: created, projectKey: project.key, orgId: project.organizationId };
    });

    broadcast({ type: 'task.created', orgId, data: { ...task, projectKey } });
    return reply.code(201).send(task);
  });

  app.get('/api/tasks/:taskId', { preHandler: app.authenticate }, async (request) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    return withTx(request.user.userId, async (tx) => {
      const task = await loadTaskWithProject(tx, taskId);
      await authorize(request, 'task:read', { orgId: task.project.organizationId }, tx);
      return task;
    });
  });

  app.patch('/api/tasks/:taskId', { preHandler: app.authenticate }, async (request) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const body = updateTaskBody.parse(request.body);

    const { updated, projectKey, orgId } = await withTx(request.user.userId, async (tx) => {
      const task = await loadTaskWithProject(tx, taskId);

      const { membership } = await authorize(request, 'task:update', {
        orgId: task.project.organizationId,
      }, tx);

      if (membership.role === Role.MEMBER) {
        const isStakeholder =
          task.reporterId === request.user.userId || task.assigneeId === request.user.userId;
        if (!isStakeholder) throw new HttpError(403, 'forbidden');
      }

      if (body.assigneeId) await assertAssigneeInOrg(tx, body.assigneeId, task.project.organizationId);

      const result = await tx.task.update({
        where: { id: taskId },
        data: {
          ...body,
          dueDate: body.dueDate === undefined ? undefined : body.dueDate ? new Date(body.dueDate) : null,
        },
      });
      return { updated: result, projectKey: task.project.key, orgId: task.project.organizationId };
    });

    broadcast({ type: 'task.updated', orgId, data: { ...updated, projectKey } });
    return updated;
  });

  app.delete('/api/tasks/:taskId', { preHandler: app.authenticate }, async (request, reply) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);

    const { projectId, orgId } = await withTx(request.user.userId, async (tx) => {
      const task = await loadTaskWithProject(tx, taskId);

      const { membership } = await authorize(request, 'task:delete', {
        orgId: task.project.organizationId,
      }, tx);

      if (membership.role === Role.MEMBER && task.reporterId !== request.user.userId) {
        throw new HttpError(403, 'forbidden');
      }

      await tx.task.delete({ where: { id: taskId } });
      return { projectId: task.projectId, orgId: task.project.organizationId };
    });

    broadcast({ type: 'task.deleted', orgId, data: { id: taskId, projectId } });
    return reply.code(204).send();
  });
}

async function createTaskWithRetry(
  tx: Tx,
  projectId: string,
  data: Omit<Prisma.TaskUncheckedCreateInput, 'projectId' | 'number'>,
  attempts = 5,
) {
  // Savepoints let us roll back the failed INSERT without aborting the outer tx.
  for (let i = 0; i < attempts; i++) {
    await tx.$executeRawUnsafe('SAVEPOINT task_create');
    try {
      const max = await tx.task.aggregate({ _max: { number: true }, where: { projectId } });
      const number = (max._max.number ?? 0) + 1;
      const created = await tx.task.create({ data: { ...data, projectId, number } });
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT task_create');
      return created;
    } catch (err) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT task_create');
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
      throw err;
    }
  }
  throw new HttpError(503, 'task_number_contention');
}
