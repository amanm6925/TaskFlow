import type { FastifyInstance } from 'fastify';
import { Prisma, Role, TaskPriority, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, requireMembership, requireRole } from '../permissions.js';
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

async function loadTaskWithProject(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });
  if (!task) throw new HttpError(404, 'task_not_found');
  return task;
}

async function assertAssigneeInOrg(assigneeId: string, organizationId: string) {
  const m = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: assigneeId, organizationId } },
  });
  if (!m) throw new HttpError(400, 'assignee_not_in_org');
}

export async function taskRoutes(app: FastifyInstance) {
  app.get('/api/projects/:projectId/tasks', { preHandler: app.authenticate }, async (request) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new HttpError(404, 'project_not_found');
    await requireMembership(request.user.userId, project.organizationId);

    return prisma.task.findMany({
      where: { projectId },
      orderBy: { number: 'asc' },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        reporter: { select: { id: true, name: true, email: true } },
      },
    });
  });

  app.post('/api/projects/:projectId/tasks', { preHandler: app.authenticate }, async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = createTaskBody.parse(request.body);

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new HttpError(404, 'project_not_found');
    const m = await requireMembership(request.user.userId, project.organizationId);
    requireRole(m.role, Role.MEMBER);

    if (body.assigneeId) await assertAssigneeInOrg(body.assigneeId, project.organizationId);

    const task = await createTaskWithRetry(projectId, {
      title: body.title,
      description: body.description ?? null,
      status: body.status ?? TaskStatus.TODO,
      priority: body.priority ?? TaskPriority.MEDIUM,
      reporterId: request.user.userId,
      assigneeId: body.assigneeId ?? null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
    });

    broadcast({ type: 'task.created', data: { ...task, projectKey: project.key } });
    return reply.code(201).send(task);
  });

  app.get('/api/tasks/:taskId', { preHandler: app.authenticate }, async (request) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const task = await loadTaskWithProject(taskId);
    await requireMembership(request.user.userId, task.project.organizationId);
    return task;
  });

  app.patch('/api/tasks/:taskId', { preHandler: app.authenticate }, async (request) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const body = updateTaskBody.parse(request.body);
    const task = await loadTaskWithProject(taskId);
    const m = await requireMembership(request.user.userId, task.project.organizationId);

    const isPrivileged = m.role === Role.OWNER || m.role === Role.ADMIN;
    const isStakeholder = task.reporterId === request.user.userId || task.assigneeId === request.user.userId;
    if (!isPrivileged && !isStakeholder) throw new HttpError(403, 'forbidden');
    if (m.role === Role.VIEWER) throw new HttpError(403, 'forbidden');

    if (body.assigneeId) await assertAssigneeInOrg(body.assigneeId, task.project.organizationId);

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...body,
        dueDate: body.dueDate === undefined ? undefined : body.dueDate ? new Date(body.dueDate) : null,
      },
    });
    broadcast({ type: 'task.updated', data: { ...updated, projectKey: task.project.key } });
    return updated;
  });

  app.delete('/api/tasks/:taskId', { preHandler: app.authenticate }, async (request, reply) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const task = await loadTaskWithProject(taskId);
    const m = await requireMembership(request.user.userId, task.project.organizationId);

    const isAdmin = m.role === Role.OWNER || m.role === Role.ADMIN;
    const isReporter = task.reporterId === request.user.userId;
    if (!isAdmin && !isReporter) throw new HttpError(403, 'forbidden');

    await prisma.task.delete({ where: { id: taskId } });
    broadcast({ type: 'task.deleted', data: { id: taskId, projectId: task.projectId } });
    return reply.code(204).send();
  });
}

async function createTaskWithRetry(
  projectId: string,
  data: Omit<Prisma.TaskUncheckedCreateInput, 'projectId' | 'number'>,
  attempts = 5,
) {
  for (let i = 0; i < attempts; i++) {
    const max = await prisma.task.aggregate({ _max: { number: true }, where: { projectId } });
    const number = (max._max.number ?? 0) + 1;
    try {
      return await prisma.task.create({ data: { ...data, projectId, number } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
      throw err;
    }
  }
  throw new HttpError(503, 'task_number_contention');
}
